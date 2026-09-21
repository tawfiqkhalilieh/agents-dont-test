import { createServer } from 'node:http';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { handleTermination } from './termination.js';
import { Recorder } from '../plugins/browser-replay/src/recorder.js';
import { enrichReplay } from '../plugins/browser-replay/src/enrich.js';

// The default exercises a REAL authenticated Flash agent. --record-only prepares
// a raw artifact for environments where model authentication is unavailable.
const {values} = parseArgs({options:{'record-only':{type:'boolean'},port:{type:'string',default:'4173'},output:{type:'string',default:'recordings/demo'}}});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const html = await readFile(new URL('../website/index.html',import.meta.url));
const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const output = path.resolve(values.output);
await mkdir(output,{recursive:true});
const recorder = new Recorder(output);
const termination = handleTermination();
try {
  await recorder.start({name:'submission',url:`http://127.0.0.1:${port}/`});
  const page = recorder.context.pages()[0];
  await page.locator('#name').fill('Ada');
  await page.locator('#message').fill('Repeat this task');
  await page.getByTestId('submit').click();
  const raw = await recorder.stop();
  await copyFile(raw.recording,path.join(output,'session.json'));
  await copyFile(raw.script,path.join(output,'raw.mjs'));
  if (values['record-only']) console.log(JSON.stringify({mode:'record-only',recordingPath:path.join(output,'session.json'),scriptPath:path.join(output,'raw.mjs')},null,2));
  else {
    const scriptPath = path.join(output,'enriched.mjs');
    await copyFile(raw.script,scriptPath);
    const result = await enrichReplay({scriptPath,recordingPath:path.join(output,'session.json')},{signal:termination.signal});
    console.log(JSON.stringify({mode:'live-antigravity-flash',...result},null,2));
  }
} catch(error) {console.error(error.message);process.exitCode ||= 1;}
finally {
  termination.dispose();
  if (recorder.active) await recorder.stop();
  await new Promise(resolve => server.close(resolve));
}
