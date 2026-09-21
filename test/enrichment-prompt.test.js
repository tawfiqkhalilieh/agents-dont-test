import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { artifactPaths } from '../plugins/browser-replay/src/enrichment-prompt.js';

test('file-tool paths are raw absolute values, separate from JSON or shell quoting', () => {
  const paths = {
    candidatePath:path.resolve('project with spaces',`a'b "c" $test`, 'candidate.mjs'),
    recordingPath:path.resolve('project with spaces','session.json'),
    observationsPath:path.resolve('project with spaces','observations.json')
  };
  const prompt = artifactPaths(paths);
  for (const [name,value] of Object.entries(paths)) {
    const toolValue = prompt.split(`${name}:\n`)[1].split('\n')[0];
    assert.equal(toolValue,value);
    assert.notEqual(toolValue,JSON.stringify(value));
  }
  assert(prompt.includes('exact unquoted string paths'));
  assert(prompt.includes('toolAction and toolSummary'));
  assert(prompt.includes('ACCESS_DENIED'));
});
test('rejects ambiguous multiline paths', () => {
  assert.throws(() => artifactPaths({candidatePath:'/tmp/new\nline.mjs',recordingPath:'/tmp/session.json',observationsPath:'/tmp/dom.json'}),/line breaks/);
});
test('registered and bundled agent specs agree on literal file paths and denials', async () => {
  const bundled = await readFile('plugins/browser-replay/agents/assertion-enricher.md','utf8');
  assert.equal(await readFile('.agents/agents/assertion-enricher.md','utf8'),bundled);
  assert(bundled.includes('exact unquoted string paths'));
  assert(bundled.includes('ACCESS_DENIED'));
});
