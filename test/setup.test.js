import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const exec = promisify(execFile);
test('setup preserves existing servers, backs up configs, and is idempotent', async t => {
  const dir = await mkdtemp(path.resolve('.browser-replay-setup-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'.agents'));
  await writeFile(path.join(dir,'.agents/mcp_config.json'),'{"mcpServers":{"existing":{"command":"keep-me"}}}');
  await exec(process.execPath,['scripts/setup.js',dir]);
  const file = path.join(dir,'.codex/config.toml');
  const before = await readFile(file,'utf8');
  assert(before.includes('tool_timeout_sec = 900'));
  const spec = await readFile(path.join(dir,'.agents/agents/assertion-enricher.md'),'utf8');
  assert(spec.includes('model: flash'));
  assert.equal(spec,await readFile('plugins/browser-replay/agents/assertion-enricher.md','utf8'));
  await exec(process.execPath,['scripts/setup.js',dir]);
  assert.equal(await readFile(file,'utf8'),before);
  const config = JSON.parse(await readFile(path.join(dir,'.agents/mcp_config.json'),'utf8'));
  assert.equal(config.mcpServers.existing.command,'keep-me');
  assert.equal(config.mcpServers['browser-replay'].command,process.execPath);
  assert((await readFile(path.join(dir,'.agents/mcp_config.json.browser-replay-backup'),'utf8')).includes('keep-me'));
});
test('setup aborts on malformed configs before writing other files', async t => {
  const dir = await mkdtemp(path.resolve('.browser-replay-setup-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'.agents'));
  await writeFile(path.join(dir,'.agents/mcp_config.json'),'{broken');
  await assert.rejects(exec(process.execPath,['scripts/setup.js',dir]));
  await assert.rejects(readFile(path.join(dir,'.mcp.json')), {code:'ENOENT'});
});

test('setup refuses every TOML spelling of an unmanaged browser-replay Codex entry', async t => {
  const spellings = {
    'bare table':'[mcp_servers.browser-replay]\ncommand = "my-own-node"\n',
    'quoted table':'[mcp_servers."browser-replay"]\ncommand = "my-own-node"\n',
    'sub-table only':'[mcp_servers.browser-replay.env]\nFOO = "bar"\n',
    'dotted key':'mcp_servers.browser-replay = { command = "my-own-node" }\n',
    'key under [mcp_servers]':'[mcp_servers]\nbrowser-replay = { command = "my-own-node" }\nlinear = { command = "mcp-linear" }\n',
    'quoted key under [mcp_servers]':'[mcp_servers]\n"browser-replay" = { command = "my-own-node" }\n',
  };
  for (const [label,toml] of Object.entries(spellings)) {
    const dir = await mkdtemp(path.resolve('.browser-replay-setup-'));
    t.after(() => rm(dir,{recursive:true,force:true}));
    await mkdir(path.join(dir,'.codex'));
    const file = path.join(dir,'.codex/config.toml');
    await writeFile(file,toml);
    await assert.rejects(exec(process.execPath,['scripts/setup.js',dir]),error => {
      assert(error.stderr.includes('Existing unmanaged browser-replay Codex entry'),label);
      return true;
    },label);
    assert.equal(await readFile(file,'utf8'),toml,`${label}: config.toml must not be touched`);
    await assert.rejects(readFile(path.join(dir,'.mcp.json')),{code:'ENOENT'},`${label}: no partial install`);
  }
});

test('setup is not fooled by a comment mentioning the browser-replay table', async t => {
  const dir = await mkdtemp(path.resolve('.browser-replay-setup-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'.codex'));
  const file = path.join(dir,'.codex/config.toml');
  await writeFile(file,'# We removed our old [mcp_servers.browser-replay] entry; setup manages it now.\n[mcp_servers.linear]\ncommand = "/usr/local/bin/mcp-linear"\n');
  await exec(process.execPath,['scripts/setup.js',dir]);
  const toml = await readFile(file,'utf8');
  assert(toml.includes('[mcp_servers.linear]'));
  assert(toml.includes('tool_timeout_sec = 900'));
  // the decoy comment also contains the table name, so count real headers only
  assert.equal(toml.split('\n').filter(line => line.trim() === '[mcp_servers.browser-replay]').length,1);
});

test('production setup detects missing Chromium before writing configurations', async t => {
  const dir = await mkdtemp(path.resolve('.browser-replay-setup-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  await assert.rejects(exec(process.execPath,['scripts/setup.js',dir],{
    env:{...process.env,NODE_ENV:'production',PLAYWRIGHT_BROWSERS_PATH:path.join(dir,'empty-browser-cache')}
  }),error => {
    assert(error.stderr.includes('Chromium could not start'));
    assert(error.stderr.includes('npm run setup -- --install-browser'));
    return true;
  });
  await assert.rejects(readFile(path.join(dir,'.mcp.json')),{code:'ENOENT'});
});
