import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { z } from 'zod';
import { XService } from './service.js';
import { errorInfo, XBrowserError } from './errors.js';
import { preferencesSchema, preferenceEnvironment } from './config.js';
import { actionSchema, handleSchema, limitSchema, nameSchema, scrollSchema } from './validation.js';
import { compareSnapshots } from './store.js';
import { reviewOptionsSchema } from './review-export.js';

const defaultAssets = fileURLToPath(new URL('../dashboard-dist/', import.meta.url));
const readSchema = z.object({ source: z.enum(['search','timeline','profile_posts','thread','bookmarks','connections','notifications','trends']), query: z.string().max(1000).optional(), handle: z.string().max(16).optional(), url: z.string().max(300).optional(), tab: z.string().max(30).optional(), limit: limitSchema, maxScrolls: scrollSchema }).strict();
const searchSchema = z.object({ name: nameSchema, query: z.string().trim().min(1).max(1000), tab: z.enum(['latest','top','people','photos','videos']).default('latest'), limit: limitSchema, maxScrolls: scrollSchema }).strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new XBrowserError('UNSUPPORTED_CONTENT', 'Send JSON content.');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 65536) throw new XBrowserError('BODY_TOO_LARGE','Request exceeds 64 KB.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new XBrowserError('INVALID_JSON','The request is not valid JSON.'); }
}

export async function startDashboard(service: XService, options: { port?: number; assets?: string; env?: NodeJS.ProcessEnv; mode?: 'standalone' | 'shared' } = {}) {
  const port = z.number().int().min(0).max(65535).parse(options.port ?? 8792);
  const env = options.env ?? process.env;
  const assets = resolve(options.assets ?? defaultAssets);
  const html = await readFile(resolve(assets, 'index.html'),'utf8').catch(() => { throw new Error('Dashboard assets are missing. Run npm run build first.'); });
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let requests = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const json = (status: number, value: unknown) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
    let accepted = false;
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || ['cross-site','same-site'].includes(String(req.headers['sec-fetch-site']))) { json(403,{message:'Only this local dashboard can access the service.'}); return; }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) { json(400,{message:'Invalid path'}); return; }
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        const supplied = Buffer.from(String(req.headers['x-dashboard-token'] ?? ''));
        if (supplied.length !== token.length || !timingSafeEqual(supplied,Buffer.from(token))) { json(403,{message:'Reload the local dashboard to establish a new session.'}); return; }
        if (requests >= 24) { json(429,{message:'The local operation queue is full. Wait for current work to finish.'}); return; }
        requests++; accepted = true;
        const data = req.method === 'POST' ? await body(req) : undefined;
        const route = `${req.method} ${url.pathname}`;
        let value: unknown;
        switch (route) {
          case 'GET /api/state': {
            const [session, searches, snapshots, prepared, receipts] = await Promise.all([service.status(),service.store.listSearches(),service.store.listSnapshots(100),service.preparedActions(),service.store.listReceipts()]);
            const config = service.config;
            const browserAvailable = config.cdpUrl || config.browserChannel ? null : await access(config.executablePath ?? chromium.executablePath()).then(()=>true,()=>false);
            const overrides = Object.entries(preferenceEnvironment).filter(([,keys]) => keys.some(key => env[key] !== undefined)).map(([key])=>key);
            const launchEnvironment = { X_BROWSER_DATA_DIR: config.dataDir, X_BROWSER_PROFILE_DIR: config.profileDir, X_BROWSER_DASHBOARD_PORT: new URL(origin).port,
              ...Object.fromEntries(Object.values(preferenceEnvironment).flat().filter(key => env[key] !== undefined).map(key => [key,env[key]])) };
            const mcpConfig = `[mcp_servers.x_browser]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(fileURLToPath(new URL('./cli.js',import.meta.url)))}, "serve", "--dashboard"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 180\n\n[mcp_servers.x_browser.env]\n` + Object.entries(launchEnvironment).map(([key,value]) => `${key} = ${JSON.stringify(value)}\n`).join('');
            value = { session, searches, snapshots, prepared, receipts, mode: options.mode ?? 'standalone', version:'0.2.0', config: {dataDir:config.dataDir,profileDir:config.profileDir,browserChannel:config.browserChannel ?? 'chromium',browserAvailable,headless:config.headless,enableWrites:config.enableWrites,delayMs:config.delayMs,customBrowser:!!(config.cdpUrl || config.executablePath),overrides}, mcpConfig };
            break;
          }
          case 'POST /api/session/open': z.object({}).strict().parse(data); value = await service.open(); break;
          case 'POST /api/session/close': z.object({}).strict().parse(data); value = await service.close(); break;
          case 'POST /api/session/screenshot': {
            z.object({}).strict().parse(data); const picture = await service.screenshot(); res.writeHead(200,{'Content-Type':'image/png'}); res.end(picture); return;
          }
          case 'POST /api/settings': {
            const settings = preferencesSchema.parse(data);
            value = await service.queue.run(async () => {
              if ((await service.browser.status()).state !== 'closed') throw new XBrowserError('SESSION_OPEN','Close the browser session before changing setup preferences. Your saved login remains on this computer.');
              for (const [key,keys] of Object.entries(preferenceEnvironment)) if (keys.some(k => env[k] !== undefined)) {
                const effective = key === 'browserChannel' ? service.config.browserChannel ?? 'chromium' : service.config[key as 'headless' | 'enableWrites' | 'delayMs'];
                if (settings[key as keyof typeof settings] !== effective) throw new XBrowserError('ENVIRONMENT_OVERRIDE',`${key} is managed by your launch environment.`);
              }
              await mkdir(service.config.dataDir,{recursive:true,mode:0o700});
              const path = resolve(service.config.dataDir,'dashboard-settings.json');
              const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
              await writeFile(temporary,JSON.stringify(settings,null,2)+'\n',{mode:0o600,flag:'wx'});
              await rename(temporary,path);
              Object.assign(service.config,settings,{browserChannel:settings.browserChannel === 'chromium' ? undefined : settings.browserChannel});
              return { saved:true };
            }); break;
          }
          case 'POST /api/read': value = await service.read(readSchema.parse(data)); break;
          case 'POST /api/profile': value = await service.profile(z.object({handle:handleSchema}).strict().parse(data).handle); break;
          case 'POST /api/searches/save': value = await service.saveSearch(searchSchema.parse(data)); break;
          case 'POST /api/searches/run': value = await service.runSearch(z.object({name:nameSchema}).strict().parse(data).name); break;
          case 'POST /api/searches/delete': value = await service.queue.run(()=>service.store.deleteSearch(z.object({name:nameSchema}).strict().parse(data).name)); break;
          case 'GET /api/snapshot': value = await service.store.snapshot(z.string().uuid().parse(url.searchParams.get('id'))); break;
          case 'GET /api/review-export': value = await service.store.reviewPreview(z.string().uuid().parse(url.searchParams.get('id'))); break;
          case 'POST /api/review-export': {
            const args = z.object({id:z.string().uuid(),review:reviewOptionsSchema}).strict().parse(data);
            const exported = await service.store.reviewedExport(args.id,args.review);
            const bytes = await readFile(exported.path);
            res.writeHead(200,{'Content-Type':exported.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
              'Content-Disposition':`attachment; filename="x-reviewed-${args.id}.${exported.format}"`});res.end(bytes);return;
          }
          case 'POST /api/compare': { const args = z.object({before:z.string().uuid(),after:z.string().uuid()}).strict().parse(data); value = compareSnapshots(await service.store.snapshot(args.before),await service.store.snapshot(args.after)); break; }
          case 'POST /api/export': {
            const args = z.object({id:z.string().uuid(),format:z.enum(['json','csv','md'])}).strict().parse(data);
            const exported = await service.store.export(args.id,args.format);
            const bytes = await readFile(exported.path);
            res.writeHead(200,{'Content-Type':args.format === 'json' ? 'application/json' : args.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="x-collection-${args.id}.${args.format}"`});res.end(bytes);return;
          }
          case 'POST /api/actions/prepare': { const {expectedAccount,...input} = z.object({...actionSchema.shape,expectedAccount:handleSchema}).strict().parse(data); value = await service.prepare(input,expectedAccount); break; }
          case 'POST /api/actions/cancel': value = await service.cancel(idSchema.parse(data).id); break;
          case 'POST /api/actions/execute': { const args = z.object({id:z.string().uuid(),confirmed:z.literal(true)}).strict().parse(data); value = await service.execute(args.id); break; }
          default: json(404,{message:'Unknown dashboard operation.'});return;
        }
        json(200,value);return;
      }
      if (!['GET','HEAD'].includes(req.method ?? '')) { json(405,{message:'Method not allowed.'});return; }
      if (url.pathname === '/') {res.writeHead(200,{'Content-Type':mime['.html']!});res.end(req.method === 'HEAD' ? undefined : html.replace('__DASHBOARD_TOKEN__',token));return;}
      if (!/^\/(?:assets\/[A-Za-z0-9_.-]+|research-desk\.png|mark\.svg|font-licenses\.txt)$/.test(url.pathname)) {json(404,{message:'Not found'});return;}
      const bytes = await readFile(resolve(assets,'.'+url.pathname));
      res.writeHead(200,{'Content-Type':mime[extname(url.pathname)] ?? 'application/octet-stream','Cache-Control':'private, max-age=3600'});res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      const info = error instanceof z.ZodError ? {code:'INVALID_INPUT',message:error.issues.map(i=>`${i.path.join('.') || 'Request'}: ${i.message}`).join(';').slice(0,600)} : errorInfo(error);
      if (!res.headersSent) json(missing ? 404 : ['BODY_TOO_LARGE','REVIEW_TOO_LARGE','REVIEW_TOO_DEEP','REVIEW_EXPORT_TOO_LARGE'].includes(info.code) ? 413 : ['SESSION_OPEN','ENVIRONMENT_OVERRIDE','REVIEW_STALE','CONFLICTING_DUPLICATE'].includes(info.code) ? 409 : 400,missing ? {message:'The requested local record was not found.'} : info);
      else res.end();
    } finally {if (accepted) requests--;}
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.off('error',fail);done();});});
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Dashboard failed to bind.');
  origin = `http://127.0.0.1:${address.port}`;
  return {url:origin,close:()=>new Promise<void>((done,fail)=>{server.close(error=>error ? fail(error) : done());server.closeIdleConnections();})};
}
