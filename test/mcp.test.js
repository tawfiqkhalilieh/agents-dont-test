import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
test('MCP handshake, tool discovery, recording lifecycle, and error responses', async t => {
  const dir = await mkdtemp(path.resolve('.test-recordings-'));
  const client = new Client({name:'integration-test',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:['plugins/browser-replay/src/server.js'],env:{...process.env,BROWSER_REPLAY_OUTPUT:dir}});
  t.after(async () => {await client.close();await rm(dir,{recursive:true,force:true});});
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length,5);
  assert(tools.tools.some(tool => tool.name === 'record_enrich'));
  const started = await client.callTool({name:'record_start',arguments:{name:'mcp-test'}});
  assert.equal(JSON.parse(started.content[0].text).active,true);
  const stopped = await client.callTool({name:'record_stop',arguments:{}});
  assert((await readFile(JSON.parse(stopped.content[0].text).script,'utf8')).includes('chromium.launch'));
  const again = await client.callTool({name:'record_stop',arguments:{}});
  assert.equal(again.isError,true);
});

test('MCP cancellation stops enrichment and releases its session lock', async t => {
  const {createServer} = await import('node:http');
  const {writeFile,access} = await import('node:fs/promises');
  const {setTimeout:delay} = await import('node:timers/promises');
  const dir = await mkdtemp(path.resolve('.test-recordings-cancel-'));
  const pidFile = path.join(dir,'agent.pid');
  const fakeAgent = path.join(dir,'waiting-agent.cjs');
  await writeFile(fakeAgent,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`,{mode:0o700});
  const website = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end('<h1>Cancellation fixture</h1>');});
  await new Promise(resolve => website.listen(0,'127.0.0.1',resolve));
  const client = new Client({name:'cancellation-test',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:['plugins/browser-replay/src/server.js'],env:{...process.env,BROWSER_REPLAY_OUTPUT:dir,BROWSER_REPLAY_AGY:fakeAgent}});
  t.after(async () => {await client.close();await new Promise(resolve => website.close(resolve));await rm(dir,{recursive:true,force:true});});
  await client.connect(transport);
  await client.callTool({name:'record_start',arguments:{url:`http://127.0.0.1:${website.address().port}`}});
  const stopped = await client.callTool({name:'record_stop',arguments:{}});
  const files = JSON.parse(stopped.content[0].text);
  const original = await readFile(files.script,'utf8');
  const controller = new AbortController();
  const request = client.callTool({name:'record_enrich',arguments:{scriptPath:files.script,recordingPath:files.recording}},undefined,{signal:controller.signal,timeout:15000});
  const cancelled = assert.rejects(request);
  let ready = false;
  for (let i=0;i<100;i++) {
    try {await access(pidFile);ready=true;break;} catch(error) {if(error.code !== 'ENOENT') throw error;await delay(50);}
  }
  controller.abort();await cancelled;
  assert(ready,'enrichment agent should have started');
  let released = false;
  for (let i=0;i<100;i++) {
    try {await access(files.script+'.enrichment.lock');await delay(50);} catch(error) {if(error.code === 'ENOENT') {released=true;break;}throw error;}
  }
  assert(released,'server should clean up the cancelled request');
  assert.equal(await readFile(files.script,'utf8'),original);
  const status = await client.callTool({name:'record_status',arguments:{}});
  assert.equal(JSON.parse(status.content[0].text).phase,'idle');
});
