/*
 * ShutEye — reader.js
 * A small PDF reader that draws pages in the active theme.
 *
 * Safari shows PDFs in its own built-in viewer, which extensions are not allowed
 * to restyle. So ShutEye brings its own: pdf.js (Mozilla, open source) draws each
 * page onto a canvas, then every pixel is recoloured with the same maths the
 * extension uses on websites. Photos inside the PDF keep their real colours.
 */
(function () {
  'use strict';

  const U = globalThis.ShutEye, api = U.api;
  const $ = function (id) { return document.getElementById(id); };
  const pdfjs = globalThis.pdfjsLib;

  // Other reader modules (the annotation tools) listen in on what the reader does.
  const bus = globalThis.ShutEyeReader = {
    handlers: {},
    on: function (name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
    emit: function (name, a, b) { (this.handlers[name] || []).forEach(function (fn) { try { fn(a, b); } catch (e) { console.warn("ShutEye Reader:", e); } }); }
  };

  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const SMALL_SCREEN = Math.min(screen.width, screen.height) < 820;
  const MAX_PIXELS = SMALL_SCREEN ? 5e6 : 12e6;     // keeps canvases inside iOS memory limits
  const GAP = 10;

  let cfg = U.normalize(null);
  let pdf = null, docKey = '', pages = [];
  let zoom = 1, baseW = 612, baseH = 792;
  let generation = 0;                 // bumps whenever everything must be redrawn
  let queue = [], busy = false;
  let positions = {};

  /* ---------- Theme ---------- */

  function paint() {
    const p = U.palette(cfg), s = document.documentElement.style;
    const t = U.tone(cfg, true);
    const paper = U.mapColor([255, 255, 255], U.matrix(t, 'full'));
    s.setProperty('--bg', U.css(p.bg));
    s.setProperty('--fg', U.css(p.fg));
    s.setProperty('--accent', U.css(p.accent));
    s.setProperty('--on-accent', U.lum(p.accent) > 0.55 ? '#141414' : '#ffffff');
    s.setProperty('--card', U.css(U.mix(p.bg, p.fg, 0.07)));
    s.setProperty('--line', U.css(U.mix(p.bg, p.fg, 0.16)));
    s.setProperty('--sub', U.css(U.mix(p.fg, p.bg, 0.4)));
    s.setProperty('--desk', U.css(U.mix(p.bg, [0, 0, 0], 0.3)));
    s.setProperty('--paper', cfg.reader.dark ? U.css(paper) : '#ffffff');
    $('darkBtn').setAttribute('aria-pressed', cfg.reader.dark ? 'true' : 'false');
    $('photoBtn').setAttribute('aria-pressed', cfg.reader.keepPhotos ? 'true' : 'false');
    $('photoBtn').disabled = !cfg.reader.dark;
  }

  /* ---------- Recolouring ---------- */

  // Runs a colour transform over a block of RGBA pixels, in place.
  function recolour(data, t) {
    const m = t.m, o0 = t.o[0] * 255, o1 = t.o[1] * 255, o2 = t.o[2] * 255;
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7], m8 = m[8];
    for (let i = 0, n = data.length; i < n; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      data[i] = m0 * r + m1 * g + m2 * b + o0;        // Uint8ClampedArray clamps and rounds for us
      data[i + 1] = m3 * r + m4 * g + m5 * b + o1;
      data[i + 2] = m6 * r + m7 * g + m8 * b + o2;
    }
  }

  // Finds where the PDF draws pictures, as pixel rectangles on the canvas.
  // Whole-page images are scanned pages, so those are left to be darkened.
  function photoRects(page, viewport, out, cw, ch) {
    return page.getOperatorList().then(function (ops) {
      const O = pdfjs.OPS, T = pdfjs.Util.transform;
      const rects = [], stack = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], a = ops.argsArray[i];
        if (fn === O.save) stack.push(ctm);
        else if (fn === O.restore) ctm = stack.pop() || ctm;
        else if (fn === O.transform) ctm = T(ctm, a);
        else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = T(ctm, a[0]); }
        else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
        else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
          const m = T(viewport.transform, ctm);          // images fill the unit square
          const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
          const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
          const x0 = Math.max(0, Math.floor(Math.min.apply(null, xs) * out));
          const y0 = Math.max(0, Math.floor(Math.min.apply(null, ys) * out));
          const x1 = Math.min(cw, Math.ceil(Math.max.apply(null, xs) * out));
          const y1 = Math.min(ch, Math.ceil(Math.max.apply(null, ys) * out));
          const w = x1 - x0, h = y1 - y0;
          if (w >= 24 * out && h >= 24 * out && w * h < 0.55 * cw * ch) rects.push([x0, y0, w, h]);
        }
      }
      return rects.slice(0, 40);
    }).catch(function () { return []; });
  }

  function darken(ctx, canvas, page, viewport, out) {
    const t = U.tone(cfg, true);
    const full = U.matrix(t, 'full'), photo = U.matrix(t, 'photo');
    const cw = canvas.width, ch = canvas.height;
    const want = cfg.reader.keepPhotos ? photoRects(page, viewport, out, cw, ch) : Promise.resolve([]);
    return want.then(function (rects) {
      const saved = rects.map(function (r) { return ctx.getImageData(r[0], r[1], r[2], r[3]); });
      const strip = 512;                                 // work in strips to keep memory low
      for (let y = 0; y < ch; y += strip) {
        const h = Math.min(strip, ch - y);
        const img = ctx.getImageData(0, y, cw, h);
        recolour(img.data, full);
        ctx.putImageData(img, 0, y);
      }
      saved.forEach(function (img, i) {
        recolour(img.data, photo);
        ctx.putImageData(img, rects[i][0], rects[i][1]);
      });
    });
  }

  /* ---------- Layout ---------- */

  function fitWidth() { return Math.max(200, Math.min(document.documentElement.clientWidth, 1100)); }

  function sizePage(p) {
    const scale = fitWidth() / p.w * zoom;
    p.el.style.width = Math.round(p.w * scale) + 'px';
    p.el.style.height = Math.round(p.h * scale) + 'px';
  }

  function buildPages() {
    const box = $('pages');
    box.textContent = '';
    pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'page';
      el.setAttribute('data-page', n);
      const label = document.createElement('div');
      label.className = 'num';
      label.textContent = n;
      el.appendChild(label);
      const p = { num: n, el: el, label: label, w: baseW, h: baseH, canvas: null, text: null, drawn: -1, near: false };
      sizePage(p);
      box.appendChild(el);
      pages.push(p);
    }
    updateNear();
  }

  // Works out which pages are on or near the screen: those get drawn, and pages
  // far away are dropped again to free memory.
  function updateNear() {
    const vh = window.innerHeight, y = window.scrollY;
    const nearTop = y - vh * 1.2, nearBottom = y + vh * 2.2;
    const farTop = y - vh * 4, farBottom = y + vh * 5;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i], top = p.el.offsetTop, bottom = top + p.el.offsetHeight;
      p.near = bottom > nearTop && top < nearBottom;
      if (p.near) request(p);
      else if (p.canvas && (bottom < farTop || top > farBottom)) release(p);
    }
  }

  function release(p) {
    if (p.canvas) { p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); p.canvas = null; }
    if (p.text) { p.text.remove(); p.text = null; }
    p.drawn = -1;
    p.label.hidden = false;
  }

  /* ---------- Drawing ---------- */

  function request(p) {
    if (p.drawn === generation || queue.indexOf(p) >= 0) return;
    queue.push(p);
    pump();
  }

  function pump() {
    if (busy || !queue.length || !pdf) return;
    // Draw the page nearest the middle of the screen first.
    const mid = window.scrollY + window.innerHeight / 2;
    queue.sort(function (a, b) {
      return Math.abs(a.el.offsetTop + a.el.offsetHeight / 2 - mid) - Math.abs(b.el.offsetTop + b.el.offsetHeight / 2 - mid);
    });
    const p = queue.shift();
    if (!p.near || p.drawn === generation) { pump(); return; }
    busy = true;
    draw(p, generation, pdf).catch(function (err) {
      if (!err || err.name !== 'RenderingCancelledException') console.warn('ShutEye Reader: page ' + p.num, err);
    }).then(function () { busy = false; pump(); });
  }

  function draw(p, gen, doc) {
    let page, viewport, canvas, ctx, out;
    return doc.getPage(p.num).then(function (pg) {
      page = pg;
      const natural = page.getViewport({ scale: 1 });
      if (natural.width !== p.w || natural.height !== p.h) { p.w = natural.width; p.h = natural.height; sizePage(p); }
      viewport = page.getViewport({ scale: fitWidth() / p.w * zoom });

      out = Math.min(window.devicePixelRatio || 1, 3);
      const area = viewport.width * viewport.height;
      if (area * out * out > MAX_PIXELS) out = Math.sqrt(MAX_PIXELS / area);

      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * out));
      canvas.height = Math.max(1, Math.floor(viewport.height * out));
      ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({
        canvasContext: ctx,
        viewport: viewport,
        transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null
      }).promise;
    }).then(function () {
      if (gen !== generation || doc !== pdf) return null;
      return cfg.reader.dark ? darken(ctx, canvas, page, viewport, out) : null;
    }).then(function () {
      if (gen !== generation || doc !== pdf) { canvas.width = 0; return null; }
      release(p);
      p.canvas = canvas;
      p.el.appendChild(canvas);
      p.label.hidden = true;
      p.drawn = gen;
      p.scale = viewport.scale;
      bus.emit("page", p);
      return page.getTextContent();
    }).then(function (content) {
      if (!content || gen !== generation || doc !== pdf || p.canvas !== canvas) return;
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      layer.style.setProperty('--scale-factor', viewport.scale);
      p.el.appendChild(layer);
      p.text = layer;
      const task = pdfjs.renderTextLayer({ textContentSource: content, container: layer, viewport: viewport });
      if (task && task.promise) task.promise.then(function () { bus.emit("text", p); }, function () { /* cancelled */ });
    });
  }

  // Throws away every drawn page and redraws what is on screen.
  function redraw() {
    generation++;
    queue = [];
    pages.forEach(function (p) { if (!p.near && p.canvas) release(p); });
    updateNear();
  }

  let redrawTimer = 0;
  function redrawSoon() { clearTimeout(redrawTimer); redrawTimer = setTimeout(redraw, 220); }

  /* ---------- Position ---------- */

  function currentPage() {
    const mid = window.scrollY + window.innerHeight * 0.35;
    let lo = 0, hi = pages.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (pages[m].el.offsetTop <= mid) lo = m; else hi = m - 1;
    }
    return lo + 1;
  }

  function goTo(n, fraction) {
    const p = pages[U.clamp(n, 1, pages.length) - 1];
    if (!p) return;
    window.scrollTo(0, p.el.offsetTop - $('bar').offsetHeight - 4 + (fraction || 0) * p.el.offsetHeight);
  }

  let scrollTick = false, saveTimer = 0;
  function onScroll() {
    if (scrollTick || !pdf) return;
    scrollTick = true;
    requestAnimationFrame(function () {
      scrollTick = false;
      if (!pdf) return;
      updateNear();
      const n = currentPage();
      $('pageBtn').textContent = n + ' / ' + pdf.numPages;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { remember(n); }, 800);
    });
  }

  function remember(n) {
    if (!docKey) return;
    positions[docKey] = { page: n, at: Date.now() };
    const keys = Object.keys(positions);
    if (keys.length > 60) {
      keys.sort(function (a, b) { return positions[a].at - positions[b].at; });
      for (let i = 0; i < keys.length - 60; i++) delete positions[keys[i]];
    }
    api.storage.local.set({ readerPos: positions }).catch(function () { /* ignore */ });
  }

  // Keeps your place while everything changes size.
  function relayout() {
    if (!pdf) return;
    const n = currentPage(), p = pages[n - 1];
    const frac = p ? (window.scrollY + $('bar').offsetHeight + 4 - p.el.offsetTop) / Math.max(1, p.el.offsetHeight) : 0;
    pages.forEach(sizePage);
    goTo(n, frac);
    redraw();
  }

  /* ---------- Opening ---------- */

  function showMessage(text, isError) {
    const m = $('message');
    m.textContent = text;
    m.classList.toggle('error', !!isError);
  }

  function setProgress(fraction) {
    const bar = $('progress');
    bar.hidden = fraction === null;
    if (fraction !== null) bar.firstElementChild.style.width = Math.round(U.clamp(fraction, 0.03, 1) * 100) + '%';
  }

  function close() {
    bus.emit("close");
    generation++;
    queue = [];
    pages.forEach(release);
    pages = [];
    $('pages').textContent = '';
    if (pdf) { try { pdf.destroy(); } catch (e) { /* ignore */ } }
    pdf = null;
    docKey = '';
  }

  function open(source, name) {
    close();
    $('empty').hidden = true;
    $('tools').hidden = true;
    $('title').textContent = name || 'Opening…';
    setProgress(0.03);

    const task = pdfjs.getDocument(Object.assign({ isEvalSupported: false, useSystemFonts: true }, source));
    task.onProgress = function (p) { if (p && p.total) setProgress(p.loaded / p.total); };
    task.onPassword = function (give, reason) {
      const pw = window.prompt(reason === 2 ? 'Wrong password. Try again:' : 'This PDF is locked. Enter its password:');
      if (pw === null) task.destroy(); else give(pw);
    };

    task.promise.then(function (doc) {
      pdf = doc;
      docKey = (doc.fingerprints && doc.fingerprints[0]) || name || '';
      document.title = (name || 'PDF') + ' · ShutEye Reader';
      $('title').textContent = name || 'PDF';
      return doc.getPage(1);
    }).then(function (first) {
      const v = first.getViewport({ scale: 1 });
      baseW = v.width; baseH = v.height;
      zoom = 1;
      buildPages();
      setProgress(null);
      $('tools').hidden = false;
      $('pageBtn').textContent = '1 / ' + pdf.numPages;
      bus.emit('open', { pdf: pdf, key: docKey, name: name || 'document' });
      const last = positions[docKey];
      if (last && last.page > 1) { goTo(last.page); updateNear(); }
    }).catch(function (err) {
      // Most sites only allow a plain request. Sites behind a login need the
      // browser's sign-in sent along, so try that second.
      if (source.url && !source.withCredentials && (!err || err.name !== 'InvalidPDFException')) {
        open({ url: source.url, withCredentials: true }, name);
        return;
      }
      close();
      setProgress(null);
      $('empty').hidden = false;
      $('title').textContent = 'ShutEye Reader';
      const net = source.url && (!err || err.name !== 'InvalidPDFException');
      showMessage(net
        ? "That link couldn't be loaded here (the site may need a login). Save the PDF to Files, then choose it below."
        : "That file doesn't look like a PDF ShutEye can read.", true);
      console.warn('ShutEye Reader:', err);
    });
  }

  function nameFromUrl(url) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      return last.replace(/\.pdf$/i, '') || new URL(url).hostname;
    } catch (e) { return 'PDF'; }
  }

  function openFile(file) {
    if (!file) return;
    file.arrayBuffer().then(function (buf) {
      open({ data: new Uint8Array(buf) }, file.name.replace(/\.pdf$/i, ''));
    });
  }

  function openUrl(url) {
    if (!/^https?:\/\//i.test(url)) { showMessage('Paste a full link that starts with https://', true); return; }
    open({ url: url, withCredentials: false }, nameFromUrl(url));
  }

  /* ---------- Controls ---------- */

  $('pickBtn').addEventListener('click', function () { $('file').click(); });
  $('openBtn').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function (e) { openFile(e.target.files[0]); e.target.value = ''; });
  $('urlForm').addEventListener('submit', function (e) { e.preventDefault(); openUrl($('url').value.trim()); });

  function setZoom(z) {
    z = U.clamp(Math.round(z * 100) / 100, 0.5, 4);
    if (z === zoom) return;
    zoom = z;
    relayout();
  }
  $('zoomIn').addEventListener('click', function () { setZoom(zoom * 1.25); });
  $('zoomOut').addEventListener('click', function () { setZoom(zoom / 1.25); });

  $('pageBtn').addEventListener('click', function () {
    if (!pdf) return;
    const v = window.prompt('Go to page (1 to ' + pdf.numPages + '):', currentPage());
    const n = parseInt(v, 10);
    if (n >= 1) goTo(n);
  });

  function saveReader() {
    api.storage.local.get('cfg').then(function (d) {
      const fresh = U.normalize(d && d.cfg);
      fresh.reader = cfg.reader;
      cfg = fresh;
      return api.storage.local.set({ cfg: cfg });
    }).catch(function () { /* ignore */ });
  }
  $('darkBtn').addEventListener('click', function () {
    cfg.reader.dark = !cfg.reader.dark;
    paint(); redraw(); saveReader();
  });
  $('photoBtn').addEventListener('click', function () {
    cfg.reader.keepPhotos = !cfg.reader.keepPhotos;
    paint(); redraw(); saveReader();
  });

  window.addEventListener('scroll', onScroll, { passive: true });

  let lastWidth = fitWidth(), resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (fitWidth() !== lastWidth) { lastWidth = fitWidth(); relayout(); }   // ignore toolbar show/hide
    }, 200);
  });

  // Drop a PDF anywhere (desktop).
  window.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', function () { document.body.classList.remove('dragging'); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    document.body.classList.remove('dragging');
    openFile(e.dataTransfer && e.dataTransfer.files[0]);
  });

  // Theme changes made in the popup arrive here.
  api.storage.onChanged.addListener(function (changes) {
    if (!changes.cfg) return;
    const before = JSON.stringify([cfg.theme, cfg.custom, cfg.brightness, cfg.contrast, cfg.sepia, cfg.tint, cfg.reader]);
    cfg = U.normalize(changes.cfg.newValue);
    paint();
    if (before !== JSON.stringify([cfg.theme, cfg.custom, cfg.brightness, cfg.contrast, cfg.sepia, cfg.tint, cfg.reader])) redrawSoon();
  });

  // What the annotation tools may use.
  bus.U = U;
  bus.api = api;
  bus.pages = function () { return pages; };
  bus.goTo = function (n, f) { goTo(n, f); updateNear(); };
  bus.currentPage = currentPage;
  bus.cfg = function () { return cfg; };

  /* ---------- Start ---------- */

  document.querySelectorAll('[data-fox]').forEach(function (el) { el.innerHTML = U.foxSvg(); });
  paint();
  api.storage.local.get(['cfg', 'readerPos']).catch(function () { return {}; }).then(function (d) {
    cfg = U.normalize(d && d.cfg);
    positions = (d && d.readerPos) || {};
    paint();
    const src = new URLSearchParams(location.search).get('src');
    if (src) { $('url').value = src; openUrl(src); }
  });
})();
