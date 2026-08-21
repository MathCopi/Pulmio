/* =====================================================================
   Modelo 3D conceitual do Pulmio.
   WebGL escrito à mão, sem biblioteca: o site inteiro não faz nenhuma
   requisição externa, e embutir uma engine custaria ~600KB para uma cena
   de nove peças. Aprimoramento progressivo: o SVG do hero continua sendo
   o conteúdo real e só é substituído se o contexto WebGL abrir.
   ===================================================================== */
(function () {
  'use strict';

  var cv = document.getElementById('dev3d');
  if (!cv) return;
  var host = cv.parentNode;

  var gl = null;
  try {
    var attrs = { alpha: true, antialias: true, depth: true, premultipliedAlpha: true };
    gl = cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs);
  } catch (e) { gl = null; }
  if (!gl) return;                       /* fica o SVG */

  /* ---------------------------------------------------------------
     matrizes
     --------------------------------------------------------------- */
  function ident() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }

  function mul(a, b) {                   /* a * b */
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  function trans(x, y, z) { var m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function scal(x, y, z) { var m = ident(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function rotX(a) { var m = ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function rotY(a) { var m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }

  function persp(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[11] = -1;
    o[10] = (f + n) / (n - f); o[14] = 2 * f * n / (n - f);
    return o;
  }

  function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }

  function lookAt(e, c, up) {
    var z = norm3([e[0] - c[0], e[1] - c[1], e[2] - c[2]]);
    var x = norm3(cross3(up, z));
    var y = cross3(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]),
      -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]),
      -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1
    ]);
  }

  /* normal matrix = transposta da inversa do bloco 3x3 (há escalas não uniformes) */
  function nrmMat(m) {
    var a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    var A = e*i - f*h, B = f*g - d*i, C = d*h - e*g;
    var det = a*A + b*B + c*C;
    if (!det) return new Float32Array([1,0,0, 0,1,0, 0,0,1]);
    var id = 1 / det;
    return new Float32Array([
      A*id, B*id, C*id,
      (c*h - b*i)*id, (a*i - c*g)*id, (b*g - a*h)*id,
      (b*f - c*e)*id, (c*d - a*f)*id, (a*e - b*d)*id
    ]);
  }

  /* ---------------------------------------------------------------
     shaders
     --------------------------------------------------------------- */
  var VS = [
    'attribute vec3 aPos; attribute vec3 aNor;',
    'uniform mat4 uProj, uView, uModel; uniform mat3 uNor;',
    'varying vec3 vN, vW, vL;',
    'void main(){',
    '  vL = aPos;',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vW = w.xyz;',
    '  vN = uNor * aNor;',
    '  gl_Position = uProj * uView * w;',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying vec3 vN, vW, vL;',
    'uniform vec3 uAlbedo, uEmis, uSky, uGnd, uKeyC, uFillC, uRimC, uCam, uShadowC;',
    'uniform vec3 uKeyD, uFillD, uRimD;',
    'uniform float uRough, uSpec, uOpacity, uParting, uTex, uTrans, uMode, uEmisI, uAoY, uFaceZ;',
    'uniform vec4 uRect;',
    'uniform sampler2D uMap;',

    'vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }',

    'void main(){',
    /* sombra de contato: elipse com queda radial */
    '  if (uMode > 1.5) {',
    '    float d = length(vL.xz);',
    '    float a = pow(1.0 - smoothstep(0.0, 1.0, d), 2.2) * uOpacity;',
    '    gl_FragColor = vec4(uShadowC * a, a);',
    '    return;',
    '  }',

    '  vec3 N = normalize(vN);',
    '  if (!gl_FrontFacing) N = -N;',
    '  vec3 V = normalize(uCam - vW);',

    '  vec3 alb = uAlbedo;',
    '  vec3 emis = uEmis; float emisI = uEmisI;',

    /* textura projetada na face frontal (tela, wordmark) */
    '  if (uTex > 0.5) {',
    '    vec2 uv = (vL.xy - uRect.xy) / uRect.zw;',
    '    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);',
    '    float face = smoothstep(0.80, 0.98, N.z * uFaceZ);',
    '    vec4 t = texture2D(uMap, clamp(uv, 0.0, 1.0));',
    '    float m = inside * face * t.a;',
    '    alb = mix(alb, t.rgb, m);',
    '    emis = t.rgb; emisI = uEmisI * m;',
    '  }',

    /* linha de partição da carcaça (peça injetada em duas metades) */
    '  if (uParting > 0.5) {',
    '    float pl = smoothstep(0.075, 0.015, abs(vL.z)) * (1.0 - abs(N.z));',
    '    alb *= 1.0 - 0.42 * pl;',
    '  }',

    /* modo sem iluminação (barra de status) */
    '  if (uMode > 0.5) {',
    '    vec3 c = emis * emisI;',
    '    c += emis * pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.6;',
    '    gl_FragColor = vec4(aces(c) * uOpacity, uOpacity);',
    '    return;',
    '  }',

    '  float sh = mix(160.0, 5.0, uRough);',
    '  float ao = mix(0.52, 1.0, smoothstep(uAoY - 4.2, uAoY + 1.6, vW.y));',
    '  float ndv = max(dot(N, V), 0.0);',

    /* ambiente hemisférico */
    '  vec3 lit = alb * mix(uGnd, uSky, N.y * 0.5 + 0.5) * ao;',

    /* principal */
    '  float ndl = max(dot(N, uKeyD), 0.0);',
    '  vec3 H = normalize(uKeyD + V);',
    '  float spc = pow(max(dot(N, H), 0.0), sh) * uSpec * (0.35 + 2.6 * pow(1.0 - ndv, 4.0));',
    '  lit += alb * uKeyC * ndl * ao;',
    '  lit += uKeyC * spc * ndl;',

    /* preenchimento */
    '  lit += alb * uFillC * max(dot(N, uFillD), 0.0) * ao;',
    '  vec3 H2 = normalize(uFillD + V);',
    '  lit += uFillC * pow(max(dot(N, H2), 0.0), sh) * uSpec * 0.35;',

    /* contraluz + fresnel de borda */
    '  float fres = pow(1.0 - ndv, 3.4);',
    /* a contraluz é presa ao fresnel: senão ela inunda a face de trás
       inteira em vez de desenhar só a borda */
    '  lit += uRimC * pow(max(dot(N, uRimD), 0.0), 2.0) * fres * 1.7;',
    '  lit += uRimC * fres * 0.22;',

    /* translucência do bocal */
    '  if (uTrans > 0.0) {',
    '    lit += alb * uKeyC * pow(max(dot(-N, uKeyD), 0.0), 1.4) * uTrans;',
    '    lit += alb * uSky * uTrans * 0.7;',
    '  }',

    '  lit += emis * emisI;',
    '  gl_FragColor = vec4(pow(aces(lit), vec3(1.0 / 2.2)) * uOpacity, uOpacity);',
    '}'
  ].join('\n');

  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  var prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { return; }                /* fica o SVG */
  gl.useProgram(prog);

  var U = {};
  ['uProj','uView','uModel','uNor','uAlbedo','uEmis','uSky','uGnd','uKeyC','uFillC','uRimC',
   'uCam','uShadowC','uKeyD','uFillD','uRimD','uRough','uSpec','uOpacity','uParting','uTex',
   'uTrans','uMode','uEmisI','uAoY','uFaceZ','uRect','uMap'].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });
  var aPos = gl.getAttribLocation(prog, 'aPos');
  var aNor = gl.getAttribLocation(prog, 'aNor');

  /* ---------------------------------------------------------------
     geometria
     --------------------------------------------------------------- */
  function upload(pos, nor, idx) {
    var g = { p: gl.createBuffer(), n: gl.createBuffer(), i: gl.createBuffer(),
              c: idx.length, t: gl.UNSIGNED_SHORT };
    gl.bindBuffer(gl.ARRAY_BUFFER, g.p); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.i);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    return g;
  }

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* caixa arredondada: cubo subdividido projetado sobre a caixa interna + raio */
  function roundedBox(w, h, d, r, seg) {
    var ex = w / 2, ey = h / 2, ez = d / 2;
    r = Math.min(r, ex, ey, ez);
    var ix = ex - r, iy = ey - r, iz = ez - r;
    var pos = [], nor = [], idx = [], base = 0, i, j;
    var faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    for (var f = 0; f < 6; f++) {
      var ax = faces[f][0], sg = faces[f][1], u = (ax + 1) % 3, v = (ax + 2) % 3;
      for (j = 0; j <= seg; j++) for (i = 0; i <= seg; i++) {
        var p = [0, 0, 0];
        p[ax] = sg; p[u] = i / seg * 2 - 1; p[v] = j / seg * 2 - 1;
        var Px = p[0] * ex, Py = p[1] * ey, Pz = p[2] * ez;
        var Cx = cl(Px, -ix, ix), Cy = cl(Py, -iy, iy), Cz = cl(Pz, -iz, iz);
        var nx = Px - Cx, ny = Py - Cy, nz = Pz - Cz;
        var L = Math.hypot(nx, ny, nz) || 1;
        nx /= L; ny /= L; nz /= L;
        pos.push(Cx + nx * r, Cy + ny * r, Cz + nz * r);
        nor.push(nx, ny, nz);
      }
      for (j = 0; j < seg; j++) for (i = 0; i < seg; i++) {
        var a = base + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, dd = c + 1;
        if (sg > 0) idx.push(a, b, c, b, dd, c); else idx.push(a, c, b, b, c, dd);
      }
      base += (seg + 1) * (seg + 1);
    }
    return upload(pos, nor, idx);
  }

  /* revolução em torno de Y. O perfil é percorrido com o material à esquerda:
     a normal é a tangente girada -90°, ou seja (dy, -dr), apontando para fora. */
  function lathe(prof, seg, closed, sx) {
    sx = sx || 1;
    var n = prof.length, pos = [], nor = [], idx = [], tan = [], i, j;
    for (i = 0; i < n; i++) {
      var a = closed ? prof[(i - 1 + n) % n] : prof[Math.max(i - 1, 0)];
      var b = closed ? prof[(i + 1) % n] : prof[Math.min(i + 1, n - 1)];
      var dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
      tan.push([dr / l, dy / l]);
    }
    for (i = 0; i < n; i++) for (j = 0; j <= seg; j++) {
      var th = j / seg * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      pos.push(prof[i][0] * c * sx, prof[i][1], prof[i][0] * s);
      var nr = tan[i][1], ny = -tan[i][0];
      var nx = nr * c / sx, nz = nr * s;
      var L = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / L, ny / L, nz / L);
    }
    var rows = closed ? n : n - 1;
    for (i = 0; i < rows; i++) {
      var i2 = (i + 1) % n;
      for (j = 0; j < seg; j++) {
        var A = i * (seg + 1) + j, B = A + 1, C = i2 * (seg + 1) + j, D = C + 1;
        idx.push(A, C, B, B, C, D);
      }
    }
    return upload(pos, nor, idx);
  }

  /* retângulo arredondado plano, normal +Z, coordenadas locais = as do retângulo */
  function roundedPlane(w, h, r, seg) {
    var ex = w / 2, ey = h / 2, k;
    r = Math.min(r, ex, ey);
    var pts = [];
    var corners = [[ex - r, ey - r, 0], [-ex + r, ey - r, Math.PI / 2],
                   [-ex + r, -ey + r, Math.PI], [ex - r, -ey + r, -Math.PI / 2]];
    for (var c = 0; c < 4; c++) for (k = 0; k <= seg; k++) {
      var a = corners[c][2] + k / seg * Math.PI / 2;
      pts.push([corners[c][0] + Math.cos(a) * r, corners[c][1] + Math.sin(a) * r]);
    }
    var pos = [0, 0, 0], nor = [0, 0, 1], idx = [];
    for (k = 0; k < pts.length; k++) { pos.push(pts[k][0], pts[k][1], 0); nor.push(0, 0, 1); }
    for (k = 0; k < pts.length; k++) idx.push(0, k + 1, ((k + 1) % pts.length) + 1);
    return upload(pos, nor, idx);
  }

  function disc(seg) {
    var pos = [0, 0, 0], nor = [0, 1, 0], idx = [], i;
    for (i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2;
      pos.push(Math.cos(a), 0, Math.sin(a)); nor.push(0, 1, 0);
    }
    for (i = 0; i < seg; i++) idx.push(0, i + 1, i + 2);
    return upload(pos, nor, idx);
  }

  function ring(R, t, y0, seg, sx, tube) {
    var prof = [];
    for (var i = 0; i < tube; i++) {
      var a = i / tube * Math.PI * 2;
      prof.push([R + Math.cos(a) * t, y0 + Math.sin(a) * t]);
    }
    return lathe(prof, seg, true, sx);
  }

  /* ---------------------------------------------------------------
     peças  (~50 x 115 x 26 mm)
     --------------------------------------------------------------- */
  var BW = 6.0, BH = 11.6, BD = 2.7, FRONT = BD / 2;
  var G = {};

  /* o raio precisa deixar uma face frontal plana maior que a tela,
     senão a moldura afunda no arredondamento do ombro */
  G.body   = roundedBox(BW, BH, BD, 0.92, 24);
  G.bezel  = roundedBox(4.10, 4.10, 0.28, 0.54, 10);
  G.glass  = roundedBox(3.84, 3.84, 0.32, 0.44, 12);
  G.plate  = roundedPlane(2.40, 0.46, 0.08, 3);
  G.vent   = roundedPlane(2.70, 0.86, 0.30, 4);
  G.label  = roundedPlane(3.70, 4.90, 0.42, 4);
  G.barLed = roundedPlane(2.80, 0.15, 0.075, 3);
  G.shadow = disc(56);

  /* saliência onde o bocal encaixa */
  G.boss = lathe([
    [0.00, 0.00], [1.32, 0.00], [1.34, 0.18], [1.30, 0.62], [1.16, 0.86], [0.00, 0.86]
  ], 48, false, 1.30);

  /* anel de travamento do bocal */
  G.collar = ring(1.26, 0.13, 0.80, 48, 1.30, 18);

  /* bocal descartável: parede externa, lábio e parede interna, fundo fechado */
  G.mouth = lathe([
    [0.80, 0.00], [1.16, 0.00], [1.18, 0.16], [1.16, 0.34], [1.05, 0.66],
    [0.975, 2.10], [0.925, 3.90], [0.905, 5.05], [0.945, 5.36], [0.870, 5.50],
    [0.800, 5.34], [0.805, 4.00], [0.845, 1.60], [0.875, 0.34]
  ], 56, true, 1.26);

  /* botão: do centro da base para fora, sobe e fecha no topo */
  G.button  = lathe([
    [0.00, 0.00], [0.54, 0.00], [0.56, 0.09], [0.54, 0.18], [0.45, 0.25], [0.00, 0.26]
  ], 40, false, 1);
  G.btnRing = ring(0.70, 0.05, 0.05, 44, 1, 14);

  /* ---------------------------------------------------------------
     textura da tela (canvas 2D, potência de dois para gerar mipmaps)
     --------------------------------------------------------------- */
  var TX = 512;
  var sc = document.createElement('canvas');
  sc.width = sc.height = TX;
  var s2 = sc.getContext('2d');

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var wtex = gl.createTexture();       /* wordmark */
  var vtex = gl.createTexture();       /* grelha de exaustão */
  var ltex = gl.createTexture();       /* etiqueta do verso */
  var MONO = "ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Consolas, monospace";
  var SANS = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

  /* fórmula química com os índices rebaixados */
  function formula(c, txt, x, y, size) {
    var cx = x;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt.charAt(i), sub = ch >= '0' && ch <= '9';
      c.font = '600 ' + Math.round(size * (sub ? 0.72 : 1)) + 'px ' + MONO;
      c.fillText(ch, cx, y + (sub ? size * 0.16 : 0));
      cx += c.measureText(ch).width;
    }
  }

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
    c.closePath();
  }

  function ls(c, v) { try { c.letterSpacing = v; } catch (e) {} }

  var CANAIS = [['NH3', 0.74], ['C7H8', 0.46], ['C2H5OH', 0.61]];

  function drawScreen(t, accent, second) {
    var c = s2, W = TX;
    c.setTransform(1, 0, 0, 1, 0, 0);
    ls(c, '0px');
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';

    var bg = c.createLinearGradient(0, 0, 0, W);
    bg.addColorStop(0, '#0a1720'); bg.addColorStop(1, '#040b11');
    c.fillStyle = bg; c.fillRect(0, 0, W, W);

    var vg = c.createRadialGradient(W * 0.32, W * 0.22, 10, W * 0.5, W * 0.5, W * 0.8);
    vg.addColorStop(0, 'rgba(255,255,255,.055)'); vg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = vg; c.fillRect(0, 0, W, W);

    /* barra superior */
    c.font = '600 22px ' + MONO; ls(c, '4px');
    c.fillStyle = 'rgba(255,255,255,.42)';
    c.fillText('PULMIO', 34, 52);
    c.fillStyle = accent; c.textAlign = 'right';
    c.fillText('CONCEITO', W - 34, 52);
    c.textAlign = 'left'; ls(c, '0px');
    c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(34, 70); c.lineTo(W - 34, 70); c.stroke();

    /* onda de sopro */
    var y0 = 172, amp = 48;
    c.strokeStyle = 'rgba(255,255,255,.07)';
    c.beginPath(); c.moveTo(34, y0); c.lineTo(W - 34, y0); c.stroke();

    c.save();
    c.beginPath(); c.rect(34, y0 - 76, W - 68, 152); c.clip();
    c.strokeStyle = accent; c.lineWidth = 4.5;
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.shadowColor = accent; c.shadowBlur = 16;
    c.beginPath();
    for (var x = 0; x <= W - 68; x += 4) {
      var u = x / (W - 68), p = u * 9.0 - t * 1.9;
      var env = Math.exp(-Math.pow((u - 0.42) * 2.5, 2)) * 0.85 + 0.15;
      var y = y0 - (Math.sin(p) * 0.62 + Math.sin(p * 2.31 + 1.1) * 0.26 +
                    Math.sin(p * 4.7 + 2.3) * 0.12) * amp * env;
      if (x === 0) c.moveTo(34 + x, y); else c.lineTo(34 + x, y);
    }
    c.stroke();
    c.restore();
    c.shadowBlur = 0;

    /* estado e progresso, ciclo de 7 s */
    var cyc = t % 7, prog = Math.min(cyc / 5.2, 1), done = cyc > 5.4;
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.font = '600 20px ' + MONO; ls(c, '3px');
    c.fillText(done ? 'AMOSTRA REGISTRADA' : 'COLETANDO AMOSTRA', 34, 272);
    ls(c, '0px');

    c.fillStyle = 'rgba(255,255,255,.10)';
    rr(c, 34, 288, W - 68, 12, 6); c.fill();
    c.fillStyle = accent;
    rr(c, 34, 288, (W - 68) * (done ? 1 : prog), 12, 6); c.fill();

    /* canais do sensor */
    var by = 348;
    for (var i = 0; i < CANAIS.length; i++) {
      var lvl = CANAIS[i][1] * (done ? 1 : prog) * (0.9 + 0.1 * Math.sin(t * 2.2 + i * 1.7));
      c.fillStyle = 'rgba(255,255,255,.50)';
      formula(c, CANAIS[i][0], 34, by + 15, 21);
      c.fillStyle = 'rgba(255,255,255,.08)';
      rr(c, 180, by + 2, W - 214, 16, 8); c.fill();
      var gr = c.createLinearGradient(180, 0, W - 34, 0);
      gr.addColorStop(0, accent); gr.addColorStop(1, second);
      c.fillStyle = gr;
      rr(c, 180, by + 2, (W - 214) * lvl, 16, 8); c.fill();
      by += 40;
    }

    /* a interface é ilustrativa, e a tela diz isso */
    c.fillStyle = 'rgba(255,255,255,.26)';
    c.font = '500 16px ' + MONO; ls(c, '2px');
    c.fillText('INTERFACE ILUSTRATIVA', 34, W - 30);
    ls(c, '0px');

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sc);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  function drawWordmark(ink) {
    var w = 512, h = 128;
    var wc = document.createElement('canvas');
    wc.width = w; wc.height = h;
    var c = wc.getContext('2d');
    c.clearRect(0, 0, w, h);
    c.fillStyle = ink;
    c.font = '600 62px ' + SANS;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    ls(c, '11px');
    c.fillText('PULMIO', w / 2 + 6, h / 2 + 2);
    gl.bindTexture(gl.TEXTURE_2D, wtex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /* grelha de exaustão: o ar analisado precisa sair em algum lugar */
  function drawVent(dot) {
    var w = 512, h = 164, cols = 17, rows = 5;
    var vc = document.createElement('canvas');
    vc.width = w; vc.height = h;
    var c = vc.getContext('2d');
    c.clearRect(0, 0, w, h);
    c.fillStyle = dot;
    var dx = w / (cols + 1), dy = h / (rows + 1);
    for (var r = 1; r <= rows; r++) for (var q = 1; q <= cols; q++) {
      var off = (r % 2) ? 0 : dx / 2;
      var x = q * dx + off;
      if (x > w - dx * 0.4) continue;
      c.beginPath();
      c.arc(x, r * dy, 6.4, 0, Math.PI * 2);
      c.fill();
    }
    gl.bindTexture(gl.TEXTURE_2D, vtex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /* etiqueta do verso. Quem girar o modelo encontra o mesmo aviso que o
     site faz por escrito: isto é um conceito, não um produto. */
  function drawLabel(ink, faint, accent) {
    var w = 512, h = 678;
    var lc = document.createElement('canvas');
    lc.width = w; lc.height = h;
    var c = lc.getContext('2d');
    c.clearRect(0, 0, w, h);

    c.strokeStyle = faint; c.lineWidth = 3;
    rr(c, 26, 26, w - 52, h - 52, 46); c.stroke();

    c.textAlign = 'center';
    c.fillStyle = ink;
    c.font = '600 54px ' + SANS; ls(c, '10px');
    c.fillText('PULMIO', w / 2 + 5, 132);

    ls(c, '3px');
    c.font = '600 21px ' + MONO;
    c.fillStyle = accent;
    c.fillText('MODELO CONCEITUAL', w / 2, 186);

    c.fillStyle = faint;
    c.font = '500 19px ' + MONO; ls(c, '1.5px');
    var linhas = [
      'SENSOR QUIMIORRESISTIVO',
      'HETEROESTRUTURA Ti3C2 / MoS2',
      '',
      'PROVA DE CONCEITO',
      'SEM PROTOTIPO FISICO',
      '',
      'UNESP BAURU',
      'ENGENHARIA DE PRODUCAO'
    ];
    for (var i = 0; i < linhas.length; i++) c.fillText(linhas[i], w / 2, 258 + i * 34);

    c.beginPath(); c.moveTo(90, h - 132); c.lineTo(w - 90, h - 132);
    c.strokeStyle = faint; c.lineWidth = 2; c.stroke();

    /* código de barras decorativo, sem representar identificador real */
    var x = 118, seed = 7;
    while (x < w - 118) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var bw = 2 + (seed >> 16) % 5;
      c.fillStyle = faint;
      c.fillRect(x, h - 108, bw, 46);
      x += bw + 3 + (seed >> 8) % 4;
    }
    ls(c, '0px');
    c.textAlign = 'left';

    gl.bindTexture(gl.TEXTURE_2D, ltex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /* ---------------------------------------------------------------
     tema: as cores da cena saem dos mesmos tokens do site
     --------------------------------------------------------------- */
  function hex(v, fb) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((v || '').trim());
    if (!m) return fb;
    var s = m[1];
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255,
            parseInt(s.slice(4, 6), 16) / 255];
  }
  function lin(c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }
  function mulc(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function hexstr(c) {
    var o = '#';
    for (var i = 0; i < 3; i++) {
      var s = Math.round(cl(c[i], 0, 1) * 255).toString(16);
      o += s.length < 2 ? '0' + s : s;
    }
    return o;
  }

  var TH = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var pri = hex(cs.getPropertyValue('--primary'), light ? [0.02, 0.47, 0.42] : [0.09, 0.83, 0.73]);
    var sec = hex(cs.getPropertyValue('--secondary'), [0.36, 0.62, 1]);
    var bg  = hex(cs.getPropertyValue('--bg'), light ? [0.95, 0.96, 0.97] : [0.02, 0.04, 0.05]);

    /* no tema claro os tokens são escurecidos para servirem de texto AA;
       na cena precisam voltar a brilhar, senão o acento some no plástico */
    var priL = light ? mulc(pri, 1.95) : pri;
    var secL = light ? mulc(sec, 1.50) : sec;

    TH.light      = light;
    TH.accent     = priL;
    TH.accentHex  = hexstr(light ? mulc(pri, 1.75) : pri);
    TH.secondHex  = hexstr(light ? mulc(sec, 1.35) : sec);
    TH.shell      = light ? [0.895, 0.912, 0.925] : [0.90, 0.925, 0.938];
    TH.shellDark  = light ? [0.15, 0.19, 0.22] : [0.10, 0.13, 0.155];
    /* valores já em espaço linear: o ambiente é a luz de estúdio ao redor,
       não uma cor de tela */
    TH.sky        = light ? [0.60, 0.665, 0.735] : [0.150, 0.200, 0.245];
    TH.gnd        = light ? [0.22, 0.26, 0.31] : lin(mulc(bg, 3.2));
    TH.key        = light ? [1.14, 1.13, 1.10] : [1.10, 1.10, 1.08];
    TH.fill       = light ? [0.34, 0.40, 0.47] : [0.24, 0.31, 0.40];
    TH.rim        = mulc([priL[0] * 0.55 + secL[0] * 0.3, priL[1] * 0.55 + secL[1] * 0.3,
                          priL[2] * 0.55 + secL[2] * 0.3], light ? 0.5 : 1.15);
    TH.shadow     = light ? [0.04, 0.10, 0.13] : [0, 0, 0];
    TH.shadowA    = light ? 0.34 : 0.62;
    drawWordmark(light ? 'rgba(66,90,102,.85)' : 'rgba(104,128,142,.85)');
    drawVent(light ? 'rgba(46,66,78,.80)' : 'rgba(30,44,54,.85)');
    drawLabel(light ? 'rgba(58,82,94,.9)' : 'rgba(92,116,130,.9)',
              light ? 'rgba(96,120,132,.65)' : 'rgba(120,144,158,.6)',
              TH.accentHex);
  }
  readTheme();

  /* ---------------------------------------------------------------
     desenho
     --------------------------------------------------------------- */
  var KEYD  = norm3([0.52, 0.66, 0.54]);
  /* o preenchimento vem de trás e da esquerda: sem isso o verso do
     aparelho fica um vazio preto quando o usuário gira o modelo */
  var FILLD = norm3([-0.80, 0.18, -0.34]);
  var RIMD  = norm3([-0.22, 0.34, -0.92]);

  var DEF = { rough: 0.42, spec: 0.55, opacity: 1, parting: 0, trans: 0, faceZ: 1,
              mode: 0, emis: [0, 0, 0], emisI: 0, tex: 0, rect: [0, 0, 1, 1] };

  function draw(g, model, m) {
    m = m || {};
    function v(k) { return m[k] === undefined ? DEF[k] : m[k]; }
    gl.uniformMatrix4fv(U.uModel, false, model);
    gl.uniformMatrix3fv(U.uNor, false, nrmMat(model));
    gl.uniform3fv(U.uAlbedo, m.albedo || TH.shell);
    gl.uniform3fv(U.uEmis, v('emis'));
    gl.uniform1f(U.uEmisI, v('emisI'));
    gl.uniform1f(U.uRough, v('rough'));
    gl.uniform1f(U.uSpec, v('spec'));
    gl.uniform1f(U.uOpacity, v('opacity'));
    gl.uniform1f(U.uParting, v('parting'));
    gl.uniform1f(U.uTrans, v('trans'));
    gl.uniform1f(U.uMode, v('mode'));
    gl.uniform1f(U.uTex, v('tex'));
    gl.uniform1f(U.uFaceZ, v('faceZ'));
    gl.uniform4fv(U.uRect, v('rect'));
    gl.bindBuffer(gl.ARRAY_BUFFER, g.p); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.n); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.i);
    gl.drawElements(gl.TRIANGLES, g.c, g.t, 0);
  }

  var yaw = -0.44, pitch = 0.11;
  var manual = false, idleAt = 0, dragging = false, px = 0, py = 0;
  /* zoom: a camera se aproxima dividindo a distancia base. O padrao ja
     enquadra o aparelho maior do que o enquadramento original. */
  /* ZDEF medido: e' o enquadramento maior que ainda deixa folga em todos
     os angulos alcancaveis pelo arrasto (a sombra de contato encostava na
     borda de baixo a partir de 1.18). */
  var BASE = 44, ZMIN = 0.85, ZMAX = 2.4, ZDEF = 1.12, zoom = ZDEF, zoomSync = null;
  var t0 = performance.now(), tNow = 0, texT = -1;
  var DPR = 1, cw = 0, ch = 0;

  function resize() {
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    DPR = Math.min(window.devicePixelRatio || 1, w < 380 ? 1.5 : 2);
    var nw = Math.round(w * DPR), nh = Math.round(h * DPR);
    cw = w; ch = h;
    if (nw !== cv.width || nh !== cv.height) { cv.width = nw; cv.height = nh; }
    return true;
  }

  function render() {
    if (!resize()) return;
    /* o tempo vem do relógio, não do laço: assim um quadro forçado por
       redimensionamento ou troca de tema não congela a animação */
    var t = tNow = (performance.now() - t0) / 1000;

    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aNor);

    if (t - texT > 0.083) { texT = t; drawScreen(t, TH.accentHex, TH.secondHex); }

    /* a órbita oscila em torno da frente em vez de girar 360°,
       assim a tela nunca sai de vista */
    if (!manual) {
      yaw += ((-0.44 + Math.sin(t * 0.19) * 0.52) - yaw) * 0.035;
      pitch += (0.11 - pitch) * 0.035;
    } else if (!dragging && t - idleAt > 3.5) {
      manual = false;
    }

    var dist = BASE / zoom;
    var eye = [Math.sin(yaw) * Math.cos(pitch) * dist,
               Math.sin(pitch) * dist + 1.0,
               Math.cos(yaw) * Math.cos(pitch) * dist];

    gl.uniformMatrix4fv(U.uProj, false, persp(30 * Math.PI / 180, cw / ch, 1, 200));
    gl.uniformMatrix4fv(U.uView, false, lookAt(eye, [0, 1.0, 0], [0, 1, 0]));
    gl.uniform3fv(U.uCam, eye);
    gl.uniform3fv(U.uSky, TH.sky);
    gl.uniform3fv(U.uGnd, TH.gnd);
    gl.uniform3fv(U.uKeyC, TH.key);
    gl.uniform3fv(U.uFillC, TH.fill);
    gl.uniform3fv(U.uRimC, TH.rim);
    gl.uniform3fv(U.uShadowC, TH.shadow);
    gl.uniform3fv(U.uKeyD, KEYD);
    gl.uniform3fv(U.uFillD, FILLD);
    gl.uniform3fv(U.uRimD, RIMD);
    gl.uniform1i(U.uMap, 0);
    gl.activeTexture(gl.TEXTURE0);

    /* o aparelho flutua; a sombra fica no chão e responde à altura */
    var bob = Math.sin(t * 0.62) * 0.42;
    var root = trans(0, -1.1 + bob, 0);
    gl.uniform1f(U.uAoY, -1.1 + bob - BH / 2);

    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.depthMask(false);
    var ss = 1 - bob * 0.055;
    draw(G.shadow, mul(trans(0, -8.1, 0), scal(5.3 * ss, 1, 3.3 * ss)),
         { mode: 2, opacity: TH.shadowA * (1 - Math.abs(bob) * 0.14) });
    gl.depthMask(true);

    draw(G.body, root, { albedo: TH.shell, rough: 0.40, spec: 0.62, parting: 1 });

    draw(G.bezel, mul(root, trans(0, 2.20, FRONT - 0.26)),
         { albedo: TH.shellDark, rough: 0.55, spec: 0.35 });
    draw(G.glass, mul(root, trans(0, 2.20, FRONT - 0.12)),
         { albedo: [0.020, 0.032, 0.042], rough: 0.05, spec: 1.25, tex: 1,
           rect: [-1.53, -1.53, 3.06, 3.06], emisI: TH.light ? 1.05 : 1.25 });

    gl.bindTexture(gl.TEXTURE_2D, wtex);
    draw(G.plate, mul(root, trans(0, -0.40, FRONT + 0.006)),
         { albedo: TH.shell, rough: 0.5, spec: 0.3, tex: 1,
           rect: [-1.20, -0.23, 2.40, 0.46], emisI: 0 });

    gl.bindTexture(gl.TEXTURE_2D, ltex);
    draw(G.label, mul(root, mul(trans(0, 0.30, -FRONT - 0.006), rotY(Math.PI))),
         { albedo: TH.shell, rough: 0.55, spec: 0.28, tex: 1, faceZ: -1,
           rect: [-1.85, -2.45, 3.70, 4.90], emisI: 0 });

    gl.bindTexture(gl.TEXTURE_2D, vtex);
    draw(G.vent, mul(root, trans(0, -3.62, FRONT + 0.006)),
         { albedo: TH.shell, rough: 0.55, spec: 0.28, tex: 1,
           rect: [-1.35, -0.43, 2.70, 0.86], emisI: 0 });

    gl.bindTexture(gl.TEXTURE_2D, tex);
    draw(G.button, mul(root, mul(trans(0, -2.00, FRONT - 0.12), rotX(Math.PI / 2))),
         { albedo: [TH.shell[0] * 0.80, TH.shell[1] * 0.82, TH.shell[2] * 0.84],
           rough: 0.30, spec: 0.85 });
    draw(G.btnRing, mul(root, mul(trans(0, -2.00, FRONT - 0.04), rotX(Math.PI / 2))),
         { albedo: TH.accent, rough: 0.26, spec: 0.9, emis: TH.accent, emisI: 0.14 });

    draw(G.barLed, mul(root, trans(0, -4.70, FRONT + 0.008)),
         { mode: 1, emis: TH.accent, emisI: 0.75 + 0.25 * Math.sin(t * 2.1) });

    /* encaixe e anel do bocal, inclinados 14° para a frente */
    var tilt = mul(trans(0, 4.76, -0.12), rotX(0.245));
    draw(G.boss, mul(root, tilt), { albedo: TH.shell, rough: 0.45, spec: 0.5 });
    draw(G.collar, mul(root, tilt), { albedo: TH.accent, rough: 0.26, spec: 0.95 });

    /* bocal translúcido por último e sem escrever profundidade */
    gl.depthMask(false);
    draw(G.mouth, mul(root, mul(tilt, trans(0, 0.62, 0))),
         { albedo: [0.80, 0.87, 0.91], rough: 0.42, spec: 0.85, opacity: 0.60, trans: 0.55 });
    gl.depthMask(true);
  }

  /* ---------------------------------------------------------------
     laço e interação
     --------------------------------------------------------------- */
  /* `livre` e' desligado por quem cobre a cena (hoje, o menu do celular):
     um canvas que se redesenha atras de um painel que esta abrindo disputa
     GPU com a animacao do painel, e o modelo nem esta sendo olhado. */
  var running = true, visible = true, livre = true, raf = 0;

  function frame() {
    raf = 0;
    if (running && visible && livre) { render(); raf = requestAnimationFrame(frame); }
  }
  function start() { if (!raf && running && visible && livre) raf = requestAnimationFrame(frame); }

  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) start();
  });

  /* só pausa se o observador disser que saiu da tela; se nunca disparar,
     a cena continua rodando */
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) start();
    }, { rootMargin: '140px' }).observe(cv);
  }
  if (window.ResizeObserver) new ResizeObserver(function () { render(); }).observe(host);

  function grab(e) {
    dragging = true; manual = true;
    px = e.clientX; py = e.clientY;
    host.classList.add('dragging');
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function move(e) {
    if (!dragging) return;
    yaw -= (e.clientX - px) * 0.008;
    pitch = cl(pitch + (e.clientY - py) * 0.006, -0.55, 0.75);
    px = e.clientX; py = e.clientY;
    idleAt = tNow;
    start();
  }
  function drop(e) {
    if (!dragging) return;
    dragging = false; idleAt = tNow;
    host.classList.remove('dragging');
    try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  cv.addEventListener('pointerdown', grab);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', drop);
  cv.addEventListener('pointercancel', drop);

  /* ----------------------------- zoom -----------------------------
     A roda do mouse sozinha NAO aproxima: o modelo fica no alto da
     pagina, e capturar a rolagem ali prenderia quem so quer descer.
     Aproximar pede intencao: os botoes, pinca, teclas +/- ou ctrl+roda. */
  function setZoom(z, motivo) {
    var antes = zoom;
    zoom = cl(z, ZMIN, ZMAX);
    if (zoom === antes) return false;
    manual = true; idleAt = tNow;
    if (motivo !== 'silencioso') start();
    if (zoomSync) zoomSync();
    render();
    return true;
  }

  cv.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;    /* sem ctrl, a pagina rola */
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  /* pinca: dois dedos na tela */
  var toques = {}, pinca = 0;
  cv.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    toques[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(toques);
    if (ids.length === 2) {
      dragging = false; host.classList.remove('dragging');
      pinca = Math.hypot(toques[ids[0]][0] - toques[ids[1]][0], toques[ids[0]][1] - toques[ids[1]][1]);
    }
  });
  cv.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'touch' || !toques[e.pointerId]) return;
    toques[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(toques);
    if (ids.length !== 2 || !pinca) return;
    e.preventDefault();
    var d = Math.hypot(toques[ids[0]][0] - toques[ids[1]][0], toques[ids[0]][1] - toques[ids[1]][1]);
    setZoom(zoom * (d / pinca));
    pinca = d;
  }, { passive: false });
  function largaToque(e) { delete toques[e.pointerId]; if (Object.keys(toques).length < 2) pinca = 0; }
  cv.addEventListener('pointerup', largaToque);
  cv.addEventListener('pointercancel', largaToque);

  cv.addEventListener('dblclick', function () { setZoom(ZDEF); });

  cv.addEventListener('keydown', function (e) {
    var step = 0.14;
    if (e.key === 'ArrowLeft') yaw -= step;
    else if (e.key === 'ArrowRight') yaw += step;
    else if (e.key === 'ArrowUp') pitch = cl(pitch + step * 0.6, -0.55, 0.75);
    else if (e.key === 'ArrowDown') pitch = cl(pitch - step * 0.6, -0.55, 0.75);
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.14); return; }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoom / 1.14); return; }
    else if (e.key === '0') { e.preventDefault(); setZoom(ZDEF); return; }
    else return;
    e.preventDefault();
    manual = true; idleAt = tNow; start();
  });

  new MutationObserver(function () { readTheme(); texT = -1; render(); start(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* handle público: força um quadro e permite fixar o ângulo de vista */
  window.pulmio3D = {
    canvas: cv,
    redraw: function () { render(); },
    view: function (y, p) {
      if (y === undefined) return { yaw: yaw, pitch: pitch, manual: manual, zoom: zoom };
      yaw = y; pitch = cl(p === undefined ? pitch : p, -0.55, 0.75);
      manual = true; idleAt = tNow; render();
    },
    /* usado pelos botoes de zoom do palco */
    zoomBy: function (f) { return setZoom(f === 0 ? ZDEF : zoom * f); },
    /* pausa o laco enquanto algo cobre a cena; ao voltar, o relogio segue
       de onde estava porque o tempo vem de performance.now(), nao do laco */
    pause: function (p) { livre = !p; if (livre) start(); },
    zoomInfo: function () { return { zoom: zoom, min: ZMIN, max: ZMAX }; }
  };

  /* botoes de zoom do palco: existem no HTML, mas so ganham funcao aqui,
     quando o WebGL abriu de fato */
  (function () {
    var caixa = document.getElementById('dev3dZoom');
    if (!caixa) return;
    var btns = caixa.querySelectorAll('button');
    function sincroniza() {
      for (var i = 0; i < btns.length; i++) {
        var k = btns[i].getAttribute('data-z');
        if (k === 'mais') btns[i].disabled = zoom >= ZMAX - 0.001;
        else if (k === 'menos') btns[i].disabled = zoom <= ZMIN + 0.001;
      }
    }
    caixa.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var k = b.getAttribute('data-z');
      setZoom(k === 'mais' ? zoom * 1.18 : k === 'menos' ? zoom / 1.18 : ZDEF);
      sincroniza();
    });
    zoomSync = sincroniza;
    sincroniza();
  })();

  host.classList.add('is3d');
  cv.setAttribute('tabindex', '0');
  render();
  start();
})();
