import { chromium } from 'playwright';

const required = name => { if (process.env[name] === undefined) throw new Error(`Missing environment variable: ${name}`); return process.env[name]; };
const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });
const resolveURL = (raw, secrets) => { const url = new URL(raw); for (const {key, env} of secrets) url.searchParams.set(key, required(env)); return url.href; };
const context = await browser.newContext();
context.setDefaultTimeout(15000);
const pages = new Map();
try {
pages.set(0, await context.newPage());
await pages.get(0).goto(resolveURL("http://127.0.0.1:6964/", []));
await pages.get(0).locator("[data-testid=\"name-input\"]").fill("Ada Lovelace");
await pages.get(0).locator("[data-testid=\"email-input\"]").fill("ada@example.com");
await pages.get(0).locator("[data-testid=\"topic-select\"]").selectOption(["bug"]);
await pages.get(0).locator("[data-testid=\"message-input\"]").fill("Encountered an issue with navigation state persistence.");
await pages.get(0).locator("[data-testid=\"subscribe-checkbox\"]").setChecked(true);
await pages.get(0).locator("[data-testid=\"submit-btn\"]").click({ button: "left" });
if (await pages.get(0).locator("[data-testid=\"confirmation\"]").innerText() !== "Feedback received successfully! Thank you for helping us improve.") throw new Error("Assertion failed: [data-testid=\"confirmation\"]");
} finally {
  await browser.close();
}
