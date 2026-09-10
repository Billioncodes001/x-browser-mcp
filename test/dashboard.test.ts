import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startDashboard } from '../dist/dashboard.js';
import { XService } from '../dist/service.js';
import { ArtifactStore } from '../dist/store.js';
import { loadConfig } from '../dist/config.js';
import { REVIEW_SNAPSHOT_MAX_BYTES } from '../dist/review-export.js';
import { FakeBrowser, sample, tempConfig } from './helpers.js';

async function fixture(){
  const environment=await tempConfig();const browser=new FakeBrowser();browser.state='closed';
  const service=new XService(browser,new ArtifactStore(environment.config.dataDir),environment.config);
  const server=await startDashboard(service,{port:0,env:{},mode:'shared'});
  const html=await (await fetch(server.url)).text();const token=html.match(/name="dashboard-token" content="([a-f0-9]+)"/)?.[1];assert.ok(token);
  const call=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(server.url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'X-Dashboard-Token':token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {...environment,browser,service,server,call,token,cleanup:async()=>{await server.close();await environment.cleanup();}};
}
test('local dashboard rejects unauthenticated, cross-origin and rebinding requests',async()=>{const f=await fixture();try{
  assert.equal((await fetch(f.server.url+'/api/state')).status,403);
  assert.equal((await f.call('/state',undefined,{Origin:'https://example.com'})).status,403);
  assert.equal((await f.call('/state',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  const rebound = await new Promise<number | undefined>((done,fail) => {
    const req=httpRequest(f.server.url+'/api/state',{headers:{Host:'attacker.example:8792','X-Dashboard-Token':f.token}},res=>{res.resume();res.once('end',()=>done(res.statusCode));});req.once('error',fail);req.end();
  });
  assert.equal(rebound,403);
  assert.equal((await f.call('/state',undefined,{'X-Dashboard-Token':'invalid'})).status,403);
  const response=await f.call('/state');assert.equal(response.status,200);assert.equal((await response.json()).mode,'shared');
  const home=await fetch(f.server.url);assert.match(home.headers.get('content-security-policy')! ,/frame-ancestors 'none'/);assert.equal(home.headers.get('cache-control'),'no-store');
}finally{await f.cleanup();}});
test('dashboard validates bounded payloads and does not serve private paths',async()=>{const f=await fixture();try{
  assert.equal((await f.call('/read',{source:'search',query:'hello',limit:201,maxScrolls:0})).status,400);
  assert.equal((await f.call('/session/open',{content:'a'.repeat(66000)})).status,413);
  assert.equal((await f.call('/session/open',{surprise:true})).status,400);
  assert.equal((await fetch(f.server.url+'/.env')).status,404);
  assert.equal((await fetch(f.server.url+'/assets/../../package.json')).status,404);
  assert.equal((await f.call('/snapshot?id=../../private')).status,400);
}finally{await f.cleanup();}});
test('preferences persist, require a closed session and respect environment precedence',async()=>{const f=await fixture();try{
  const settings={browserChannel:'msedge',headless:true,enableWrites:false,delayMs:2000};
  f.browser.state='logged_in';assert.equal((await f.call('/settings',settings)).status,409);
  f.browser.state='closed';assert.equal((await f.call('/settings',settings)).status,200);
  const restored=loadConfig({X_BROWSER_DATA_DIR:f.config.dataDir});assert.equal(restored.browserChannel,'msedge');assert.equal(restored.delayMs,2000);assert.equal(restored.enableWrites,false);
  const overridden=loadConfig({X_BROWSER_DATA_DIR:f.config.dataDir,X_BROWSER_CHANNEL:'chrome',X_BROWSER_ENABLE_WRITES:'true'});assert.equal(overridden.browserChannel,'chrome');assert.equal(overridden.enableWrites,true);
  assert.equal((await f.call('/settings',{...settings,delayMs:10})).status,400);
}finally{await f.cleanup();}});
test('dashboard saves and reruns real service searches, compares samples and downloads escaped CSV',async()=>{const f=await fixture();try{
  const saved={name:'research',query:'hello',tab:'latest',limit:10,maxScrolls:0};
  assert.equal((await f.call('/searches/save',saved)).status,200);
  const first=await (await f.call('/searches/run',{name:'research'})).json();
  f.browser.result=sample([{id:'2',text:'=HYPERLINK("example")',url:'https://x.com/alice/status/2'}]);
  const second=await (await f.call('/searches/run',{name:'research'})).json();assert.equal(second.comparison.added[0].id,'2');
  const diff=await (await f.call('/compare',{before:first.snapshot.id,after:second.snapshot.id})).json();assert.equal(diff.notObserved[0].id,'1');
  const response=await f.call('/export',{id:second.snapshot.id,format:'csv'});assert.match(response.headers.get('content-disposition')!,/attachment/);assert.match(await response.text(),/'=HYPERLINK/);
  await f.call('/searches/delete',{name:'research'});assert.equal((await f.service.store.listSearches()).length,0);assert.equal((await f.service.store.listSnapshots()).length,2);
}finally{await f.cleanup();}});
test('MCP-prepared actions appear in the dashboard and require explicit single-use confirmation',async()=>{const f=await fixture();try{
  f.browser.state='logged_in';const preview=await f.service.prepare({action:'post',text:'Synthetic dashboard test'},'alice');
  assert.equal((await (await f.call('/state')).json()).prepared[0].id,preview.id);
  assert.equal((await f.call('/actions/execute',{id:preview.id,confirmed:false})).status,400);assert.equal(f.browser.executions,0);
  assert.equal((await f.call('/actions/execute',{id:preview.id,confirmed:true})).status,200);assert.equal(f.browser.executions,1);
  assert.equal((await f.call('/actions/execute',{id:preview.id,confirmed:true})).status,400);assert.equal(f.browser.executions,1);
  assert.equal((await (await f.call('/state')).json()).receipts[0].status,'verified');
}finally{await f.cleanup();}});
test('uncertain writes leave a receipt and never retry through the dashboard',async()=>{const f=await fixture();try{
  f.browser.state='logged_in';f.browser.failWrite=true;
  const preview=await (await f.call('/actions/prepare',{action:'post',text:'Synthetic failure',expectedAccount:'alice'})).json();
  assert.equal((await f.call('/actions/execute',{id:preview.id,confirmed:true})).status,400);
  const state=await (await f.call('/state')).json();assert.equal(state.prepared.length,0);assert.equal(state.receipts[0].status,'failed_or_uncertain');assert.equal(f.browser.executions,1);
}finally{await f.cleanup();}});

test('review export HTTP boundary protects preview and download, rejects stale selections and never opens a browser',async()=>{const f=await fixture();try{
  f.browser.open=async()=>{throw new Error('Review must not open a browser');};
  f.browser.collect=async()=>{throw new Error('Review must not collect live data');};
  const record={id:'reviewed-1',text:'Synthetic selected evidence',url:'https://x.com/fixture/status/501'};
  const snapshot=await f.service.store.saveSnapshot({...sample([record,record,{...record,id:'excluded',text:'Excluded synthetic evidence'}]),stopReason:'blocked',warnings:['Synthetic blocked sample']});
  const source=resolve(f.config.dataDir,'snapshots',snapshot.id+'.json');
  const bytes=await readFile(source);
  assert.equal((await fetch(f.server.url+'/api/review-export?id='+snapshot.id)).status,403);
  assert.equal((await f.call('/review-export?id='+snapshot.id,undefined,{Origin:'https://attacker.invalid'})).status,403);
  const response=await f.call('/review-export?id='+snapshot.id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const preview=await response.json();
  const payload={id:snapshot.id,review:{snapshotDigest:preview.snapshotDigest,recordIds:[record.id],note:'Synthetic source selected after reviewing the partial sample.',acknowledgedPartial:true,format:'json'}};
  assert.equal((await fetch(f.server.url+'/api/review-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,403);
  assert.equal((await f.call('/review-export',payload,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.call('/review-export',{...payload,review:{...payload.review,acknowledgedPartial:false}})).status,400);
  const json=await f.call('/review-export',payload);assert.equal(json.status,200);assert.match(json.headers.get('content-disposition')!,/attachment; filename="x-reviewed-/);
  const packet=await json.json();assert.equal(packet.records.length,1);assert.deepEqual(packet.records[0].originalIndices,[0,1]);assert.equal(packet.selection.excludedUniqueCount,1);assert.equal(packet.provenance.complete,false);
  const csv=await f.call('/review-export',{...payload,review:{...payload.review,format:'csv'}});assert.equal(csv.status,200);assert.match(csv.headers.get('content-type')!,/text\/csv/);const body=await csv.text();assert.match(body,/snapshot_sha256/);assert.match(body,/Synthetic blocked sample/);assert.equal(body.includes('Excluded synthetic evidence'),false);
  assert.deepEqual(await readFile(source),bytes);
  await writeFile(source,Buffer.concat([bytes,Buffer.from('\n')]));
  const stale=await f.call('/review-export',payload);assert.equal(stale.status,409);assert.equal((await stale.json()).code,'REVIEW_STALE');
  const conflict=await f.service.store.saveSnapshot(sample([record,{...record,text:'Conflicting saved text'}]));
  const blocked=await f.call('/review-export?id='+conflict.id);assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'CONFLICTING_DUPLICATE');
  assert.equal(f.browser.state,'closed');assert.equal(f.browser.executions,0);
}finally{await f.cleanup();}});

test('review HTTP size failures are explicit JSON errors, never downloads or source mutations', async () => {
  const f = await fixture(); try {
    f.browser.open = async () => { throw new Error('No live browser allowed'); };
    const items = Array.from({length: 200}, (_, i) => ({id: `size-${i}`, text: 'Synthetic size-bound fixture', url: 'https://x.com/fixture/status/501'}));
    const snapshot = await f.service.store.saveSnapshot(sample(items), 'L'.repeat(3 * 1024 * 1024));
    const source = resolve(f.config.dataDir, 'snapshots', snapshot.id + '.json');
    const original = await readFile(source);
    const preview = await f.service.store.reviewPreview(snapshot.id);
    const response = await f.call('/review-export', {id: snapshot.id, review: {
      snapshotDigest: preview.snapshotDigest, recordIds: items.map(item => item.id),
      note: 'Synthetic selection for an oversized CSV regression.', acknowledgedPartial: true, format: 'csv',
    }});
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('content-disposition'), null);
    const error = await response.json();
    assert.equal(error.code, 'REVIEW_EXPORT_TOO_LARGE');
    assert.match(error.message, /Select fewer records or use JSON/);
    assert.deepEqual(await readFile(source), original);
    const oversized = Buffer.concat([original, Buffer.alloc(REVIEW_SNAPSHOT_MAX_BYTES + 1 - original.length, 32)]);
    await writeFile(source, oversized);
    const rejected = await f.call('/review-export?id=' + snapshot.id);
    assert.equal(rejected.status, 413);
    assert.equal((await rejected.json()).code, 'REVIEW_TOO_LARGE');
    assert.deepEqual(await readFile(source), oversized);
    const deep = Buffer.from(JSON.stringify({id: snapshot.id, data: sample([{id: 'depth'}])})
      .replace('"id":"depth"', '"id":"depth","nested":' + '['.repeat(65) + '0' + ']'.repeat(65)));
    await writeFile(source, deep);
    const depthRejected = await f.call('/review-export?id=' + snapshot.id);
    assert.equal(depthRejected.status, 413);
    assert.equal(depthRejected.headers.get('content-disposition'), null);
    assert.equal((await depthRejected.json()).code, 'REVIEW_TOO_DEEP');
    assert.deepEqual(await readFile(source), deep);
    assert.equal(f.browser.state, 'closed');
    assert.equal(f.browser.executions, 0);
  } finally { await f.cleanup(); }
});
