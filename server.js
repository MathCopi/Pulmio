// Servidor estático mínimo para pré-visualizar o site localmente.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 4321;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // captura de tela vinda da própria página (o painel do navegador não compõe
  // quadros, então não dá para tirar screenshot por fora). Só desenvolvimento.
  if (req.method === 'POST' && url === '/shot') {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => {
      fs.writeFile(path.join(ROOT, 'shot.png'), Buffer.concat(parts), () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      });
    });
    return;
  }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Pulmio em http://localhost:' + PORT));
