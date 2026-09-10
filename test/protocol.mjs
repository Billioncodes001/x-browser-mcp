import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ArtifactStore } from '../dist/store.js';

const data = await mkdtemp(resolve(tmpdir(), 'x-browser-mcp-protocol-'));
const client = new Client({ name:'protocol-test',version:'1.0.0' });
const transport = new StdioClientTransport({
  command:process.execPath, args:[fileURLToPath(new URL('../dist/cli.js',import.meta.url)),'serve','--dashboard'],
  env:{...getDefaultEnvironment(),X_BROWSER_DATA_DIR:data,X_BROWSER_ENABLE_WRITES:'false',X_BROWSER_DASHBOARD_PORT:'0'}, stderr:'pipe',
});
let stderr=''; transport.stderr?.on('data', d => { stderr+=d; });
try {
  await client.connect(transport);
  const {tools} = await client.listTools();
  assert.ok(tools.length>=20);
  assert.equal(tools.find(t=>t.name==='x_action_execute').annotations.readOnlyHint,false);
  const status = await client.callTool({name:'x_session_status',arguments:{}});
  assert.equal(status.structuredContent.state,'closed');
  const saved = await client.callTool({name:'x_saved_search_save',arguments:{name:'demo',query:'from:openai',limit:20}});
  assert.notEqual(saved.isError,true);
  const searches = await client.callTool({name:'x_saved_search_list',arguments:{}});
  assert.equal(searches.structuredContent.items[0].query,'from:openai');
  const dashboard=stderr.match(/X Browser dashboard: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  assert.ok(dashboard,'Shared dashboard announced on stderr without polluting MCP stdout');
  const html=await (await fetch(dashboard)).text();
  const token=html.match(/name="dashboard-token" content="([a-f0-9]+)"/)?.[1];assert.ok(token);
  const dashboardState=await (await fetch(dashboard+'/api/state',{headers:{'X-Dashboard-Token':token}})).json();
  assert.equal(dashboardState.mode,'shared');assert.equal(dashboardState.searches[0].query,'from:openai');
  const blocked = await client.callTool({name:'x_action_execute',arguments:{id:'d9929592-8c9a-4b56-a7d7-1e324a28a5de'}});
  assert.equal(blocked.isError,true); assert.equal(blocked.structuredContent.code,'WRITES_DISABLED');
  const bad = await client.callTool({name:'x_search',arguments:{query:'hello',limit:99999}});
  assert.equal(bad.isError,true);
  const resource = await client.readResource({uri:'x-browser://guide'});
  assert.match(resource.contents[0].text,/untrusted/);
  const prompt = await client.getPrompt({name:'research-x',arguments:{query:'hello'}});
  assert.match(prompt.messages[0].content.text,/Do not perform account actions/);
  const inertRecord=JSON.parse('{"id":"synthetic-1","text":"Synthetic reviewed record","__proto__":{"evidence":"inert field"}}');
  const snapshot=await new ArtifactStore(data).saveSnapshot({kind:'posts',sourceUrl:'https://x.com/search?q=synthetic',capturedAt:'2026-09-09T12:00:00Z',complete:false,stopReason:'blocked',scrolls:0,warnings:['Offline synthetic evidence only'],items:[inertRecord,{id:'synthetic-2',text:'Excluded synthetic record'}]});
  const preview=await client.callTool({name:'x_review_export',arguments:{snapshotId:snapshot.id}});
  assert.notEqual(preview.isError,true);assert.equal(preview.structuredContent.uniqueCount,2);
  assert.deepEqual(preview.structuredContent.records[0].record,inertRecord);
  const args={snapshotId:snapshot.id,review:{snapshotDigest:preview.structuredContent.snapshotDigest,recordIds:['synthetic-1'],note:'Selected synthetic record for offline human review.',acknowledgedPartial:true,format:'json'}};
  const exported=await client.callTool({name:'x_review_export',arguments:args});
  assert.notEqual(exported.isError,true);
  const packet=JSON.parse(await readFile(exported.structuredContent.path,'utf8'));
  assert.equal(packet.records.length,1);assert.equal(packet.records[0].record.id,'synthetic-1');assert.equal(packet.provenance.complete,false);assert.equal(packet.selection.excludedUniqueCount,1);
  assert.deepEqual(packet.records[0].record,inertRecord);assert.equal(Object.hasOwn(Object.prototype,'evidence'),false);
  const stale=await client.callTool({name:'x_review_export',arguments:{...args,review:{...args.review,snapshotDigest:'0'.repeat(64)}}});
  assert.equal(stale.isError,true);assert.equal(stale.structuredContent.code,'REVIEW_STALE');
  assert.equal((await client.callTool({name:'x_session_status',arguments:{}})).structuredContent.state,'closed');
  console.log(`Protocol test passed: ${tools.length} tools, resource, prompt, validation, local search persistence and offline reviewed export with stale-source refusal.`);
} finally {
  await client.close();
  await rm(data,{recursive:true,force:true});
}
