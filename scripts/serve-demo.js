import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../website/index.html',import.meta.url));
const port = Number(process.env.BROWSER_REPLAY_DEMO_PORT || 4173);
const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
server.on('error',error => {console.error(error.message);process.exitCode = 1;});
server.listen(port,'127.0.0.1',() => console.log(`Demo website: http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close());
