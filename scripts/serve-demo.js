import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = fileURLToPath(new URL('../website', import.meta.url));
const port = Number(process.env.BROWSER_REPLAY_DEMO_PORT || 4173);
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).pathname;
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
server.on('error',error => {console.error(error.message);process.exitCode = 1;});
server.listen(port,'127.0.0.1',() => console.log(`Demo website: http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close());
