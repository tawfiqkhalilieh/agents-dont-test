import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

console.log('Navigating to website on port 6964...');
await page.goto('http://127.0.0.1:6964');

console.log('Interacting with the website elements...');
await page.locator('[data-testid="name-input"]').fill('Ada Lovelace');
await page.locator('[data-testid="email-input"]').fill('ada@example.com');
await page.locator('[data-testid="topic-select"]').selectOption('bug');
await page.locator('[data-testid="message-input"]').fill('Encountered an issue with navigation state persistence.');
await page.locator('[data-testid="subscribe-checkbox"]').check();

console.log('Submitting feedback form...');
await page.locator('[data-testid="submit-btn"]').click();

await page.locator('[data-testid="confirmation"]').waitFor({ state: 'visible' });
console.log('Confirmation visible. Browser actions finished.');

await browser.close();
