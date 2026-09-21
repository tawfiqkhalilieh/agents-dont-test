import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, lstat, mkdir, utimes, rm } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { acquireEnrichmentLock, LOCK_STALE_MS, LEGACY_LOCK_STALE_MS } from '../plugins/browser-replay/src/enrichment-lock.js';

async function fixture(t) {
  const dir = await mkdtemp(path.resolve('.test-recordings-lock-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const script = path.join(dir,'session.mjs');
  await writeFile(script,'// fixture');
  return {script,lockPath:script+'.enrichment.lock'};
}
async function age(file,ms) {
  const past = new Date(Date.now()-ms-2000);
  await utimes(file,past,past);
}
test('active locks exclude contenders and release cleanly', async t => {
  const {script,lockPath} = await fixture(t);
  const owner = await acquireEnrichmentLock(script);
  try {
    await assert.rejects(acquireEnrichmentLock(script),/already running/);
    assert((await lstat(lockPath)).isDirectory());
    owner.assertOwned();
  } finally {await owner.release();}
  await assert.rejects(lstat(lockPath),{code:'ENOENT'});
});
test('recovers a lock left by SIGKILL after its heartbeat expires', async t => {
  const {script,lockPath} = await fixture(t);
  const child = fork('test/fixtures/hold-enrichment-lock.mjs',[script],{stdio:['ignore','ignore','inherit','ipc']});
  t.after(() => {if (child.exitCode === null) child.kill('SIGKILL');});
  await once(child,'message');
  const exit = once(child,'exit');
  child.kill('SIGKILL');
  await exit;
  assert((await lstat(lockPath)).isDirectory());
  await age(lockPath,LOCK_STALE_MS);
  const recovered = await acquireEnrichmentLock(script);
  await recovered.release();
  await assert.rejects(lstat(lockPath),{code:'ENOENT'});
});
test('migrates abandoned legacy files, but preserves recent legacy locks', async t => {
  const {script,lockPath} = await fixture(t);
  await writeFile(lockPath,'legacy owner');
  await assert.rejects(acquireEnrichmentLock(script),/recent legacy lock/);
  assert.equal(await readFile(lockPath,'utf8'),'legacy owner');
  await age(lockPath,LEGACY_LOCK_STALE_MS);
  const recovered = await acquireEnrichmentLock(script);
  assert((await lstat(lockPath)).isDirectory());
  await recovered.release();
});
test('only one contender acquires an abandoned directory lock', async t => {
  const {script,lockPath} = await fixture(t);
  await mkdir(lockPath);
  await age(lockPath,LOCK_STALE_MS);
  const contenders = await Promise.allSettled([acquireEnrichmentLock(script),acquireEnrichmentLock(script)]);
  const winners = contenders.filter(result => result.status === 'fulfilled');
  try {assert.equal(winners.length,1);} finally {await Promise.all(winners.map(result => result.value.release()));}
});
