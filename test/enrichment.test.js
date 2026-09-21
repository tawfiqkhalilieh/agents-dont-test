import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Recorder } from '../plugins/browser-replay/src/recorder.js';
import { enrichReplay, invokeAntigravity } from '../plugins/browser-replay/src/enrich.js';
import { generate } from '../plugins/browser-replay/src/generate.js';
import { slot, validateCandidate } from '../plugins/browser-replay/src/enrichment-validation.js';
import { runProcess } from '../plugins/browser-replay/src/process.js';

async function session(t) {
  let html = await readFile('website/index.html','utf8');
  const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const dir = await mkdtemp(path.resolve('.test-recordings-'));
  t.after(async () => {await new Promise(r => server.close(r));await rm(dir,{recursive:true,force:true});});
  const recorder = new Recorder(dir);
  await recorder.start({name:'demo',url:`http://127.0.0.1:${server.address().port}`});
  t.after(async () => {if (recorder.active) await recorder.stop();});
  const page = recorder.context.pages()[0];
  await page.locator('#name').fill('Ada');
  await page.locator('#message').fill('Repeat this task');
  await page.getByTestId('submit').click();
  const result = await recorder.stop();
  return {scriptPath:result.script,recordingPath:result.recording,dir,changeApp:next => {html = next;},html};
}
function assertionCode(count = 1) {
  return [
    "await expect(pages.get(0).getByTestId('confirmation')).toBeVisible();",
    "await expect(pages.get(0).getByTestId('confirmation')).toHaveText('Submission saved');",
    `await expect(pages.get(0).getByTestId('submissions').locator('li')).toHaveCount(${count}, {timeout: 150});`,
    "await expect(pages.get(0).getByTestId('submissions')).toContainText('Ada: Repeat this task');",
    "await expect(pages.get(0).locator('#name')).toHaveValue('');",
    "await expect(pages.get(0).locator('#message')).toHaveValue('');"
  ].join('\n');
}
async function fixtureAgent(task, count = 1) {
  // Deterministic test double. This is NOT a model-generated assertion result.
  const events = JSON.parse(await readFile(task.recordingPath,'utf8')).events;
  const index = events.findLastIndex(e => e.type === 'click');
  const code = await readFile(task.candidatePath,'utf8');
  const expression = new RegExp(`(// assertion-enricher:start:${index}\\n)[\\s\\S]*?(// assertion-enricher:end:${index})`);
  await writeFile(task.candidatePath,code.replace(expression,`$1${assertionCode(count)}\n$2`));
  return {testDouble:true};
}

test('enrichment captures DOM, corrects a failed count, publishes a real passing script, and detects an application regression', async t => {
  const s = await session(t);
  const original = await readFile(s.scriptPath,'utf8');
  assert(!original.includes('expect('));
  let attempts = 0;
  const result = await enrichReplay(s,{invokeAgent:async task => {
    attempts++;
    assert(task.prompt.includes(`candidatePath:\n${task.candidatePath}\n`));
    assert(!task.prompt.includes('Paths (JSON)'));
    const observations = JSON.parse(await readFile(task.observationsPath,'utf8'));
    assert(observations.some(o => o.dom.some(el => el.text === 'Submission saved' && el.visible)));
    assert(observations.some(o => o.dom.some(el => el.count === 1)));
    if (attempts === 2) assert(task.prompt.includes('Previous validation/execution failure'));
    return fixtureAgent(task,attempts === 1 ? 2 : 1);
  }});
  assert.equal(result.status,'verified');
  assert.equal(result.attempts,2);
  assert.equal(result.assertions,6);
  assert.equal(await readFile(result.backupPath,'utf8'),original);
  assert.equal((await runProcess(process.execPath,[s.scriptPath])).code,0);
  const report = JSON.parse(await readFile(result.reportPath,'utf8'));
  assert.equal(report.attempts[0].verified,false);
  s.changeApp(s.html.replace('Submission saved','Unexpected error'));
  const regressed = await runProcess(process.execPath,[s.scriptPath],{timeoutMs:10000});
  assert.notEqual(regressed.code,0);
  assert(regressed.stderr.includes('toHaveText'));
});

test('failed enrichment preserves the original and releases its lock', async t => {
  const s = await session(t);
  const original = await readFile(s.scriptPath,'utf8');
  await assert.rejects(enrichReplay({...s,maxAttempts:2},{invokeAgent:task => fixtureAgent(task,99)}),/failed after 2 attempts/);
  assert.equal(await readFile(s.scriptPath,'utf8'),original);
  await assert.rejects(readFile(s.scriptPath+'.enrichment.lock'),{code:'ENOENT'});
});

test('rejects modified exports before executing them', async t => {
  const s = await session(t);
  await writeFile(s.scriptPath,'throw new Error("do not execute");');
  await assert.rejects(enrichReplay(s,{invokeAgent:() => {throw new Error('must not invoke');}}),/unmodified export/);
});

test('enrichment rejects action edits, swallowed errors, and no-op output', () => {
  const recording = {events:[{type:'page',page:0},{type:'goto',page:0,url:'http://localhost:4173'}]};
  const template = generate(recording,{preamble:"import { expect } from '@playwright/test';",afterEvent:(_e,i) => slot(i)});
  const inject = code => template.replace(slot(1),`// assertion-enricher:start:1\n${code}\n// assertion-enricher:end:1`);
  assert.throws(() => validateCandidate(template,template,recording),/No meaningful/);
  assert.throws(() => validateCandidate(template.replace('.goto(','.reload('),template,recording),/outside assertion slots/);
  assert.throws(() => validateCandidate(inject("try { await expect(pages.get(0)).toHaveURL('wrong'); } catch {}"),template,recording),/only awaited/);
  assert.throws(() => validateCandidate(inject("await expect(pages.get(0).evaluate(() => true)).toBeVisible();"),template,recording),/only awaited/);
  assert.throws(() => validateCandidate(inject("await expect(pages.get(0)).toHaveURL(process.env.SECRET);"),template,recording),/only awaited/);
  assert.equal(validateCandidate(inject("await expect(pages.get(0)).toHaveURL('http://localhost:4173/');"),template,recording).assertions,1);
});

test('subprocess timeout terminates a stuck verifier', async () => {
  const result = await runProcess(process.execPath,['-e','setInterval(() => {},1000)'],{timeoutMs:100});
  assert.equal(result.timedOut,true);
  assert.notEqual(result.code,0);
});

test('missing Antigravity executable yields an actionable error', async () => {
  const before = process.env.BROWSER_REPLAY_AGY;
  process.env.BROWSER_REPLAY_AGY = '/nonexistent/browser-replay-agy';
  try {await assert.rejects(invokeAntigravity({workspace:process.cwd(),prompt:'test',timeoutMs:1000}),/Install and authenticate agy/);}
  finally {if (before === undefined) delete process.env.BROWSER_REPLAY_AGY;else process.env.BROWSER_REPLAY_AGY = before;}
});

test('retry cannot pass by deleting failed assertions', async t => {
  const s = await session(t);
  const original = await readFile(s.scriptPath,'utf8');
  await assert.rejects(enrichReplay({...s,maxAttempts:2},{invokeAgent:async task => {
    await fixtureAgent(task,2);
    if (task.attempt === 2) {
      const code = await readFile(task.candidatePath,'utf8');
      await writeFile(task.candidatePath,code.replace(/^await expect.*toHaveCount.*\n/m,''));
    }
  }}),/Retry removed toHaveCount/);
  assert.equal(await readFile(s.scriptPath,'utf8'),original);
});

test('concurrent enrichment is rejected without disturbing the lock', async t => {
  const s = await session(t);
  await writeFile(s.scriptPath+'.enrichment.lock','test owner');
  await assert.rejects(enrichReplay(s),/already running/);
  assert.equal(await readFile(s.scriptPath+'.enrichment.lock','utf8'),'test owner');
});


test('reported tool denials stop enrichment without retrying or altering the export', async t => {
  const s = await session(t);
  const original = await readFile(s.scriptPath,'utf8');
  const executable = path.join(s.dir,'denied-agy.cjs');
  const counter = path.join(s.dir,'invocations');
  const response = {status:'SUCCESS',response:'ACCESS_DENIED: view_file candidate.mjs. No assertions added.'};
  await writeFile(executable,`#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(counter)},'called\\n');
console.log(${JSON.stringify(JSON.stringify(response))});
`,{mode:0o700});
  const before = process.env.BROWSER_REPLAY_AGY;
  process.env.BROWSER_REPLAY_AGY = executable;
  try {
    await assert.rejects(enrichReplay(s),/tool permission denial/);
    assert.equal(await readFile(counter,'utf8'),'called\n');
    assert.equal(await readFile(s.scriptPath,'utf8'),original);
    await assert.rejects(readFile(s.scriptPath+'.enrichment.lock'),{code:'ENOENT'});
  } finally {
    if (before === undefined) delete process.env.BROWSER_REPLAY_AGY;
    else process.env.BROWSER_REPLAY_AGY = before;
  }
});
