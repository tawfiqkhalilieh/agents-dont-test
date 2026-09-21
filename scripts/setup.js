import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { parseArgs } from 'node:util';
import { checkChromium } from '../plugins/browser-replay/src/browser-check.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {values,positionals} = parseArgs({allowPositionals:true,options:{'install-browser':{type:'boolean'}}});
if (positionals.length > 1) throw new Error('Usage: npm run setup -- [project-directory] [--install-browser]');
const target = path.resolve(positionals[0] || root);
const config = {command:process.execPath,args:[path.join(root,'plugins/browser-replay/src/server.js')],env:{BROWSER_REPLAY_OUTPUT:path.join(target,'recordings')}};
async function read(file) {
  try {return await readFile(file,'utf8');} catch(error) {if(error.code === 'ENOENT') return ''; throw error;}
}
async function save(file, original, content) {
  if (original === content) return;
  await mkdir(path.dirname(file),{recursive:true});
  if (original) await writeFile(`${file}.browser-replay-backup`,original,{flag:'wx',mode:0o600}).catch(error => {if(error.code !== 'EEXIST') throw error;});
  await writeFile(file,content,{mode:0o600});
  console.log(`Configured ${path.relative(target,file)}`);
}
// Parse and prepare every file before changing any config.
const changes = [];
for (const [relative,key] of [['.mcp.json','mcpServers'],['.agents/mcp_config.json','mcpServers'],['.vscode/mcp.json','servers']]) {
  const file = path.join(target,relative);
  const original = await read(file);
  const errors = [];
  const data = original ? parse(original,errors,{allowTrailingComma:true}) : {};
  if (errors.length || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid config: ${file}`);
  if (data[key] && (typeof data[key] !== 'object' || Array.isArray(data[key]))) throw new Error(`Invalid servers map: ${file}`);
  data[key] = {...data[key],'browser-replay':config};
  changes.push([file,original,JSON.stringify(data,null,2)+'\n']);
}
const file = path.join(target,'.codex/config.toml');
const original = await read(file);
const begin = '# BEGIN browser-replay (managed by npm run setup)';
const end = '# END browser-replay';
let base = original;
if (base.includes(begin)) {
  const a=base.indexOf(begin), b=base.indexOf(end,a);
  if (b < 0) throw new Error('Unterminated browser-replay config block');
  base = base.slice(0,a)+base.slice(b+end.length).replace(/^\n/,'');
}
if (/\[\s*mcp_servers\.(?:browser-replay|"browser-replay"|'browser-replay')(?:\.|\s*\])/.test(base)) throw new Error('Existing unmanaged browser-replay Codex entry; remove or rename it first.');
const block = `${begin}\n[mcp_servers.browser-replay]\ncommand = ${JSON.stringify(config.command)}\nargs = ${JSON.stringify(config.args)}\ntool_timeout_sec = 900\n[mcp_servers.browser-replay.env]\nBROWSER_REPLAY_OUTPUT = ${JSON.stringify(config.env.BROWSER_REPLAY_OUTPUT)}\n${end}\n`;
changes.push([file,original,base.trimEnd()+'\n\n'+block]);
await checkChromium({install:values['install-browser']});
console.log('Chromium headless launch verified.');
for (const change of changes) await save(...change);
for (const dir of ['.agents/skills/browser-replay','.claude/skills/browser-replay']) {
  await mkdir(path.join(target,dir),{recursive:true});
  await copyFile(path.join(root,'plugins/browser-replay/skills/browser-replay/SKILL.md'),path.join(target,dir,'SKILL.md'));
}
const agentFile = path.join(target,'.agents/agents/assertion-enricher.md');
const agentSource = await readFile(path.join(root,'plugins/browser-replay/agents/assertion-enricher.md'),'utf8');
await save(agentFile,await read(agentFile),agentSource);
console.log('Restart/reload MCP servers in the host. Browser capture starts with record_start.');
