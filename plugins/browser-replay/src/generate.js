const q = JSON.stringify;
export function generate(recording) {
  const lines = ["import { chromium } from 'playwright';", '',
    'const required = name => { if (process.env[name] === undefined) throw new Error(`Missing environment variable: ${name}`); return process.env[name]; };',
    "const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' });",
    'const resolveURL = (raw, secrets) => { const url = new URL(raw); for (const {key, env} of secrets) url.searchParams.set(key, required(env)); return url.href; };', 'const context = await browser.newContext();', 'context.setDefaultTimeout(15000);', 'const pages = new Map();', 'try {'];
  for (const e of recording.events) {
    const page = `pages.get(${q(e.page)})`;
    let scope = page;
    for (const frame of e.frames || []) scope += `.frameLocator(${q(frame)})`;
    const locator = `${scope}.locator(${q(e.selector)})`;
    for (const popup of recording.events.filter(x => x.type === 'popup' && x.trigger === e.id)) {
      lines.push(`const popup${popup.page} = pages.get(${q(popup.opener)}).waitForEvent('popup');`);
    }
    switch (e.type) {
      case 'page': lines.push(`pages.set(${q(e.page)}, await context.newPage());`); break;
      case 'popup': lines.push(`pages.set(${q(e.page)}, await popup${e.page});`); break;
      case 'goto': lines.push(`await ${page}.goto(${`resolveURL(${q(e.url)}, ${q(e.urlSecrets || [])})`});`); break;
      case 'navigation': lines.push(`await ${scope}.waitForURL(${`resolveURL(${q(e.url)}, ${q(e.urlSecrets || [])})`});`); break;
      case 'click': lines.push(`await ${locator}.click({ button: ${q(e.button)} });`); break;
      case 'fill': lines.push(`await ${locator}.fill(${e.env ? `required(${q(e.env)})` : q(e.value)});`); break;
      case 'select': lines.push(`await ${locator}.selectOption(${q(e.values)});`); break;
      case 'check': lines.push(`await ${locator}.setChecked(${e.checked});`); break;
      case 'press': lines.push(`await ${locator}.press(${q(e.key)});`); break;
      case 'scroll': lines.push(`await ${locator}.evaluate((el, p) => el.scrollTo(p.x, p.y), ${q({x:e.x,y:e.y})});`); break;
      case 'assert': lines.push(`if (await ${locator}.innerText() !== ${q(e.text)}) throw new Error(${q(`Assertion failed: ${e.selector}`)});`); break;
      case 'close': lines.push(`await ${page}.close();`); break;
      case 'unsupported': lines.push(`throw new Error(${q(`Manual step required: ${e.reason}`)});`); break;
      default: throw new Error(`Unknown event type: ${e.type}`);
    }
  }
  lines.push('} finally {', '  await browser.close();', '}', '');
  return lines.join('\n');
}
