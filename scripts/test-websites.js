import { createServer } from 'node:http';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { Recorder } from '../plugins/browser-replay/src/recorder.js';
import { enrichReplay } from '../plugins/browser-replay/src/enrich.js';

const exec = promisify(execFile);
const websiteDir = fileURLToPath(new URL('../website', import.meta.url));

const { values } = parseArgs({
  options: {
    site: { type: 'string' },
    'record-only': { type: 'boolean' },
    port: { type: 'string', default: '4174' }
  },
  strict: false
});

const port = Number(values.port || 4174);
const recordOnly = Boolean(values['record-only']);
const targetSite = values.site || 'all';

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

async function recordAndEnrich(name, htmlFile, flowName, interact) {
  console.log(`\n--- Recording & Testing Website: ${name} (${htmlFile}) ---`);
  const output = path.resolve(`recordings/${name}`);
  await mkdir(output, { recursive: true });
  const recorder = new Recorder(output);

  try {
    await recorder.start({ name: flowName, url: `http://127.0.0.1:${port}/${htmlFile}` });
    const page = recorder.context.pages()[0];
    await interact(page);
    const raw = await recorder.stop();

    await copyFile(raw.recording, path.join(output, 'session.json'));
    await copyFile(raw.script, path.join(output, 'raw.mjs'));
    const scriptPath = path.join(output, 'enriched.mjs');
    await copyFile(raw.script, scriptPath);

    if (recordOnly) {
      console.log(`✓ Recorded ${name} (record-only mode): ${scriptPath}`);
      return { name, scriptPath, status: 'recorded' };
    }

    console.log(`Enriching ${name} test with Antigravity assertion-enricher...`);
    const result = await enrichReplay({ scriptPath, recordingPath: path.join(output, 'session.json') });
    console.log(`Enrichment result (${name}):`, JSON.stringify(result, null, 2));

    console.log(`Verifying enriched ${name} test headlessly...`);
    await exec(process.execPath, [scriptPath], { env: { ...process.env, HEADLESS: '1' } });
    console.log(`✓ ${name} enriched test passed verification headlessly.`);
    return { name, scriptPath, result, status: 'verified' };
  } finally {
    if (recorder.active) await recorder.stop();
  }
}

async function testTodo() {
  return recordAndEnrich('todo', 'todo.html', 'todo-flow', async page => {
    await page.locator('#task-title').fill('Buy groceries');
    await page.getByTestId('add-task-btn').click();
  });
}

async function testStore() {
  return recordAndEnrich('store', 'store.html', 'store-flow', async page => {
    await page.getByTestId('add-keyboard').click();
    await page.getByTestId('add-mouse').click();
    await page.getByTestId('checkout-btn').click();
  });
}

async function testBooking() {
  return recordAndEnrich('booking', 'booking.html', 'booking-flow', async page => {
    await page.locator('#attendee-name').fill('Ada Lovelace');
    await page.locator('#ticket-tier').selectOption('VIP Pass');
    await page.locator('#ticket-qty').fill('2');
    await page.getByTestId('book-now-btn').click();
  });
}

async function testNotes() {
  return recordAndEnrich('notes', 'notes.html', 'notes-flow', async page => {
    await page.locator('#note-title').fill('Project Plan');
    await page.locator('#note-content').fill('Build and enrich browser tests');
    await page.locator('#note-tag').selectOption('Work');
    await page.getByTestId('save-note-btn').click();
  });
}

async function testSurvey() {
  return recordAndEnrich('survey', 'survey.html', 'survey-flow', async page => {
    await page.locator('#respondent-name').fill('Grace Hopper');
    await page.getByTestId('rating-excellent').check();
    await page.locator('#feedback-comment').fill('Great experience!');
    await page.getByTestId('submit-survey-btn').click();
  });
}

const tests = {
  todo: testTodo,
  store: testStore,
  booking: testBooking,
  notes: testNotes,
  survey: testSurvey
};

try {
  const results = [];
  if (targetSite === 'all') {
    for (const [name, fn] of Object.entries(tests)) {
      results.push(await fn());
    }
  } else if (tests[targetSite]) {
    results.push(await tests[targetSite]());
  } else {
    throw new Error(`Unknown site: ${targetSite}. Available: ${Object.keys(tests).join(', ')}`);
  }

  console.log('\n========================================');
  console.log('Website Test & Enrichment Summary:');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.status} (${r.scriptPath})`);
  }
  console.log('========================================');
} catch (err) {
  console.error('Test execution failed:', err);
  process.exitCode = 1;
} finally {
  server.close();
}
