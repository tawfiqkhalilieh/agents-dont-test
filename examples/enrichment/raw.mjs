import { chromium } from 'playwright';

const required = name => { if (process.env[name] === undefined) throw new Error(`Missing environment variable: ${name}`); return process.env[name]; };
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const resolveURL = (raw, secrets) => { const url = new URL(raw); for (const {key, env} of secrets) url.searchParams.set(key, required(env)); return url.href; };
const context = await browser.newContext();
context.setDefaultTimeout(15000);
const pages = new Map();
try {
pages.set(0, await context.newPage());
await pages.get(0).goto(resolveURL("http://127.0.0.1:4173/", []));
await pages.get(0).locator("[id=\"name\"]").fill("Ada");
await pages.get(0).locator("[id=\"message\"]").fill("Repeat this task");
await pages.get(0).locator("[data-testid=\"submit\"]").click({ button: "left" });
await pages.get(0).waitForURL(resolveURL("http://127.0.0.1:4173/#saved", []));
} finally {
  await browser.close();
}
