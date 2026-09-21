import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { installCapture } from './capture.js';
import { generate } from './generate.js';
import { captureEvent } from './schema.js';

export class Recorder {
  constructor(outputDir = path.resolve('recordings')) {
    this.outputDir = outputDir;
    this.events = [];
    this.pages = new Map();
    this.errors = [];
    this.queue = Promise.resolve();
    this.pending = new Set();
    this.active = false;
    this.secrets = new Map();
    this.listeners = [];
  }
  on(emitter, event, callback) {
    emitter.on(event, callback);
    this.listeners.push(() => emitter.off(event, callback));
  }
  track(promise) {
    this.pending.add(promise);
    promise.catch(error => this.errors.push(error.message)).finally(() => this.pending.delete(promise));
  }
  safeURL(raw) {
    const url = new URL(raw);
    const urlSecrets = [];
    for (const key of [...new Set(url.searchParams.keys())]) {
      if (!/password|secret|token|api.?key|authorization|code/i.test(key)) continue;
      const identity = `url:${url.origin}${url.pathname}:${key}`;
      if (!this.secrets.has(identity)) this.secrets.set(identity, `REPLAY_URL_SECRET_${this.secrets.size + 1}`);
      const env = this.secrets.get(identity);
      url.searchParams.set(key, 'REDACTED');
      urlSecrets.push({key, env});
    }
    if (url.username || url.password) {
      url.username = ''; url.password = '';
      this.errors.push('URL credentials were removed; configure authentication before replay.');
    }
    return {url:url.href, urlSecrets};
  }
  append(event) {
    if (!this.active) return;
    const entry = { ...event, id: this.events.length, time: Date.now() };
    this.events.push(entry);
    this.queue = this.queue.then(() => appendFile(this.journal, JSON.stringify(entry) + '\n', {mode: 0o600}));
    this.queue.catch(error => { if (!this.errors.includes(error.message)) this.errors.push(error.message); });
    return entry;
  }
  async start({ name = 'session', endpoint, url, headless = true } = {}) {
    if (this.active || this.browser) throw new Error('A recording is already active');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error('Name must contain 1–80 letters, digits, underscores or hyphens');
    this.events = []; this.pages.clear(); this.errors = []; this.secrets.clear(); this.queue = Promise.resolve();
    await mkdir(this.outputDir, {recursive:true, mode:0o700});
    this.base = path.join(this.outputDir, `${name}-${randomUUID()}`);
    this.journal = `${this.base}.jsonl`;
    this.owned = !endpoint;
    try {
      this.browser = endpoint ? await chromium.connectOverCDP(endpoint) : await chromium.launch({ headless });
      this.context = endpoint ? this.browser.contexts()[0] : await this.browser.newContext();
      if (!this.context) throw new Error('The connected browser has no default context');
      this.active = true;
      const binding = `__replay_${randomUUID().replaceAll('-', '')}`;
      const marker = binding + '_installed';
      this.options = {binding, marker};
      this.captureQueue = Promise.resolve();
      await this.context.exposeBinding(binding, (source, event) => {
        const capture = this.captureQueue.then(() => this.capture(source, event));
        this.captureQueue = capture.catch(() => {});
        this.track(capture);
        return capture;
      });
      await this.context.addInitScript(installCapture, this.options);
      this.on(this.context, 'page', page => this.track(this.attachPage(page)));
      for (const page of this.context.pages()) await this.attachPage(page);
      if (!this.context.pages().length) await this.context.newPage();
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      if (url) await this.context.pages()[0].goto(url);
      return this.status();
    } catch (error) {
      this.active = false;
      for (const remove of this.listeners.splice(0)) remove();
      if (this.browser) await this.browser.close().catch(() => {});
      this.browser = null;
      throw error;
    }
  }
  async attachPage(page) {
    if (this.pages.has(page)) return;
    const id = this.pages.size;
    this.pages.set(page, id);
    // Register synchronously so navigation cannot outrun listener installation.
    this.on(page, 'framenavigated', frame => {
      if (frame !== page.mainFrame() || !/^https?:/.test(frame.url())) return;
      const recent = this.events.findLast(e => e.page === id && ['click', 'press'].includes(e.type));
      this.append({type: recent && Date.now() - recent.time < 2000 ? 'navigation' : 'goto', page:id, ...this.safeURL(frame.url())});
    });
    this.on(page, 'close', () => this.append({type:'close', page:id}));
    this.on(page, 'dialog', dialog => {
      this.append({type:'unsupported', page:id, reason:`Dialog (${dialog.type()}) requires an explicit handler.`});
    });
    const opener = await page.opener();
    const openerId = this.pages.get(opener);
    const trigger = this.events.findLast(e => e.page === openerId && ['click','press'].includes(e.type));
    if (openerId !== undefined && trigger) this.append({type:'popup', page:id, opener:openerId, trigger:trigger.id});
    else this.append({type:'page', page:id});
    if (/^https?:/.test(page.url())) this.append({type: opener ? 'navigation' : 'goto', page:id, ...this.safeURL(page.url())});
    for (const frame of page.frames()) await frame.evaluate(installCapture, this.options).catch(() => {});
  }
  async capture({page, frame}, input) {
    if (!this.active) return;
    // Pages are untrusted: only accept the supported capture event shapes.
    const parsed = captureEvent.safeParse(input);
    if (!parsed.success) { this.errors.push('Invalid event received from a page'); return; }
    input = parsed.data;
    const frames = [];
    try {
      for (let current = frame; current.parentFrame(); current = current.parentFrame()) {
        const element = await current.frameElement();
        const css = await element.evaluate(el => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          if (el.name) return `iframe[name="${CSS.escape(el.name)}"]`;
          return `:is(iframe, frame):nth-of-type(${[...el.parentElement.children].filter(x => x.tagName === el.tagName).indexOf(el)+1})`;
        });
        frames.unshift(css);
      }
    } catch {
      this.append({type:'unsupported', page:this.pages.get(page), reason:'Frame detached before its action could be captured.'});
      return;
    }
    const event = { ...input, page:this.pages.get(page), frames };
    if (event.secret) {
      const key = JSON.stringify([event.page, frames, event.secret]);
      if (!this.secrets.has(key)) this.secrets.set(key, `REPLAY_SECRET_${this.secrets.size+1}`);
      event.env = this.secrets.get(key);
      delete event.secret; delete event.value;
    }
    this.append(event);
  }
  status() {
    return { active:this.active, events:this.events.length, pages:[...this.pages.entries()].filter(([p]) => !p.isClosed()).map(([p,id]) => ({id,url:(() => {const u = new URL(p.url()); u.search = ''; u.hash = ''; u.username = ''; u.password = ''; return u.href;})()})), journal:this.journal, requiredEnv:[...this.secrets.values()], errors:this.errors };
  }
  async assertText(pageId, selector, text) {
    const page = [...this.pages].find(([,id]) => id === pageId)?.[0];
    if (!this.active || !page) throw new Error('No active recorded page with that ID');
    if (await page.locator(selector).innerText() !== text) throw new Error('Current text does not match the assertion');
    this.append({type:'assert',page:pageId,selector,text});
  }
  async stop() {
    if (!this.active) throw new Error('No active recording');
    // Round-trip each live document to flush preceding exposed-binding calls.
    await Promise.allSettled([...this.pages.keys()].flatMap(p => p.frames().map(f => f.evaluate(() => new Promise(resolve => setTimeout(resolve, 0))))));
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.active = false;
    for (const remove of this.listeners.splice(0)) remove();
    await Promise.allSettled([...this.pages.keys()].flatMap(p => p.frames().map(f => f.evaluate(marker => window[marker]?.abort(), this.options.marker))));
    try {
      await this.queue;
      const events = [];
      for (const event of this.events) {
        const last = events.at(-1);
        if (['fill','scroll'].includes(event.type) && last?.type === event.type && last.page === event.page && last.selector === event.selector && JSON.stringify(last.frames) === JSON.stringify(event.frames)) events[events.length-1] = event;
        else events.push(event);
      }
      const recording = {version:1, events, requiredEnv:[...this.secrets.values()], errors:this.errors};
      if (this.errors.length) recording.events.push({type:'unsupported',reason:`Recording errors: ${this.errors.join('; ')}`});
      await writeFile(`${this.base}.json`, JSON.stringify(recording,null,2), {mode:0o600});
      await writeFile(`${this.base}.mjs`, generate(recording), {mode:0o600});
      return {journal:this.journal, recording:`${this.base}.json`, script:`${this.base}.mjs`, events:events.length, requiredEnv:recording.requiredEnv, errors:this.errors};
    } finally {
      // Playwright disconnects CDP clients without closing the external browser.
      await this.browser.close(); this.browser = null;
    }
  }
}
