import { chromium } from 'playwright';
import { expect } from '@playwright/test';

const required = name => { if (process.env[name] === undefined) throw new Error(`Missing environment variable: ${name}`); return process.env[name]; };
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const resolveURL = (raw, secrets) => { const url = new URL(raw); for (const {key, env} of secrets) url.searchParams.set(key, required(env)); return url.href; };
const context = await browser.newContext();
context.setDefaultTimeout(15000);
const pages = new Map();
try {
pages.set(0, await context.newPage());
await pages.get(0).goto(resolveURL("http://127.0.0.1:4173/", []));
// assertion-enricher:start:1
// assertion-enricher:end:1
await pages.get(0).locator("[id=\"name\"]").fill("Ada");
// assertion-enricher:start:2
// assertion-enricher:end:2
await pages.get(0).locator("[id=\"message\"]").fill("Repeat this task");
// assertion-enricher:start:3
// assertion-enricher:end:3
await pages.get(0).locator("[data-testid=\"submit\"]").click({ button: "left" });
// assertion-enricher:start:4
await expect(pages.get(0).getByTestId('confirmation')).toBeVisible();
await expect(pages.get(0).getByTestId('confirmation')).toHaveText('Submission saved');
await expect(pages.get(0).getByTestId('submissions').locator('li')).toHaveCount(1);
await expect(pages.get(0).getByTestId('submissions')).toContainText('Ada: Repeat this task');
await expect(pages.get(0).locator('#name')).toHaveValue('');
await expect(pages.get(0).locator('#message')).toHaveValue('');
await expect(pages.get(0)).toHaveURL('http://127.0.0.1:4173/#saved');
// assertion-enricher:end:4
await pages.get(0).waitForURL(resolveURL("http://127.0.0.1:4173/#saved", []));
// assertion-enricher:start:5
// assertion-enricher:end:5
} finally {
  await browser.close();
}
