import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess } from '../plugins/browser-replay/src/process.js';

test('preserves UTF-8 characters split between stdout chunks', async () => {
  const result = await runProcess(process.execPath,['-e',"process.stdout.write(Buffer.from([0xf0,0x9f]));setTimeout(() => process.stdout.write(Buffer.from([0x98,0x80])),30)"]);
  assert.equal(result.stdout,'😀');
});
test('limits output by bytes, including multibyte strings', async () => {
  const result = await runProcess(process.execPath,['-e',"process.stdout.write('😀'.repeat(10000));setInterval(() => {},1000)"],{maxOutput:1000});
  assert.equal(result.overflow,true);
});
test('already cancelled operations never launch', async () => {
  const controller = new AbortController();controller.abort();
  await assert.rejects(runProcess('/executable-that-does-not-exist',[],{signal:controller.signal}),{name:'AbortError'});
});
test('cancellation terminates the POSIX child process group', {skip:process.platform !== 'linux'}, async t => {
  const dir = await mkdtemp(path.resolve('.test-recordings-process-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const pidFile = path.join(dir,'pid');
  const childCode = `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const operation = runProcess(process.execPath,['-e',childCode],{signal:controller.signal});
  const rejected = assert.rejects(operation,{name:'AbortError'});
  t.after(() => controller.abort());
  let pid;
  for (let i=0;i<100;i++) {
    try {pid = Number(await readFile(pidFile,'utf8'));break;} catch(error) {if(error.code !== 'ENOENT') throw error;await delay(20);}
  }
  assert(pid);
  controller.abort();await rejected;
  let stopped = false;
  for(let i=0;i<100;i++) {
    try {
      const status = await readFile(`/proc/${pid}/stat`,'utf8');
      if (status.slice(status.lastIndexOf(')')+2).startsWith('Z')) {stopped=true;break;}
    } catch(error) {if(error.code === 'ENOENT') {stopped=true;break;}throw error;}
    await delay(20);
  }
  assert(stopped,'descendant should be terminated, not orphaned');
});
