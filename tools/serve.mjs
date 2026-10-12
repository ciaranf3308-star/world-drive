// Minimal static server. Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = new URL('../public/', import.meta.url).pathname;
const DATA = new URL('../data/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    if (p === '' || p === 'index.html') p = 'index.html';
    let file, base;
    if (p === 'data/clane-network.json') { base = DATA; file = 'clane-network.json'; }
    else { base = ROOT; file = p; }
    const full = join(base, file);
    if (!full.startsWith(base)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});

const port = parseInt(process.argv[2] || '8123', 10);
server.listen(port, () => console.log(`WORLD DRIVE at http://localhost:${port}/`));
