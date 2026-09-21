import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { chromium } from 'playwright';
import { Recorder } from '../plugins/browser-replay/src/recorder.js';
const exec = promisify(execFile);

async function fixture(t) {
  const submissions = [];
  const server = createServer((req,res) => {
    res.setHeader('Content-Type','text/html');
    if (req.url.startsWith('/done')) {submissions.push(req.url); return res.end('<h1 id="result">Saved</h1>');}
    if (req.url === '/frame') return res.end('<input id="inside"><button id="frame-button" onclick="document.querySelector(\'#inside\').value=\'frame done\'">Frame</button>');
    if (req.url === '/popup') return res.end('<h1 id="popup">Popup</h1>');
    res.end(`<form action="/done"><input name="user" id="user"><input type="password" name="password" id="password"><input type="checkbox" name="agree" id="agree"><select name="plan" id="plan"><option value="a">A</option><option value="b">B</option></select><button id="save">Save</button></form><iframe id="frame" src="/frame"></iframe><a id="open" target="_blank" href="/popup">Open</a>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const dir = await mkdtemp(path.resolve('.test-recordings-'));
  t.after(async () => {await new Promise(r => server.close(r)); await rm(dir,{recursive:true,force:true});});
  return {url:`http://127.0.0.1:${server.address().port}`,dir,submissions};
}

test('records real form interactions, hides secrets, and replays to the same result', async t => {
  const f = await fixture(t);
  const r = new Recorder(f.dir);
  await r.start({url:f.url});
  t.after(async () => {if(r.active) await r.stop();});
  const page = r.context.pages()[0];
  await page.locator('#user').pressSequentially('Ada');
  await page.locator('#password').fill('do-not-store-me');
  await page.locator('#agree').check();
  await page.locator('#plan').selectOption('b');
  await page.locator('#save').click();
  await page.waitForURL('**/done?**');
  await r.assertText(0,'#result','Saved');
  const output = await r.stop();
  const script = await readFile(output.script,'utf8');
  const json = await readFile(output.recording,'utf8');
  const journal = await readFile(r.journal,'utf8');
  assert(!script.includes('.fill("do-not-store-me")'));
  assert(output.requiredEnv.includes('REPLAY_SECRET_1'));
  assert(!script.includes('do-not-store-me'));
  assert(!json.includes('do-not-store-me'));
  assert(!journal.includes('do-not-store-me'));
  assert.equal(JSON.parse(json).events.filter(e => e.type === 'fill' && e.selector === '[id="user"]').length,1);
  assert(!JSON.parse(journal.split('\n').find(line => line.includes('REPLAY_SECRET_1'))).value);
  await exec(process.execPath,[output.script], {env:{...process.env,...Object.fromEntries(output.requiredEnv.map(name => [name,'do-not-store-me']))}});
  assert.equal(f.submissions.length,2);
  assert.equal(f.submissions[0],f.submissions[1]);
});

test('replays frame actions and a popup', async t => {
  const f = await fixture(t);
  const r = new Recorder(f.dir);
  await r.start({url:f.url});
  t.after(async () => {if(r.active) await r.stop();});
  const p = r.context.pages()[0];
  await p.frameLocator('#frame').locator('#inside').fill('hello frame');
  await p.frameLocator('#frame').locator('#frame-button').click();
  const popupPromise = p.waitForEvent('popup');
  await p.locator('#open').click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await r.assertText(r.pages.get(popup),'#popup','Popup');
  const output = await r.stop();
  await exec(process.execPath,[output.script]);
});

test('CDP attachment records another client and leaves browser running', async t => {
  const f = await fixture(t);
  const browser = await chromium.launch({args:['--remote-debugging-port=19387']});
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(f.url);
  const r = new Recorder(f.dir);
  await r.start({endpoint:'http://127.0.0.1:19387'});
  await page.locator('#user').fill('External agent');
  const output = await r.stop();
  assert((await readFile(output.script,'utf8')).includes('External agent'));
  assert.equal(await page.title(),'');
});

test('rejects conflicting recordings and unsafe filenames', async t => {
  const f = await fixture(t);
  const r = new Recorder(f.dir);
  await assert.rejects(r.start({name:'../escape'}),/Name must/);
  await r.start();
  await assert.rejects(r.start(),/already active/);
  await r.stop();
  await assert.rejects(r.stop(),/No active/);
});
