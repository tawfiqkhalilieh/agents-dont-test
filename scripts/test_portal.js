import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const exec = promisify(execFile);

async function run() {
  console.log('--- Step 1: Connecting to Browser Replay MCP Server ---');
  const client = new Client({ name: 'antigravity-test-runner', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['plugins/browser-replay/src/server.js'],
    env: { ...process.env, BROWSER_REPLAY_OUTPUT: path.resolve('recordings') }
  });
  await client.connect(transport);
  console.log('Connected to MCP server.');

  const tools = await client.listTools();
  console.log('Available MCP tools:', tools.tools.map(t => t.name).join(', '));

  console.log('\n--- Step 2: Calling record_start with CDP endpoint http://127.0.0.1:9222 ---');
  const startResult = await client.callTool({
    name: 'record_start',
    arguments: {
      name: 'customer_portal_test',
      endpoint: 'http://127.0.0.1:9222'
    }
  });
  const startData = JSON.parse(startResult.content[0].text);
  console.log('record_start result:', startData);

  console.log('\n--- Step 3: Driving the testing session on http://127.0.0.1:6964 ---');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  console.log('Navigating to website...');
  await page.goto('http://127.0.0.1:6964');

  console.log('Filling form fields...');
  await page.locator('[data-testid="name-input"]').fill('Ada Lovelace');
  await page.locator('[data-testid="email-input"]').fill('ada@example.com');
  await page.locator('[data-testid="topic-select"]').selectOption('bug');
  await page.locator('[data-testid="message-input"]').fill('Found an unexpected issue on the dashboard view.');
  await page.locator('[data-testid="subscribe-checkbox"]').check();

  console.log('Submitting form...');
  await page.locator('[data-testid="submit-btn"]').click();

  console.log('Waiting for confirmation element...');
  await page.locator('[data-testid="confirmation"]').waitFor({ state: 'visible' });

  console.log('\n--- Step 4: Calling record_status to verify recorded events ---');
  const statusResult = await client.callTool({ name: 'record_status', arguments: {} });
  const statusData = JSON.parse(statusResult.content[0].text);
  console.log('record_status result:', statusData);

  console.log('\n--- Step 5: Calling record_assert_text to add verified outcome assertion ---');
  const expectedConfirmationText = 'Feedback received successfully! Thank you for helping us improve.';
  const assertResult = await client.callTool({
    name: 'record_assert_text',
    arguments: {
      page: 0,
      selector: '[data-testid="confirmation"]',
      text: expectedConfirmationText
    }
  });
  console.log('record_assert_text result:', JSON.parse(assertResult.content[0].text));

  console.log('\n--- Step 6: Calling record_stop to export Playwright test code ---');
  const stopResult = await client.callTool({ name: 'record_stop', arguments: {} });
  const stopData = JSON.parse(stopResult.content[0].text);
  console.log('record_stop result:', stopData);

  await client.close();

  console.log('\n--- Step 7: Reading generated test code ---');
  const generatedScriptPath = stopData.script;
  const scriptContent = await fs.readFile(generatedScriptPath, 'utf8');
  console.log(`\nGenerated test script (${generatedScriptPath}):\n`);
  console.log(scriptContent);

  console.log('\n--- Step 8: Replaying the generated test script with Node.js ---');
  const replayResult = await exec(process.execPath, [generatedScriptPath], {
    env: { ...process.env, HEADLESS: '1' }
  });
  console.log('Replay finished with code 0 (success).');
  if (replayResult.stdout) console.log('Replay stdout:', replayResult.stdout);
  if (replayResult.stderr) console.log('Replay stderr:', replayResult.stderr);

  return { generatedScriptPath, scriptContent };
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
