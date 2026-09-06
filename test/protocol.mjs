import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

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
  console.log(`Protocol test passed: ${tools.length} tools, resource, prompt, validation, and local search persistence.`);
} finally {
  await client.close();
  await rm(data,{recursive:true,force:true});
}
