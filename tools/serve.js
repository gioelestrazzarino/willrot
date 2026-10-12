// Tiny static server for local testing of docs/ (used by .claude/launch.json). No dependencies.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root)) return res.writeHead(403).end();
  fs.readFile(f, (err, body) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(8765, '127.0.0.1');
