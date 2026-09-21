import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runProcess } from './process.js';

export async function checkChromium({install = false} = {}) {
  if (install) {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');
    const result = await runProcess(process.execPath,[cli,'install','chromium'],{timeoutMs:180000,maxOutput:1000000});
    if (result.code !== 0) throw new Error(`Chromium installation failed. ${result.timedOut ? 'Download timed out.' : result.stderr || result.stdout}`);
  }
  try {
    // Launch the actual headless browser: executablePath() alone misses a
    // missing headless-shell binary and missing system libraries.
    const browser = await chromium.launch({headless:true,timeout:15000});
    await browser.close();
  } catch(error) {
    throw new Error('Chromium could not start. Run npm run setup -- --install-browser (or npx playwright install chromium). On Linux, missing system libraries may require npx playwright install --with-deps chromium.\n'+error.message);
  }
}
