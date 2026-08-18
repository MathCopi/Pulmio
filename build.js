// Monta o site: embute a fonte, injeta as paginas do QFD/DFMEA e o PDF,
// e gera a versao fragmento para publicacao.
// Uso: node build.js   (rode render-pdf.py antes, se o PDF mudar)
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const b64 = f => fs.readFileSync(path.join(HERE, f)).toString('base64');

const face = `
/* Inter variável embutida (woff2), o site não depende de rede */
@font-face {
  font-family: 'Inter'; font-style: normal; font-weight: 300 900; font-display: swap;
  src: url(data:font/woff2;base64,${b64('inter-latin.woff2')}) format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
@font-face {
  font-family: 'Inter'; font-style: normal; font-weight: 300 900; font-display: swap;
  src: url(data:font/woff2;base64,${b64('inter-latinext.woff2')}) format('woff2');
  unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;
}
/* Roboto variável embutida: substitui a voz monoespaçada técnica dos
   rótulos (chips, eyebrows, tabelas) por uma leitura mais humana */
@font-face {
  font-family: 'Roboto'; font-style: normal; font-weight: 400 700; font-display: swap;
  src: url(data:font/woff2;base64,${b64('roboto-latin.woff2')}) format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
@font-face {
  font-family: 'Roboto'; font-style: normal; font-weight: 400 700; font-display: swap;
  src: url(data:font/woff2;base64,${b64('roboto-latinext.woff2')}) format('woff2');
  unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;
}
`;

let s = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

// --- fonte embutida (uma vez) ---
s = s.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link href="https:\/\/fonts\.googleapis[^>]*>\s*/g, '');
// remove qualquer @font-face ja embutido antes de reinserir: index.html e'
// mutado em cada rodada, entao um guard "so insere se nao existir" trava a
// primeira versao para sempre e ignora mudancas no bloco `face` (foi o que
// aconteceu ao adicionar a Roboto: o build rodava sem erro e sem efeito)
s = s.replace(/@font-face\s*\{[^}]*\}\s*/g, '');
s = s.replace('<style>', '<style>' + face);

// --- modelo 3D do dispositivo ---
// dev3d.js e' a fonte; aqui ele e' embutido no <script id="dev3d-src">.
const DEV3D = path.join(HERE, 'dev3d.js');
const D3_RE = /(<script id="dev3d-src">)([\s\S]*?)(<\/script>)/;
let d3KB = 0;
if (fs.existsSync(DEV3D)) {
  const src = fs.readFileSync(DEV3D, 'utf8');
  d3KB = Buffer.byteLength(src) / 1024;
  if (!D3_RE.test(s)) throw new Error('marcador <script id="dev3d-src"> nao encontrado');
  s = s.replace(D3_RE, (m, a, _b, c) => a + '\n' + src.trim() + '\n' + c);
} else {
  console.warn('AVISO: dev3d.js nao encontrado, o hero fica so com o SVG');
}

// --- fotos da equipe ---
// pessoas/*.webp ja vem recortado e sem EXIF (gen-avatars.py); so embute.
const PESSOAS_DIR = path.join(HERE, 'pessoas');
const AVATARES = { avEduarda: 'eduarda', avMariana: 'mariana', avMatheus: 'matheus', avThales: 'thales' };
let avKB = 0;
for (const [id, slug] of Object.entries(AVATARES)) {
  const f = path.join(PESSOAS_DIR, slug + '.webp');
  const re = new RegExp('(<img id="' + id + '" src=")[^"]*(")');
  if (!fs.existsSync(f)) { console.warn('AVISO: ' + slug + '.webp nao encontrado, rode gen-avatars.py'); continue; }
  if (!re.test(s)) throw new Error('marcador <img id="' + id + '"> nao encontrado');
  const data = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
  avKB += data.length / 1024;
  s = s.replace(re, (m, a, c) => a + data + c);
}

// --- paginas do QFD/DFMEA + PDF original ---
const PAGES_JSON = path.join(HERE, 'paginas', 'pages.json');
const PDF = path.join(path.dirname(HERE), 'Casa da Qualidade & DFMEA · Pulmio.pdf');
const DV_RE = /(<script type="application\/json" id="dvData">)([\s\S]*?)(<\/script>)/;

let pdfKB = 0;
if (fs.existsSync(PAGES_JSON)) {
  const paginas = JSON.parse(fs.readFileSync(PAGES_JSON, 'utf8'));

  // index.html leva o PDF: ali o download do navegador funciona de verdade
  const comPdf = { paginas };
  if (fs.existsSync(PDF)) {
    const raw = fs.readFileSync(PDF);
    pdfKB = raw.length / 1024;
    comPdf.pdf = 'data:application/pdf;base64,' + raw.toString('base64');
  }
  s = s.replace(DV_RE, (m, a, _b, c) => a + JSON.stringify(comPdf) + c);
} else {
  console.warn('AVISO: paginas/pages.json nao encontrado, rode render-pdf.py');
}

fs.writeFileSync(path.join(HERE, 'index.html'), s);

// --- fragmento para publicacao ---
// Sem o PDF: o sandbox do visualizador bloqueia download, e "pdf" nao esta no
// allowlist da plataforma. O JS esconde o botao quando DATA.pdf nao existe.
let frag = s.replace(DV_RE, (m, a, body, c) => {
  try {
    const o = JSON.parse(body);
    delete o.pdf;
    return a + JSON.stringify(o) + c;
  } catch (e) { return m; }
});

// tira o bloco que monta o link de download: sem ele nao ha nem codigo morto
// oferecendo arquivo, so o visualizador em tela cheia.
frag = frag.replace(/\/\* DL:START[\s\S]*?\/\* DL:END \*\//, '/* sem download na versão publicada */');

const css = frag.match(/<!--CSS:START-->([\s\S]*?)<!--CSS:END-->/)[1];
const bodyHtml = frag.match(/<!--BODY:START-->([\s\S]*?)<!--BODY:END-->/)[1];
fs.writeFileSync(path.join(HERE, 'artifact.html'), '<title>Pulmio</title>\n' + css.trim() + '\n' + bodyHtml.trim() + '\n');

const mb = f => (fs.statSync(path.join(HERE, f)).size / 1024 / 1024).toFixed(2) + 'MB';
console.log('index.html    ', mb('index.html'), pdfKB ? `(inclui PDF de ${pdfKB.toFixed(0)}KB)` : '');
console.log('artifact.html ', mb('artifact.html'), '(sem PDF)');
console.log('modelo 3D    ', d3KB ? d3KB.toFixed(0) + 'KB embutidos' : 'ausente');
console.log('fotos equipe ', avKB ? avKB.toFixed(0) + 'KB embutidas' : 'ausentes');
console.log('refs externas ', (s.match(/fonts\.googleapis|fonts\.gstatic/g) || []).length);
console.log('travessoes    ', (s.match(/—/g) || []).length);
