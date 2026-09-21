import { createServer } from 'node:http';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Recorder } from '../plugins/browser-replay/src/recorder.js';
import { enrichReplay } from '../plugins/browser-replay/src/enrich.js';

const exec = promisify(execFile);
const websiteDir = fileURLToPath(new URL('../website', import.meta.url));
const port = 4174; // dedicated port for test runner

// Static file server
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  const filename = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.join(websiteDir, path.basename(filename));
  try {
    const content = await readFile(filePath);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

await new Promise(r => server.listen(port, '127.0.0.1', r));
console.log(`Server listening on http://127.0.0.1:${port}`);

async function testTodo() {
  console.log('\n--- Recording & Enriching Website 1: Task Manager (todo.html) ---');
  const output = path.resolve('recordings/todo');
  await mkdir(output, { recursive: true });
  const recorder = new Recorder(output);

  try {
    await recorder.start({ name: 'todo-flow', url: `http://127.0.0.1:${port}/todo.html` });
    const page = recorder.context.pages()[0];
    await page.locator('#task-title').fill('Buy groceries');
    await page.getByTestId('add-task-btn').click();
    const raw = await recorder.stop();

    await copyFile(raw.recording, path.join(output, 'session.json'));
    await copyFile(raw.script, path.join(output, 'raw.mjs'));
    const scriptPath = path.join(output, 'enriched.mjs');
    await copyFile(raw.script, scriptPath);

    console.log('Enriching todo test with Antigravity assertion-enricher...');
    const result = await enrichReplay({ scriptPath, recordingPath: path.join(output, 'session.json') });
    console.log('Enrichment result (todo):', JSON.stringify(result, null, 2));

    // Verify execution of enriched test
    console.log('Verifying enriched todo test...');
    await exec(process.execPath, [scriptPath], { env: { ...process.env, HEADLESS: '1' } });
    console.log('✓ Todo enriched test passed verification headlessly.');
    return { name: 'todo', scriptPath, result };
  } finally {
    if (recorder.active) await recorder.stop();
  }
}

async function testStore() {
  console.log('\n--- Recording & Enriching Website 2: QuickStore (store.html) ---');
  const output = path.resolve('recordings/store');
  await mkdir(output, { recursive: true });
  const recorder = new Recorder(output);

  try {
    await recorder.start({ name: 'store-flow', url: `http://127.0.0.1:${port}/store.html` });
    const page = recorder.context.pages()[0];
    await page.getByTestId('add-keyboard').click();
    await page.getByTestId('add-mouse').click();
    await page.getByTestId('checkout-btn').click();
    const raw = await recorder.stop();

    await copyFile(raw.recording, path.join(output, 'session.json'));
    await copyFile(raw.script, path.join(output, 'raw.mjs'));
    const scriptPath = path.join(output, 'enriched.mjs');
    await copyFile(raw.script, scriptPath);

    console.log('Enriching store test with Antigravity assertion-enricher...');
    const result = await enrichReplay({ scriptPath, recordingPath: path.join(output, 'session.json') });
    console.log('Enrichment result (store):', JSON.stringify(result, null, 2));

    // Verify execution of enriched test
    console.log('Verifying enriched store test...');
    await exec(process.execPath, [scriptPath], { env: { ...process.env, HEADLESS: '1' } });
    console.log('✓ Store enriched test passed verification headlessly.');
    return { name: 'store', scriptPath, result };
  } finally {
    if (recorder.active) await recorder.stop();
  }
}

try {
  const todoResult = await testTodo();
  const storeResult = await testStore();
  console.log('\n========================================');
  console.log('All websites successfully tested and enriched with Antigravity!');
  console.log('Todo enriched script:', todoResult.scriptPath);
  console.log('Store enriched script:', storeResult.scriptPath);
  console.log('========================================');
} catch (err) {
  console.error('Test execution failed:', err);
  process.exitCode = 1;
} finally {
  server.close();
}
