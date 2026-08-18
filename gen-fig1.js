// Gera a Figura 1 (heteroestrutura Ti3C2/MoS2) como SVG desenhado com os
// tokens do site e injeta o resultado no index.html, no lugar do bloco
// marcado por <!--FIG1:START--> ... <!--FIG1:END-->.
// Uso: node gen-fig1.js   (depois rode node build.js)
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

const r1 = v => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// materiais: cor de convenção de cada átomo (mesma nos dois temas; é a
// identidade química, não decoração) + gradiente de esfera
// ---------------------------------------------------------------------------
const EL = {
  S:  { hi: '#f6f39a', mid: '#e6e319', lo: '#a8a512' },
  Mo: { hi: '#cfb2cb', mid: '#a883a4', lo: '#77597400'.slice(0, 7) },
  C:  { hi: '#a97e5c', mid: '#724b32', lo: '#4a2f1e' },
  Ti: { hi: '#c4e4f7', mid: '#7bbfec', lo: '#4a86ad' },
  O:  { hi: '#ff8a80', mid: '#f01311', lo: '#a30300' },
};
EL.Mo.lo = '#775974';

function defs(prefix) {
  let out = '<defs>';
  for (const [el, c] of Object.entries(EL)) {
    out += `<radialGradient id="${prefix}${el}" cx="34%" cy="28%" r="80%">` +
           `<stop offset="0" stop-color="${c.hi}"/>` +
           `<stop offset=".55" stop-color="${c.mid}"/>` +
           `<stop offset="1" stop-color="${c.lo}"/></radialGradient>`;
  }
  // setas dos eixos cristalográficos
  for (const [id, cor] of [['aA', '#e05252'], ['aB', '#2fae5e'], ['aC', '#5b8def']]) {
    out += `<marker id="${prefix}${id}" viewBox="0 0 8 8" refX="6.4" refY="4" ` +
           `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
           `<path d="M0 .6 8 4 0 7.4z" fill="${cor}"/></marker>`;
  }
  out += '</defs>';
  return out;
}

const atom = (p, x, y, r, el) =>
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="url(#${p}${el})" stroke="rgba(0,0,0,.28)" stroke-width=".6"/>`;

// eixos cristalográficos (rótulos com a cor da própria seta)
function eixos(p, x, y, modo) {
  const L = 44;
  let s = `<g font-family="ui-monospace, monospace" font-size="13" font-style="italic" font-weight="600">`;
  s += `<circle cx="${x}" cy="${y}" r="3.2" fill="var(--fg-3)"/>`;
  if (modo === 'lado') {
    s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - L}" stroke="#5b8def" stroke-width="2" marker-end="url(#${p}aC)"/>` +
         `<text x="${x - 4}" y="${y - L - 8}" fill="#5b8def">c</text>` +
         `<line x1="${x}" y1="${y}" x2="${x + L}" y2="${y + 12}" stroke="#e05252" stroke-width="2" marker-end="url(#${p}aA)"/>` +
         `<text x="${x + L + 5}" y="${y + 20}" fill="#e05252">a</text>` +
         `<line x1="${x}" y1="${y}" x2="${x - L}" y2="${y + 12}" stroke="#2fae5e" stroke-width="2" marker-end="url(#${p}aB)"/>` +
         `<text x="${x - L - 14}" y="${y + 20}" fill="#2fae5e">b</text>`;
  } else {
    // vista superior: c aponta para fora da tela (ponto)
    s += `<line x1="${x}" y1="${y}" x2="${x + L}" y2="${y - 10}" stroke="#e05252" stroke-width="2" marker-end="url(#${p}aA)"/>` +
         `<text x="${x + L + 5}" y="${y - 6}" fill="#e05252">a</text>` +
         `<line x1="${x}" y1="${y}" x2="${x - L * 0.55}" y2="${y - L * 0.8}" stroke="#2fae5e" stroke-width="2" marker-end="url(#${p}aB)"/>` +
         `<text x="${x - L * 0.55 - 15}" y="${y - L * 0.8 - 4}" fill="#2fae5e">b</text>` +
         `<circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="#5b8def" stroke-width="1.8"/>` +
         `<circle cx="${x}" cy="${y}" r="2.4" fill="#5b8def"/>` +
         `<text x="${x + 11}" y="${y + 15}" fill="#5b8def">c</text>`;
  }
  return s + '</g>';
}

// ---------------------------------------------------------------------------
// painel (a): vista lateral
// ---------------------------------------------------------------------------
function painelLateral() {
  const P = 'fa', W = 640, H = 400;
  const dx = 58, x0 = 64, n = 7;              // 7 átomos por fileira
  const alin = k => x0 + k * dx;              // fileiras alinhadas
  const desl = k => x0 + dx / 2 + k * dx;     // fileiras deslocadas meia célula

  // fileiras de cima para baixo (MoS2, vão de van der Waals, Ti3C2, O)
  const rows = [
    { el: 'S',  y: 58,  off: 0, r: 12 },
    { el: 'Mo', y: 94,  off: 1, r: 15 },
    { el: 'S',  y: 130, off: 0, r: 12 },
    { el: 'Ti', y: 196, off: 1, r: 15 },
    { el: 'C',  y: 232, off: 0, r: 9  },
    { el: 'Ti', y: 268, off: 1, r: 15 },
    { el: 'C',  y: 304, off: 0, r: 9  },
    { el: 'Ti', y: 340, off: 1, r: 15 },
    { el: 'O',  y: 372, off: 0, r: 7  },
  ];
  // ligações só dentro de cada material: o vão entre S(130) e Ti(196) fica
  // vazio de propósito, é a interface de van der Waals
  const pares = [[0, 1], [1, 2], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]];

  let bonds = `<g stroke="var(--fg-2)" stroke-opacity=".38" stroke-width="2.4" stroke-linecap="round">`;
  for (const [i, j] of pares) {
    const a = rows[i], b = rows[j];
    for (let k = 0; k < n; k++) {
      const xb = b.off ? desl(k) : alin(k);
      for (const dk of (a.off === b.off ? [0] : (b.off ? [0, 1] : [-1, 0]))) {
        const ka = k + dk;
        if (ka < 0 || ka >= n) continue;
        const xa = a.off ? desl(ka) : alin(ka);
        if (Math.abs(xa - xb) > dx * 0.6) continue;
        bonds += `<line x1="${r1(xa)}" y1="${a.y}" x2="${r1(xb)}" y2="${b.y}"/>`;
      }
    }
  }
  bonds += '</g>';

  let atoms = '';
  for (const row of rows) {
    for (let k = 0; k < n; k++) {
      atoms += atom(P, row.off ? desl(k) : alin(k), row.y, row.r, row.el);
    }
  }

  // sítios A, B e C sobre a rede (deslocado k=3 => x=267; alinhado k=4 => 296)
  const xL = desl(3), xC = alin(4);
  const badge = (x, y, cor, letra) =>
    `<circle cx="${r1(x)}" cy="${y}" r="12" fill="${cor}" stroke="rgba(255,255,255,.85)" stroke-width="1.6"/>` +
    `<text x="${r1(x)}" y="${y + 4.4}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">${letra}</text>`;
  const sitios =
    `<g font-family="var(--font-sans)">` +
    `<g stroke="var(--fg-2)" stroke-width="1.3" stroke-dasharray="3 5" fill="none">` +
    `<line x1="${r1(xL)}" y1="384" x2="${r1(xL)}" y2="30"/>` +
    `<line x1="${xC}" y1="112" x2="${xC}" y2="46"/>` +
    `</g>` +
    `<line x1="${r1(xL)}" y1="38" x2="${xC}" y2="38" stroke="var(--fg-2)" stroke-width="1.6" ` +
    `marker-start="url(#${P}aN)" marker-end="url(#${P}aN)"/>` +
    badge(xL, 372, '#d8262c', 'A') + badge(xL, 196, '#2242cf', 'B') + badge(xC, 130, '#12a05f', 'C') +
    `</g>`;

  // rótulos verticais dos dois materiais, na voz tipográfica do site
  const lbl = (y, t) =>
    `<text transform="rotate(-90 26 ${y})" x="26" y="${y}" text-anchor="middle" ` +
    `font-family="ui-monospace, monospace" font-size="10.5" letter-spacing="2" fill="var(--fg-3)">${t}</text>`;

  const seta = `<marker id="${P}aN" viewBox="0 0 8 8" refX="6.4" refY="4" markerWidth="6" markerHeight="6" ` +
    `orient="auto-start-reverse"><path d="M0 .6 8 4 0 7.4z" fill="var(--fg-2)"/></marker>`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vista lateral da heteroestrutura: camada de MoS2 com enxofre, molibdênio e enxofre sobre o MXene Ti3C2, três camadas de titânio intercaladas por carbono, com oxigênio na base. Os sítios A, B e C marcam as posições onde a adsorção foi testada.">` +
    defs(P) + seta + bonds + atoms + sitios +
    lbl(94, 'MoS₂') + lbl(268, 'Ti₃C₂') + lbl(372, 'O') +
    `<text x="500" y="132" font-family="ui-monospace, monospace" font-size="9.5" letter-spacing="1.5" fill="var(--fg-3)">INTERFACE</text>` +
    `<line x1="497" y1="145" x2="452" y2="160" stroke="var(--fg-3)" stroke-width="1" stroke-dasharray="2 4"/>` +
    eixos(P, 566, 330, 'lado') +
    '</svg>';
}

// ---------------------------------------------------------------------------
// painel (b): vista superior
// ---------------------------------------------------------------------------
function painelSuperior() {
  const P = 'fb', W = 460, H = 400;   // mesma altura renderizada do painel (a) na grade 58/42
  const d = 44, N = 6;
  // vetores de rede girados -30 graus: o losango fica simétrico na horizontal
  const a1 = [d * Math.cos(Math.PI / 6), -d / 2];
  const a2 = [d * Math.cos(Math.PI / 6), d / 2];
  const O = [230 - N * (a1[0] + a2[0]) / 2, 185];
  const at = (i, j, fx, fy) => [
    O[0] + (i + fx) * a1[0] + (j + fy) * a2[0],
    O[1] + (i + fx) * a1[1] + (j + fy) * a2[1],
  ];

  const cantos = [at(0, 0, 0, 0), at(N, 0, 0, 0), at(N, N, 0, 0), at(0, N, 0, 0)];
  const poly = cantos.map(c => r1(c[0]) + ',' + r1(c[1])).join(' ');

  // malha triangular fina entre os sítios de Ti
  let mesh = `<g stroke="var(--fg-2)" stroke-opacity=".3" stroke-width="1.1">`;
  for (let i = -1; i <= N + 1; i++) for (let j = -1; j <= N + 1; j++) {
    const p = at(i, j, 0, 0);
    for (const [di, dj] of [[1, 0], [0, 1], [1, -1]]) {
      const q = at(i + di, j + dj, 0, 0);
      mesh += `<line x1="${r1(p[0])}" y1="${r1(p[1])}" x2="${r1(q[0])}" y2="${r1(q[1])}"/>`;
    }
  }
  mesh += '</g>';

  // sub-redes: Ti na origem (C projeta sobre o Ti), Mo e S nos dois centros
  let ti = '', mo = '', ss = '', cc = '';
  for (let i = -1; i <= N + 1; i++) for (let j = -1; j <= N + 1; j++) {
    const pTi = at(i, j, 0, 0);
    const pMo = at(i, j, 1 / 3, 1 / 3);   // centro do triângulo "para cima"
    const pS  = at(i, j, 2 / 3, 2 / 3);   // centro do triângulo "para baixo"
    ti += atom(P, pTi[0], pTi[1], 12.5, 'Ti');
    cc += atom(P, pTi[0], pTi[1], 5, 'C');
    ss += atom(P, pS[0], pS[1], 8, 'S');
    mo += atom(P, pMo[0], pMo[1], 12.5, 'Mo');
  }

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vista superior da heteroestrutura: rede hexagonal com os átomos de titânio, carbono, enxofre e molibdênio sobrepostos, recortada pela célula de simulação em forma de losango.">` +
    defs(P) +
    `<clipPath id="${P}clip"><polygon points="${poly}"/></clipPath>` +
    `<g clip-path="url(#${P}clip)">` + mesh + ss + ti + cc + mo + `</g>` +
    `<polygon points="${poly}" fill="none" stroke="var(--fg-3)" stroke-opacity=".65" stroke-width="1.5"/>` +
    eixos(P, 396, 352, 'topo') +
    '</svg>';
}

// ---------------------------------------------------------------------------
// injeção no index.html
// ---------------------------------------------------------------------------
const bloco = `<!--FIG1:START-->
      <div class="mx-fig">
        <div class="mx-panel">
          <span class="plbl" aria-hidden="true">a · vista lateral</span>
          ${painelLateral()}
        </div>
        <div class="mx-panel">
          <span class="plbl" aria-hidden="true">b · vista superior</span>
          ${painelSuperior()}
        </div>
      </div>
      <!--FIG1:END-->`;

const arq = path.join(HERE, 'index.html');
let s = fs.readFileSync(arq, 'utf8');
const RE = /<!--FIG1:START-->[\s\S]*?<!--FIG1:END-->/;
if (!RE.test(s)) throw new Error('marcadores FIG1 nao encontrados no index.html');
s = s.replace(RE, bloco);
fs.writeFileSync(arq, s);
console.log('figura injetada:', (bloco.length / 1024).toFixed(1) + 'KB de SVG');
