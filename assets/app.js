/* =========================================================
   Фонд святой Екатерины — концепт главной
   1. Золотая эмблема: WebGL2, рэймаршинг поля расстояний (SDF),
      построенного прямо в браузере из SVG-контура логотипа.
      Чтобы подставить официальный вектор, достаточно заменить
      атрибут d у <symbol id="emblem"> (и viewBox, если он другой).
   2. Заставка «литьё»: расплав → остывание → полировка → бегущий блик.
   3. Шапка, мобильное меню, слайдер, счётчик, лента событий, формы.
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  window.__fseReady = true;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeOut3 = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeOut4 = function (t) { return 1 - Math.pow(1 - t, 4); };
  var easeInOut = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var seg = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };

  /* ---------------------------------------------------------
     1. Поле расстояний (как в Mapbox TinySDF, с учётом сглаживания)
     --------------------------------------------------------- */
  var INF = 1e20;
  function edt1d(grid, offset, stride, length, f, v, z) {
    v[0] = 0; z[0] = -INF; z[1] = INF; f[0] = grid[offset];
    for (var q = 1, k = 0, s = 0; q < length; q++) {
      f[q] = grid[offset + q * stride];
      var q2 = q * q;
      do {
        var r = v[k];
        s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
      } while (s <= z[k] && --k > -1);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    for (var q3 = 0, k2 = 0; q3 < length; q3++) {
      while (z[k2 + 1] < q3) k2++;
      var r2 = v[k2], qr = q3 - r2;
      grid[offset + q3 * stride] = f[r2] + qr * qr;
    }
  }
  function edt2d(data, w, h, f, v, z) {
    for (var x = 0; x < w; x++) edt1d(data, x, w, h, f, v, z);
    for (var y = 0; y < h; y++) edt1d(data, y * w, 1, w, f, v, z);
  }
  function buildSDF(rgba, w, h) {
    var n = w * h, outer = new Float64Array(n), inner = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var a = rgba[i * 4 + 3] / 255;
      if (a >= 1) { outer[i] = 0; inner[i] = INF; }
      else if (a <= 0) { outer[i] = INF; inner[i] = 0; }
      else { var d = 0.5 - a; outer[i] = d > 0 ? d * d : 0; inner[i] = d < 0 ? d * d : 0; }
    }
    var m = Math.max(w, h);
    var f = new Float64Array(m), v = new Uint16Array(m), z = new Float64Array(m + 1);
    edt2d(outer, w, h, f, v, z);
    edt2d(inner, w, h, f, v, z);
    var out = new Float32Array(n);
    for (var j = 0; j < n; j++) out[j] = Math.sqrt(outer[j]) - Math.sqrt(inner[j]);
    return out; // > 0 снаружи, < 0 внутри, в пикселях текстуры
  }

  /* ---------------------------------------------------------
     2. Рендер эмблемы
     --------------------------------------------------------- */
  var VS = '#version 300 es\n' +
    'void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}';

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uSdf;',
    'uniform vec2 uRes, uHalf;',
    'uniform mat3 uRot, uInv;',
    'uniform float uPx, uDepth, uRound, uErode, uHeat, uSweep, uSweepAmt, uTime, uScale, uFovK, uCam;',
    'out vec4 outColor;',
    'float sd2(vec2 q){',
    '  vec2 uv=vec2(q.x/(2.0*uHalf.x)+0.5,0.5-q.y/(2.0*uHalf.y));',
    '  vec2 cu=clamp(uv,vec2(0.0),vec2(1.0));',
    '  return texture(uSdf,cu).r*uPx+length((uv-cu)*2.0*uHalf);',
    '}',
    'float map(vec3 p){',
    '  float wob=sin(p.x*23.0+uTime*2.1)*sin(p.y*19.0-uTime*1.6);',
    '  float d2=sd2(p.xy)+uErode*(1.0+0.6*wob);',
    '  vec2 w=vec2(d2+uRound*0.55,abs(p.z)-uDepth+uRound);',
    '  return min(max(w.x,w.y),0.0)+length(max(w,0.0))-uRound;',
    '}',
    'vec3 calcNormal(vec3 p){',
    '  const vec2 k=vec2(1.0,-1.0); float e=uPx*2.2;',
    '  return normalize(k.xyy*map(p+k.xyy*e)+k.yyx*map(p+k.yyx*e)+k.yxy*map(p+k.yxy*e)+k.xxx*map(p+k.xxx*e));',
    '}',
    'vec2 boxHit(vec3 ro,vec3 rd,vec3 b){',
    '  vec3 sd=mix(rd,vec3(1e-6),step(abs(rd),vec3(1e-6)));',
    '  vec3 m=1.0/sd, n=m*ro, k=abs(m)*b;',
    '  vec3 t1=-n-k, t2=-n+k;',
    '  float tn=max(max(t1.x,t1.y),t1.z), tf=min(min(t2.x,t2.y),t2.z);',
    '  if(tn>tf||tf<0.0) return vec2(-1.0);',
    '  return vec2(max(tn,0.0),tf);',
    '}',
    'vec3 env(vec3 d){',
    '  float ax=atan(d.x,d.z);',
    '  vec3 c=mix(vec3(0.012,0.009,0.006),vec3(0.085,0.064,0.042),smoothstep(-0.7,0.9,d.y));',
    '  c+=vec3(0.95,0.77,0.5)*smoothstep(0.15,1.0,d.z)*(0.17+0.5*smoothstep(-0.35,0.35,d.y-0.55*d.x+0.04));',
    '  c+=vec3(1.0,0.88,0.66)*2.6*pow(max(dot(d,normalize(vec3(-0.6,0.6,0.53))),0.0),9.0);',
    '  c+=vec3(1.0,0.95,0.86)*1.9*smoothstep(0.13,0.03,abs(ax-1.05))*smoothstep(1.0,0.25,abs(d.y));',
    '  c+=vec3(1.0,0.92,0.78)*0.85*smoothstep(0.045,0.0,abs(d.y-0.2))*smoothstep(-0.2,0.8,d.z);',
    '  c+=vec3(0.62,0.34,0.12)*0.4*pow(max(dot(d,normalize(vec3(0.35,-0.8,0.45))),0.0),2.0);',
    '  c+=vec3(1.0,0.9,0.7)*6.5*uSweepAmt*smoothstep(0.11,0.0,abs(ax-uSweep))*smoothstep(1.3,0.0,abs(d.y));',
    '  return c;',
    '}',
    'float calcAO(vec3 p,vec3 n){',
    '  float o=0.0, s=1.0;',
    '  for(int i=1;i<=4;i++){float h=0.02*float(i); o+=(h-map(p+n*h))*s; s*=0.62;}',
    '  return clamp(1.0-2.4*o,0.35,1.0);',
    '}',
    'vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}',
    'void main(){',
    '  vec2 f=(gl_FragCoord.xy-0.5*uRes)/uRes.y;',
    '  vec3 rdW=normalize(vec3(f*uFovK,-1.0));',
    '  vec3 ro=uInv*vec3(0.0,0.0,uCam)/uScale;',
    '  vec3 rd=uInv*rdW;',
    '  vec2 tb=boxHit(ro,rd,vec3(uHalf,uDepth+0.03));',
    '  vec4 col=vec4(0.0);',
    '  if(tb.y>0.0){',
    '    float pixA=uFovK/uRes.y;',
    '    float t=tb.x, best=1e9, tBest=tb.x; bool hit=false;',
    '    for(int i=0;i<170;i++){',
    '      float d=map(ro+rd*t);',
    '      float r=d/(pixA*t);',
    '      if(r<best){best=r;tBest=t;}',
    '      if(d<0.0001*t){hit=true;tBest=t;break;}',
    '      t+=d*0.82;',
    '      if(t>tb.y) break;',
    '    }',
    '    float cov=hit?1.0:1.0-smoothstep(0.0,1.0,best);',
    '    if(cov>0.002){',
    '      vec3 p=ro+rd*tBest;',
    '      vec3 n=calcNormal(p);',
    '      vec3 nW=normalize(uRot*n);',
    '      vec3 v=-rdW;',
    '      float ndv=clamp(dot(nW,v),0.0,1.0);',
    '      vec3 F0=vec3(0.95,0.69,0.31);',
    '      vec3 F=F0+(1.0-F0)*pow(1.0-ndv,5.0);',
    '      vec3 c=env(reflect(rdW,nW))*F;',
    '      vec3 L=normalize(vec3(-0.45,0.62,0.64));',
    '      vec3 H=normalize(L+v);',
    '      float ndh=max(dot(nW,H),0.0), ndl=max(dot(nW,L),0.0);',
    '      float a2=0.0065, dd=ndh*ndh*(a2-1.0)+1.0;',
    '      c+=F*(a2/(3.14159*dd*dd))*ndl*0.22*vec3(1.0,0.93,0.82);',
    '      c*=calcAO(p,n);',
    '      float g=0.5+0.5*sin(uTime*6.0+p.y*13.0+p.x*7.0);',
    '      float core=clamp(-sd2(p.xy)*55.0,0.0,1.0);',
    '      vec3 molten=mix(vec3(1.9,0.22,0.02),vec3(2.5,1.15,0.32),clamp(core*0.75+0.25*g,0.0,1.0));',
    '      c=mix(c,molten,uHeat);',
    '      c=pow(aces(c*1.1),vec3(1.0/2.2));',
    '      col=vec4(c*cov,cov);',
    '    }',
    '  }',
    '  outColor=col;',
    '}'
  ].join('\n');

  function createEmblem(canvas, pathD, viewBox) {
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    } catch (e) { gl = null; }
    if (!gl) return null;

    var small = Math.min(window.screen.width, window.screen.height) < 700;
    var TH = small ? 640 : 1024, pad = 0.07;
    var s = TH * (1 - 2 * pad) / viewBox[3];
    var TW = Math.ceil(viewBox[2] * s + 2 * pad * TH);
    var c2 = document.createElement('canvas');
    c2.width = TW; c2.height = TH;
    var ctx = c2.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(s, 0, 0, s, (TW - viewBox[2] * s) / 2 - viewBox[0] * s, (TH - viewBox[3] * s) / 2 - viewBox[1] * s);
    ctx.fillStyle = '#000';
    ctx.fill(new Path2D(pathD), 'evenodd');
    var sdf = buildSDF(ctx.getImageData(0, 0, TW, TH).data, TW, TH);

    function sh(type, src) {
      var o = gl.createShader(type);
      gl.shaderSource(o, src); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());

    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, TW, TH, 0, gl.RED, gl.FLOAT, sdf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var U = {};
    ['uSdf', 'uRes', 'uHalf', 'uRot', 'uInv', 'uPx', 'uDepth', 'uRound', 'uErode', 'uHeat', 'uSweep', 'uSweepAmt', 'uTime', 'uScale', 'uFovK', 'uCam']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.uSdf, 0);
    gl.uniform2f(U.uHalf, TW / TH, 1);
    gl.uniform1f(U.uPx, 2 / TH);
    gl.uniform1f(U.uRound, 0.01);
    gl.uniform1f(U.uCam, 4.8);

    var quality = 1, frames = 0, acc = 0, lastT = 0;
    var dprCap = small ? 1.5 : 2;

    function resize() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, dprCap) * quality;
      var w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return r.width / Math.max(1, r.height);
    }

    function draw(st, now) {
      var aspect = resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      var halfH = Math.max(1.0, 0.84 / aspect);
      gl.uniform1f(U.uFovK, 2 * halfH / 4.8);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      var cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cx = Math.cos(st.pitch), sx = Math.sin(st.pitch);
      gl.uniformMatrix3fv(U.uRot, false, [cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx]);
      gl.uniformMatrix3fv(U.uInv, false, [cy, sy * sx, sy * cx, 0, cx, -sx, -sy, cy * sx, cy * cx]);
      gl.uniform1f(U.uDepth, st.depth);
      gl.uniform1f(U.uErode, st.erode);
      gl.uniform1f(U.uHeat, st.heat);
      gl.uniform1f(U.uSweep, st.sweep);
      gl.uniform1f(U.uSweepAmt, st.sweepAmt);
      gl.uniform1f(U.uTime, st.time);
      gl.uniform1f(U.uScale, st.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // адаптивное качество: если кадр тяжёлый, уменьшаем разрешение холста
      if (now && lastT) {
        acc += now - lastT; frames++;
        if (frames === 40) {
          var avg = acc / frames;
          if (avg > 24 && quality > 0.55) quality = Math.max(0.55, quality * 0.82);
          else if (avg < 13 && quality < 1) quality = Math.min(1, quality * 1.1);
          frames = 0; acc = 0;
        }
      }
      lastT = now || 0;
    }
    return { draw: draw, gl: gl };
  }

  /* ---------------------------------------------------------
     3. Заставка и «живая» эмблема на первом экране
     --------------------------------------------------------- */
  var DEPTH = 0.062;
  var INTRO_MS = 3700;
  var REVEAL_AT = 0.7;
  var stage = $('[data-stage]'), canvas = $('[data-gl]');
  var countEl = $('[data-count]'), skipBtn = $('[data-skip]');
  var emblem = null;

  function endIntro() {
    if (!root.classList.contains('is-intro')) return;
    root.classList.remove('is-intro');
    try { sessionStorage.setItem('fse-intro', '1'); } catch (e) {}
  }

  if (canvas) {
    var symPath = $('#emblem path');
    var vb = $('#emblem').getAttribute('viewBox').split(/[\s,]+/).map(Number);
    try { emblem = createEmblem(canvas, symPath.getAttribute('d'), vb); } catch (e) { emblem = null; if (window.console) console.warn('WebGL эмблема отключена:', e); }
    if (!emblem) { root.classList.add('no-gl'); endIntro(); }
  }

  var pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', function (e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  var heroVisible = true;
  var hero = $('.hero');
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { heroVisible = en[0].isIntersecting; if (heroVisible) kick(); }, { threshold: 0 }).observe(hero);
  }

  var t0 = performance.now(), introStart = root.classList.contains('is-intro') ? t0 : null, idleStart = null, raf = 0;

  function introState(ms) {
    var p = clamp(ms / INTRO_MS, 0, 1);
    return {
      p: p,
      heat: 1 - easeInOut(seg(p, 0.08, 0.62)),
      erode: 0.11 * (1 - easeOut4(seg(p, 0.0, 0.58))),
      depth: lerp(0.01, DEPTH, easeOut3(seg(p, 0.06, 0.62))),
      yaw: lerp(-1.05, 0.2, easeOut3(seg(p, 0.0, 0.82))),
      pitch: lerp(0.3, 0.04, easeOut3(seg(p, 0.0, 0.82))),
      scale: lerp(0.86, 1, easeOut3(seg(p, 0.0, 0.9))),
      sweep: lerp(-1.6, 1.7, seg(p, 0.56, 0.98)),
      sweepAmt: Math.sin(Math.PI * seg(p, 0.56, 0.98))
    };
  }

  function idleState(sec) {
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    var heroH = hero ? hero.offsetHeight : window.innerHeight;
    var sp = clamp(window.scrollY / heroH, 0, 1);
    var cyc = (sec % 9) / 9, glint = seg(cyc, 0, 0.2);
    return {
      heat: 0, erode: 0, depth: DEPTH, scale: 1,
      yaw: 0.2 + 0.2 * Math.sin(sec * 0.33) + pointer.x * 0.3 + sp * 1.1,
      pitch: 0.04 + 0.06 * Math.sin(sec * 0.25 + 1) - pointer.y * 0.14 - sp * 0.2,
      sweep: lerp(-1.6, 1.7, glint),
      sweepAmt: cyc < 0.2 ? Math.sin(Math.PI * glint) * 0.8 : 0
    };
  }

  function frame(now) {
    raf = 0;
    var st;
    if (introStart !== null) {
      st = introState(now - introStart);
      if (countEl) countEl.textContent = String(Math.round(100 * easeInOut(clamp(st.p / 0.78, 0, 1))));
      if (st.p >= REVEAL_AT) endIntro();
      if (st.p >= 1) { introStart = null; idleStart = now; }
    } else {
      if (idleStart === null) idleStart = now;
      st = idleState((now - idleStart) / 1000);
    }
    st.time = (now - t0) / 1000;
    if (emblem) emblem.draw(st, now);
    if (stage) stage.style.setProperty('--heat', st.heat.toFixed(3));
    if (!reduceMotion && (heroVisible || introStart !== null) && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (emblem && !raf) raf = requestAnimationFrame(frame); }

  if (emblem) {
    if (reduceMotion) {
      emblem.draw({ heat: 0, erode: 0, depth: DEPTH, scale: 1, yaw: 0.22, pitch: 0.05, sweep: 0, sweepAmt: 0, time: 0 });
      window.addEventListener('resize', function () {
        emblem.draw({ heat: 0, erode: 0, depth: DEPTH, scale: 1, yaw: 0.22, pitch: 0.05, sweep: 0, sweepAmt: 0, time: 0 });
      });
    } else {
      kick();
      document.addEventListener('visibilitychange', kick);
    }
  }

  function skipIntro() {
    if (introStart === null) return;
    introStart = performance.now() - INTRO_MS;
    endIntro();
    kick();
  }
  if (skipBtn) skipBtn.addEventListener('click', skipIntro);
  ['wheel', 'touchmove', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (root.classList.contains('is-intro')) skipIntro(); }, { passive: true });
  });

  /* Заголовок не должен наезжать на эмблему — даже если веб-шрифт не загрузился */
  var heroTitle = $('.hero__title');
  function fitTitle() {
    if (!heroTitle || !stage || !hero) return;
    heroTitle.style.fontSize = '';
    if (window.innerWidth <= 900) return;
    var heroLeft = hero.getBoundingClientRect().left;
    var sw = stage.offsetWidth, shh = stage.offsetHeight;
    var emblemLeft = stage.offsetLeft + (sw - Math.min(sw, 0.71 * shh)) / 2 - 28;
    var right = 0;
    $$('.ln > span', heroTitle).forEach(function (s) {
      var r = s.getBoundingClientRect(); right = Math.max(right, r.left + s.scrollWidth - heroLeft);
    });
    var left = heroTitle.offsetLeft;
    if (right > emblemLeft && right > left) {
      var fs = parseFloat(window.getComputedStyle(heroTitle).fontSize);
      heroTitle.style.fontSize = Math.max(44, fs * (emblemLeft - left) / (right - left)) + 'px';
    }
  }
  fitTitle();
  window.addEventListener('resize', fitTitle);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);

  /* ---------------------------------------------------------
     4. Шапка: фон после первого экрана, подсветка раздела, меню
     --------------------------------------------------------- */
  var hdr = $('[data-hdr]');
  function onScroll() {
    if (!hdr) return;
    hdr.classList.toggle('is-solid', window.scrollY > Math.min(window.innerHeight * 0.55, 420));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var navLinks = $$('.nav a');
  if ('IntersectionObserver' in window && navLinks.length) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = byId[en.target.id];
        if (!a) return;
        if (en.isIntersecting) {
          navLinks.forEach(function (x) { x.removeAttribute('aria-current'); });
          a.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) spy.observe(el); });
  }

  var burger = $('[data-burger]'), mnav = $('[data-mnav]');
  function setMenu(open) {
    if (!burger || !mnav) return;
    burger.setAttribute('aria-expanded', String(open));
    mnav.hidden = !open;
    root.classList.toggle('menu-open', open);
    if (open) { hdr.classList.add('is-solid'); var first = $('a', mnav); if (first) first.focus(); }
    else onScroll();
  }
  if (burger) {
    burger.addEventListener('click', function () { setMenu(burger.getAttribute('aria-expanded') !== 'true'); });
    $$('a', mnav).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') { setMenu(false); burger.focus(); } });
  }

  /* ---------------------------------------------------------
     5. Слайдер на первом экране
     --------------------------------------------------------- */
  var slider = $('[data-slider]');
  if (slider) {
    var slides = $$('.panel__slide', slider), bar = $('[data-progress]', slider), box = $('[data-slides]', slider);
    var idx = 0, DUR = 7000, started = performance.now(), paused = false, elapsed = 0;
    var go = function (i, manual) {
      slides[idx].classList.remove('is-active');
      slides[idx].setAttribute('aria-hidden', 'true');
      $$('a', slides[idx]).forEach(function (a) { a.tabIndex = -1; });
      idx = (i + slides.length) % slides.length;
      slides[idx].classList.add('is-active');
      slides[idx].removeAttribute('aria-hidden');
      $$('a', slides[idx]).forEach(function (a) { a.removeAttribute('tabindex'); });
      started = performance.now(); elapsed = 0;
      if (manual) box.setAttribute('aria-live', 'polite');
    };
    $('[data-prev]', slider).addEventListener('click', function () { go(idx - 1, true); });
    $('[data-next]', slider).addEventListener('click', function () { go(idx + 1, true); });
    slider.addEventListener('mouseenter', function () { paused = true; elapsed = performance.now() - started; });
    slider.addEventListener('mouseleave', function () { paused = false; started = performance.now() - elapsed; });
    slider.addEventListener('focusin', function () { paused = true; elapsed = performance.now() - started; });
    slider.addEventListener('focusout', function () { paused = false; started = performance.now() - elapsed; });
    var sx0 = null;
    slider.addEventListener('touchstart', function (e) { sx0 = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener('touchend', function (e) {
      if (sx0 === null) return;
      var dx = e.changedTouches[0].clientX - sx0; sx0 = null;
      if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1), true);
    });
    if (!reduceMotion) {
      (function tick(now) {
        if (!root.classList.contains('is-intro') && !paused && !document.hidden) {
          var p = (now - started) / DUR;
          if (p >= 1) go(idx + 1); else bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        } else if (root.classList.contains('is-intro')) { started = now; }
        requestAnimationFrame(tick);
      })(performance.now());
    } else { bar.style.transform = 'scaleX(1)'; }
  }

  /* ---------------------------------------------------------
     6. Счётчик наборов
     --------------------------------------------------------- */
  var num = $('[data-countup]');
  if (num && !reduceMotion && 'IntersectionObserver' in window) {
    var target = Number(num.getAttribute('data-countup'));
    var fmt = function (v) { return Math.round(v).toLocaleString('ru-RU'); };
    var ioN = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting) return;
      ioN.disconnect();
      var st0 = performance.now();
      (function step(now) {
        var p = clamp((now - st0) / 1700, 0, 1);
        num.textContent = fmt(target * easeOut3(p));
        if (p < 1) requestAnimationFrame(step);
      })(st0);
    }, { threshold: 0.6 });
    ioN.observe(num);
  }

  /* ---------------------------------------------------------
     7. Сколько дней до дня памяти святой Екатерины (7 декабря)
     --------------------------------------------------------- */
  var feast = $('[data-feast]');
  if (feast) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(today.getFullYear(), 11, 7);
    if (day < today) day = new Date(today.getFullYear() + 1, 11, 7);
    var days = Math.round((day - today) / 864e5);
    var plural = function (n, forms) {
      var n10 = n % 10, n100 = n % 100;
      return forms[(n10 === 1 && n100 !== 11) ? 0 : (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) ? 1 : 2];
    };
    if (days === 0) {
      $('[data-feast-days]', feast).textContent = 'Сегодня';
      $('[data-feast-text]', feast).textContent = 'день памяти святой великомученицы Екатерины';
    } else {
      $('[data-feast-days]', feast).textContent = days + ' ' + plural(days, ['день', 'дня', 'дней']);
      $('[data-feast-text]', feast).textContent = 'до дня памяти святой Екатерины, 7 декабря';
    }
  }

  /* ---------------------------------------------------------
     8. Лента событий: кнопки и перетаскивание мышью
     --------------------------------------------------------- */
  var strip = $('[data-strip]');
  if (strip) {
    var step = function () { var c = $('.card:not(.card--lead)', strip); return c ? c.getBoundingClientRect().width + 24 : 360; };
    var prevB = $('[data-strip-prev]'), nextB = $('[data-strip-next]');
    var upd = function () {
      prevB.disabled = strip.scrollLeft < 4;
      nextB.disabled = strip.scrollLeft + strip.clientWidth > strip.scrollWidth - 4;
    };
    prevB.addEventListener('click', function () { strip.scrollBy({ left: -step(), behavior: reduceMotion ? 'auto' : 'smooth' }); });
    nextB.addEventListener('click', function () { strip.scrollBy({ left: step(), behavior: reduceMotion ? 'auto' : 'smooth' }); });
    strip.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    upd();
    var drag = null;
    strip.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: strip.scrollLeft, moved: false };
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; strip.classList.add('is-drag'); }
      if (drag.moved) strip.scrollLeft = drag.left - dx;
    });
    window.addEventListener('pointerup', function () {
      if (drag && drag.moved) {
        strip.classList.remove('is-drag');
        var w = step();
        strip.scrollTo({ left: Math.round(strip.scrollLeft / w) * w, behavior: 'smooth' });
      }
      drag = null;
    });
  }

  /* ---------------------------------------------------------
     9. Формы (в концепте — проверка и экран «отправлено»;
        на сайте их заменят формы Contact Form 7)
     --------------------------------------------------------- */
  var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  $$('form[data-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstBad = null;
      $$('.field__err, .check__err', form).forEach(function (x) { x.remove(); });
      $$('[required]', form).forEach(function (el) {
        var v = el.type === 'checkbox' ? el.checked : el.value.trim();
        var bad = !v || (el.type === 'email' && !emailRe.test(el.value.trim())) ||
          (el.type === 'tel' && el.value.replace(/\D/g, '').length < 10);
        var holder = el.closest('.field') || el.closest('.check');
        if (holder) holder.classList.toggle('is-invalid', bad);
        el.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) {
          var msg = document.createElement('p');
          msg.className = el.type === 'checkbox' ? 'check__err' : 'field__err';
          msg.id = (el.id || el.name) + '-err';
          msg.textContent = el.getAttribute('data-msg');
          holder.appendChild(msg);
          el.setAttribute('aria-describedby', msg.id);
          if (!firstBad) firstBad = el;
        } else { el.removeAttribute('aria-describedby'); }
      });
      if (firstBad) { firstBad.focus(); return; }
      var isNabor = form.getAttribute('data-form') === 'nabor';
      var done = document.createElement('div');
      done.className = 'form__done';
      done.setAttribute('role', 'status');
      done.tabIndex = -1;
      done.innerHTML = isNabor
        ? '<h4>Заявка отправлена</h4><p>Её рассмотрят в течение 10 рабочих дней. Когда заявку подтвердят, оператор горячей линии сообщит время и место выдачи набора.</p><p>Концепт: отправка не подключена, на сайте здесь будет Contact Form 7.</p>'
        : '<h4>Обращение отправлено</h4><p>Фонд ответит по контактам, которые вы указали.</p><p>Концепт: отправка не подключена, на сайте здесь будет Contact Form 7.</p>';
      var fields = $('.form__fields', form);
      fields.replaceWith(done);
      done.focus();
    });
  });
})();
