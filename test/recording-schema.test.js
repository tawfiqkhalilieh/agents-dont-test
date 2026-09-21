import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRecording } from '../plugins/browser-replay/src/recording-schema.js';

const recording = events => ({version:1,events:[{type:'page',page:0,id:0},...events],requiredEnv:[],errors:[]});
test('persisted demo recording validates without changing replay semantics', async () => {
  const source = JSON.parse(await readFile('examples/enrichment/session.json','utf8'));
  assert.deepEqual(parseRecording(source),source);
});
test('rejects executable payloads in interpolated booleans and popup identifiers', () => {
  assert.throws(() => parseRecording(recording([{type:'check',page:0,selector:'#agree',checked:'process.exit(0)'}])),/Invalid recording/);
  assert.throws(() => parseRecording(recording([{type:'popup',page:'0; process.exit(0)',opener:0,trigger:0}])),/Invalid recording/);
});
test('rejects inconsistent references, duplicate IDs, and undeclared secrets', () => {
  assert.throws(() => parseRecording(recording([{type:'click',page:5,selector:'#submit',button:'left'}])),/unopened/);
  assert.throws(() => parseRecording(recording([{type:'close',page:0},{type:'click',page:0,selector:'#submit',button:'left'}])),/closed/);
  assert.throws(() => parseRecording(recording([{type:'click',page:0,id:0,selector:'#submit',button:'left'}])),/duplicate event/);
  assert.throws(() => parseRecording(recording([{type:'fill',page:0,selector:'#secret',env:'UNDECLARED'}])),/undeclared secret/);
  assert.throws(() => parseRecording(recording([{type:'popup',page:1,opener:0,trigger:0}])),/opener action/);
});
test('requires exactly one text value or secret reference per fill', () => {
  assert.throws(() => parseRecording(recording([{type:'fill',page:0,selector:'#name'}])),/exactly one/);
  assert.throws(() => parseRecording(recording([{type:'fill',page:0,selector:'#name',env:'SECRET',value:'private value'}])),/exactly one/);
});
