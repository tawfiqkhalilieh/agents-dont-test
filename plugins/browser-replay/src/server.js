import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Recorder } from './recorder.js';
import { enrichReplay } from './enrich.js';

const recorder = new Recorder(process.env.BROWSER_REPLAY_OUTPUT);
const server = new McpServer({name:'browser-replay', version:'0.1.0'});
const result = data => ({content:[{type:'text',text:JSON.stringify(data,null,2)}]});
const running = new Set();
const shutdownController = new AbortController();
let shuttingDown = false;
let enriching = false;
const run = fn => async (args, extra) => {
  if (shuttingDown) return {...result({error:'Server is shutting down'}),isError:true};
  const controller = new AbortController();
  const sources = [shutdownController.signal,extra?.signal].filter(Boolean);
  const abort = () => controller.abort();
  for (const source of sources) {
    source.addEventListener('abort',abort,{once:true});
    if (source.aborted) abort();
  }
  const operation = Promise.resolve().then(() => fn(args,controller.signal));
  running.add(operation);
  try {return result(await operation);}
  catch(error) {return {...result({error:error.message}),isError:true};}
  finally {running.delete(operation);for (const source of sources) source.removeEventListener('abort',abort);}
};
server.tool('record_start', 'Watch browser interactions and save a replay. Attach to the same Chromium CDP endpoint used by the testing agent, or launch a new browser.', {
  name:z.string().optional(), endpoint:z.string().url().optional(), url:z.string().url().optional(), headless:z.boolean().optional()
}, run(args => {
  if (enriching) throw new Error('Wait for enrichment to finish before starting a recording');
  return recorder.start(args);
}));
server.tool('record_status', 'Get recording status, page IDs, and required secret environment variables.', {}, run(() => recorder.status()));
server.tool('record_assert_text', 'Verify text now and include that assertion in the replay.', {page:z.number().int().nonnegative(),selector:z.string(),text:z.string()}, run(async ({page,selector,text}) => {await recorder.assertText(page,selector,text); return {ok:true};}));
server.tool('record_stop', 'Finish recording and export JavaScript plus JSON. Does not execute the replay.', {}, run(() => recorder.stop()));
server.tool('record_enrich', 'Add verified outcome assertions with the Antigravity flash assertion-enricher. Replays the task, including its side effects, up to seven times. Requires authenticated agy and an unchanged exported script.', {
  scriptPath:z.string(), recordingPath:z.string(), maxAttempts:z.number().int().min(1).max(3).optional()
}, run(async (args,signal) => {
  if (recorder.phase !== 'idle' || enriching) throw new Error('Finish the active recording or enrichment first');
  enriching = true;
  try {return await enrichReplay(args,{signal});} finally {enriching = false;}
}));
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownController.abort();
  await Promise.allSettled([...running]);
  if (recorder.active) await recorder.stop().catch(error => console.error(error.message));
  await server.close();
}
process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
process.stdin.on('end', () => shutdown());
await server.connect(new StdioServerTransport());
