/*
 * ShutEye — content.js
 * Runs in every page and frame. Darkens light pages and keeps media natural.
 *
 * How it works, in one paragraph:
 *   The whole page is flipped with one CSS filter on <html>
 *   (invert + hue-rotate keeps colours, only light/dark swap). Photos, video and
 *   embedded frames are flipped a second time, which restores them exactly.
 *   A small classifier looks at each image to tell photos (restore) from
 *   diagrams, formulas and scanned book pages (leave dark). Pages that are
 *   already dark are detected and left alone.
 */
(function () {
  'use strict';

  const NR = globalThis.ShutEye;
  if (!NR || !NR.api || !NR.api.storage || globalThis.__shuteyeContent) return;
  globalThis.__shuteyeContent = true;

  const api = NR.api, doc = document, win = window;
  if (!(doc.documentElement instanceof HTMLHtmlElement)) return;   // skip bare SVG / XML documents

  const STYLE_ID = 'shuteye-style';
  const BACKDROP = 'shuteye-backdrop';      // solid page colour, behind everything
  const TONE_A = 'shuteye-tone-a';          // colour-theme layers, in front of everything
  const TONE_B = 'shuteye-tone-b';
  const ATTR = 'data-se-i';            // "nat" = show real colours, "inv" = keep inverted
  const DARK_BELOW = 0.36;             // backgrounds darker than this count as "already dark"
  const MAX_SCAN = 20000;              // elements checked for CSS background photos
  const MAX_PROBES = 120;              // cross-site images fetched for analysis, per page

  let isTop = true;
  try { isTop = win.top === win; } catch (e) { isTop = false; }

  const isPdfDoc = /pdf/i.test(doc.contentType || '');
  const ownHost = NR.cleanHost(location.hostname);
  // Site rules always follow the address-bar site, even inside embedded frames.
  const siteHost = (function () {
    if (isTop) return ownHost;
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return NR.cleanHost(new URL(ao[ao.length - 1]).hostname);
    } catch (e) { /* not available */ }
    try { return NR.cleanHost(win.top.location.hostname); } catch (e) { /* cross-origin */ }
    return ownHost;
  })();

  // Section rules follow the address bar, so only the top page has a path.
  function sitePath() { return isTop ? location.pathname : ''; }
  let lastPath = sitePath();

  /* ---------- State ---------- */

  let cfg = NR.normalize(null);
  let darkHosts = {};
  let ready = false;
  let reason = 'off-global';     // why we are on or off (shown in the popup)
  let mode = 'off';              // 'off' | 'full' | 'rev' | 'cancel'
  let imagesMode = 'smart';
  let pageDark = null;           // null = not measured yet
  let origCanvas = null;         // the page's own background colour [r,g,b,a]
  let ctxActive = false;         // an ancestor frame is already darkening us
  let parentInverts = false;     // parent could not single us out, so we are inverted with it
  let lastChildCtx = null;
  let loaded = doc.readyState === 'complete';

  let styleEl = null, layers = [], lastCss = '', lastLook = '';
  const calm = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const sysDark = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : { matches: false };

  /* ---------- Deciding ---------- */

  function decide() {
    if (!cfg.enabled) return 'off-global';
    if (!NR.scheduleOn(cfg, new Date(), sysDark.matches)) return 'off-schedule';
    const rule = NR.siteRule(cfg, siteHost, sitePath());
    if (rule.mode === 'off') return 'off-site';
    if (cfg.defaultMode === 'listed' && rule.mode !== 'on') return 'off-list';
    // "Always" forces the page itself; embedded frames still judge themselves.
    const forced = isTop && rule.mode === 'on';
    if (!forced && cfg.autoDetect && pageDark === true && !isPdfDoc) return 'off-dark';
    return 'on';
  }

  function childCtx() { return mode === 'full' || mode === 'rev' || ctxActive; }

  // animate = the change came from the user (popup, schedule), not from page loading.
  function apply(animate) {
    if (!ready) return;
    reason = decide();
    const want = reason === 'on';
    const prevMode = mode, prevImages = imagesMode;

    if (parentInverts) mode = want ? 'rev' : (reason === 'off-dark' ? 'cancel' : 'off');
    else mode = want ? 'full' : 'off';

    const rule = NR.siteRule(cfg, siteHost, sitePath());
    imagesMode = isPdfDoc ? 'invert' : (rule.images || cfg.images);

    const look = mode + '|' + cfg.theme + '|' + cfg.tint + '|' + (cfg.theme === 'custom' ? cfg.custom.bg + cfg.custom.fg : '');
    const moving = animate === true && isTop && look !== lastLook && (mode === 'full' || prevMode === 'full') &&
      cfg.anim !== 'none' && !doc.hidden && !!doc.body && typeof doc.startViewTransition === 'function' && !calm.matches;
    lastLook = look;
    commit(moving, prevMode === 'full' && mode !== 'full');

    const working = mode === 'full' || mode === 'rev';
    if (working) startWork(prevImages !== imagesMode);
    else stopWork();

    watch(reason === 'on' || reason === 'off-dark');

    if (childCtx() !== lastChildCtx) notifyChildren();
    if (prevMode !== mode) setTimeout(sweepFrames, 1200);
  }

  function syncDom() {
    if (mode === 'off') removeDom(); else { ensureDom(); writeCss(); }
    setThemeColor();
  }

  /* ---------- Switch animations ----------
   * Uses the View Transitions API (Safari 18+, Chrome 111+): the browser takes a
   * picture of the page before and after, and we choose how one turns into the
   * other. Older browsers simply switch instantly.
   */
  function commit(moving, goingLight) {
    if (!moving) { syncDom(); return; }
    const motion = doc.createElement('style');
    motion.textContent = motionCss(cfg.anim, cfg.animMs, goingLight);
    doc.documentElement.appendChild(motion);
    const done = function () { motion.remove(); };
    let vt;
    try { vt = doc.startViewTransition(syncDom); } catch (e) { done(); syncDom(); return; }
    vt.finished.then(done, done);
  }

  function motionCss(kind, ms, goingLight) {
    const O = '::view-transition-old(root)', N = '::view-transition-new(root)';
    const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
    // Ripple grows from where the Safari toolbar sits.
    const at = win.innerWidth < 700 ? '50% 100%' : '100% 0%';
    let css = O + ', ' + N + ' { mix-blend-mode: normal; animation-duration: ' + ms + 'ms; animation-timing-function: ' + ease + '; }\n';
    if (kind === 'blink') {
      // An eyelid: the old page squeezes shut over the new one (or the new one opens up).
      if (goingLight) {
        css += O + ' { animation: none; z-index: 0; }\n' +
          N + ' { animation: shuteye-lid-open ' + ms + 'ms ' + ease + ' both; z-index: 1; }\n';
      } else {
        css += N + ' { animation: none; z-index: 0; }\n' +
          O + ' { animation: shuteye-lid-close ' + ms + 'ms ' + ease + ' both; z-index: 1; }\n';
      }
      css += '@keyframes shuteye-lid-close { from { clip-path: ellipse(160% 110% at 50% 50%); } to { clip-path: ellipse(160% 0% at 50% 50%); } }\n' +
        '@keyframes shuteye-lid-open { from { clip-path: ellipse(160% 0% at 50% 50%); } to { clip-path: ellipse(160% 110% at 50% 50%); } }\n';
    } else if (kind === 'ripple') {
      if (goingLight) {
        css += N + ' { animation: none; z-index: 0; }\n' +
          O + ' { animation: shuteye-ripple-out ' + ms + 'ms ' + ease + ' both; z-index: 1; }\n';
      } else {
        css += O + ' { animation: none; z-index: 0; }\n' +
          N + ' { animation: shuteye-ripple-in ' + ms + 'ms ' + ease + ' both; z-index: 1; }\n';
      }
      css += '@keyframes shuteye-ripple-in { from { clip-path: circle(0 at ' + at + '); } to { clip-path: circle(150vmax at ' + at + '); } }\n' +
        '@keyframes shuteye-ripple-out { from { clip-path: circle(150vmax at ' + at + '); } to { clip-path: circle(0 at ' + at + '); } }\n';
    } else if (kind === 'curtain') {
      if (goingLight) {
        css += N + ' { animation: none; z-index: 0; }\n' +
          O + ' { animation: shuteye-curtain-up ' + ms + 'ms ' + ease + ' both; z-index: 1; }\n';
      } else {
        css += O + ' { animation: none; z-index: 0; }\n' +
          N + ' { animation: shuteye-curtain-down ' + ms + 'ms ' + ease + ' both; z-index: 1; }\n';
      }
      css += '@keyframes shuteye-curtain-down { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }\n' +
        '@keyframes shuteye-curtain-up { from { clip-path: inset(0 0 0 0); } to { clip-path: inset(0 0 100% 0); } }\n';
    } else if (kind === 'mist') {
      css += O + ' { animation: shuteye-mist-out ' + ms + 'ms ease both; }\n' +
        N + ' { animation: shuteye-mist-in ' + ms + 'ms ease both; }\n' +
        '@keyframes shuteye-mist-out { to { opacity: 0; filter: blur(14px); } }\n' +
        '@keyframes shuteye-mist-in { from { opacity: 0; filter: blur(14px); } }\n';
    }
    return css;                       // 'fade' is the browser's own cross-fade at our speed
  }

  /* ---------- Style sheet ---------- */

  const WHITE = [255, 255, 255];
  const canBlend = !!(win.CSS && CSS.supports && CSS.supports('mix-blend-mode', 'screen'));

  function baseColour() { return origCanvas || (isTop ? WHITE : null); }

  // The theme recipe for this frame. Colour tint needs a solid page background to
  // blend with, and only the outermost darkened frame applies it.
  function currentTone() {
    return NR.tone(cfg, mode === 'full' && !ctxActive && canBlend && !!baseColour());
  }

  const LAYER = ' { display: block !important; position: fixed !important; top: -120px !important;' +
    ' bottom: -120px !important; left: 0 !important; right: 0 !important; margin: 0 !important;' +
    ' border: 0 !important; pointer-events: none !important;';

  function buildCss() {
    const R = NR.REVERSE;
    const N = '[' + ATTR + '="nat"]';
    const used = {};
    let css = '@media screen {\n';

    if (mode === 'full' || mode === 'cancel') {
      // Frames inside an already-darkened page only flip; the outer page adds the theme.
      const flipOnly = mode === 'cancel' || ctxActive;
      const t = flipOnly ? null : currentTone();
      const filter = flipOnly ? R : t.filter;
      const mx = NR.matrix(t, flipOnly ? 'reverse' : 'full');
      const base = baseColour();
      css += ':root { -webkit-filter: ' + filter + ' !important; filter: ' + filter + ' !important;';
      if (base) {
        // Safari paints the root background outside the filter, so it gets the
        // final colour directly. The backdrop element below covers the viewport
        // for engines that do filter it (Chrome, Edge).
        css += ' background-color: ' + NR.css(NR.mapColor(base, mx)) + ' !important;';
      }
      css += ' }\n';
      if (base) {
        used[BACKDROP] = 1;
        css += BACKDROP + LAYER + ' z-index: -2147483647 !important; background: ' + NR.css(base) + ' !important; }\n';
      }
      if (t && t.tinted) {
        used[TONE_A] = used[TONE_B] = 1;
        css += TONE_A + LAYER + ' z-index: 2147483646 !important; background: ' + t.screen + ' !important; mix-blend-mode: screen !important; }\n';
        css += TONE_B + LAYER + ' z-index: 2147483647 !important; background: ' + t.multiply + ' !important; mix-blend-mode: multiply !important; }\n';
      }
      if (t) {
        // Colours are written "pre-flip": they come out as the theme accent.
        const accent = NR.css(NR.preimage(t.palette.accent, mx));
        css += '::selection { background: ' + accent + ' !important; color: ' + NR.css(NR.preimage(t.palette.bg, mx)) + ' !important; }\n';
        css += ':root { caret-color: ' + accent + ' !important; accent-color: ' + accent + ' !important; }\n';
        if (cfg.accentLinks) {
          css += 'a:any-link:not([role="button"]):not([class*="btn" i]):not([class*="button" i]) { color: ' + accent + ' !important; }\n';
        }
      }
    }
    [BACKDROP, TONE_A, TONE_B].forEach(function (tag) {
      if (!used[tag]) css += tag + ' { display: none !important; }\n';
    });

    if (mode === 'full' || mode === 'rev') {
      // shuteye-ui is the userscript's own button and panel: it must keep its real colours.
      const nat = ['video', 'shuteye-ui', 'iframe' + N, 'frame' + N,
        'embed:not([type="application/pdf" i]):not([src*=".pdf" i])',
        'object:not([type="application/pdf" i]):not([data*=".pdf" i])'];
      if (imagesMode === 'smart') nat.push('img:not([' + ATTR + '="inv"])', 'svg image', 'input[type="image"]', N);
      if (imagesMode === 'natural') nat.push('img', 'svg image', 'input[type="image"]', 'canvas', N);
      // Pictures can be dimmed a little before they are restored.
      const Rm = (cfg.imageDim < 100 ? 'brightness(' + cfg.imageDim + '%) ' : '') + R;
      css += nat.join(',\n') + ' { -webkit-filter: ' + Rm + ' !important; filter: ' + Rm + ' !important; }\n';
      css += 'shuteye-ui, iframe' + N + ', frame' + N + ' { -webkit-filter: ' + R + ' !important; filter: ' + R + ' !important; }\n';

      // Anything inside an element that is already restored must not be flipped again.
      const inner = ['img', 'video', 'image', 'canvas', 'embed', 'object', 'iframe', 'input', N];
      css += inner.map(function (sel) { return ':root:root ' + N + ' ' + sel; }).join(',\n') +
        ' { -webkit-filter: none !important; filter: none !important; }\n';

      // Fullscreen elements are shown outside the page filter, so nothing inside needs undoing.
      css += ':root:root :fullscreen, :root:root :fullscreen * { -webkit-filter: none !important; filter: none !important; }\n';
      css += ':root:root :-webkit-full-screen, :root:root :-webkit-full-screen * { -webkit-filter: none !important; filter: none !important; }\n';
    }
    return css + '}\n';
  }

  function writeCss() {
    const css = buildCss();
    if (css !== lastCss || styleEl.textContent !== css) {
      styleEl.textContent = css;
      lastCss = css;
    }
  }

  function ensureDom() {
    const root = doc.documentElement;
    if (!root) return;
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = STYLE_ID;
      layers = [BACKDROP, TONE_A, TONE_B].map(function (tag) {
        const el = doc.createElement(tag);
        el.setAttribute('aria-hidden', 'true');
        return el;
      });
    }
    if (styleEl.parentNode !== root) root.appendChild(styleEl);
    for (let i = 0; i < layers.length; i++) if (layers[i].parentNode !== root) root.appendChild(layers[i]);
  }

  function domIntact() {
    const root = doc.documentElement;
    if (!styleEl || styleEl.parentNode !== root) return false;
    for (let i = 0; i < layers.length; i++) if (layers[i].parentNode !== root) return false;
    return true;
  }

  // Once <body> exists, park our nodes at the very end of <html>.
  function tidyDom() {
    const root = doc.documentElement;
    if (mode === 'off' || !root || !doc.body || !styleEl) return;
    if (root.lastElementChild !== layers[2] || root.firstElementChild === styleEl) {
      root.appendChild(styleEl);
      for (let i = 0; i < layers.length; i++) root.appendChild(layers[i]);
    }
  }

  function removeDom() {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    for (let i = 0; i < layers.length; i++) if (layers[i].parentNode) layers[i].parentNode.removeChild(layers[i]);
    lastCss = '';
  }

  // Tints Safari's toolbar to match (it follows <meta name="theme-color">).
  function setThemeColor() {
    if (!isTop || !doc.head) return;
    const on = mode === 'full';
    const metas = doc.querySelectorAll('meta[name="theme-color"]');
    if (on) {
      const colour = NR.css(NR.mapColor(baseColour() || WHITE, NR.matrix(currentTone(), 'full')));
      if (!metas.length) {
        const m = doc.createElement('meta');
        m.name = 'theme-color';
        m.content = colour;
        m.setAttribute('data-se-added', '');
        doc.head.appendChild(m);
        return;
      }
      metas.forEach(function (m) {
        if (!m.hasAttribute('data-se-added') && !m.hasAttribute('data-se-orig')) {
          m.setAttribute('data-se-orig', m.getAttribute('content') || '');
        }
        if (m.getAttribute('content') !== colour) m.setAttribute('content', colour);
      });
    } else {
      metas.forEach(function (m) {
        if (m.hasAttribute('data-se-added')) m.remove();
        else if (m.hasAttribute('data-se-orig')) {
          m.setAttribute('content', m.getAttribute('data-se-orig'));
          m.removeAttribute('data-se-orig');
        }
      });
    }
  }

  /* ---------- Is the page already dark? ---------- */

  function solid(c, min) { return !!c && c[3] > (min || 0.5); }

  function detect() {
    lastDetect = Date.now();
    const root = doc.documentElement, body = doc.body;
    if (!root || !body) return;

    let canvas = null, text = null, dark = 0, light = 0;
    const sheet = styleEl && styleEl.sheet;
    if (sheet) sheet.disabled = true;          // measure the page's own colours, not ours
    try {
      const hb = NR.parseColor(getComputedStyle(root).backgroundColor);
      const bs = getComputedStyle(body);
      const bb = NR.parseColor(bs.backgroundColor);
      text = NR.parseColor(bs.color);
      canvas = solid(hb) ? hb : (solid(bb) ? bb : null);

      const w = win.innerWidth, h = win.innerHeight;
      if (w > 40 && h > 40 && doc.elementsFromPoint) {
        const pts = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75]];
        for (let i = 0; i < pts.length; i++) {
          const stack = doc.elementsFromPoint(pts[i][0] * w, pts[i][1] * h);
          let found = null;
          for (let j = 0; j < stack.length && j < 40; j++) {
            const el = stack[j];
            const tag = el.tagName;
            if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
              found = 'media';
              break;
            }
            const cs = getComputedStyle(el);
            const c = NR.parseColor(cs.backgroundColor);
            if (solid(c, 0.9)) { found = c; break; }
            if (el !== root && el !== body && cs.backgroundImage !== 'none') { found = 'media'; break; }
          }
          if (found === null) found = canvas;
          if (found === 'media') continue;
          if (found) { if (NR.lum(found) < DARK_BELOW) dark++; else light++; }
          else if (text) { if (NR.lum(text) > 0.6) dark++; else light++; }   // see-through page: light text means a dark theme
        }
      }
    } catch (e) { /* keep whatever we have */ }
    finally { if (sheet) sheet.disabled = false; }

    let isDark;
    if (dark !== light) isDark = dark > light;
    else if (canvas) isDark = NR.lum(canvas) < DARK_BELOW;
    else isDark = text ? NR.lum(text) > 0.6 : false;

    const canvasKey = canvas ? canvas.join(',') : '';
    const changed = isDark !== pageDark || canvasKey !== (origCanvas ? origCanvas.join(',') : '');
    pageDark = isDark;
    origCanvas = canvas;
    if (loaded) remember(isDark);
    const moved = lastPath !== sitePath();     // single-page apps change section without reloading
    lastPath = sitePath();
    if (changed || moved) apply();
  }

  // Remember dark sites so they never flash on the next visit.
  function remember(isDark) {
    if (!ownHost || !!darkHosts[ownHost] === isDark) return;
    if (isDark) darkHosts[ownHost] = Date.now(); else delete darkHosts[ownHost];
    api.storage.local.get('darkHosts').then(function (d) {
      const map = (d && d.darkHosts) || {};
      if (isDark) map[ownHost] = Date.now(); else delete map[ownHost];
      const keys = Object.keys(map);
      if (keys.length > 400) {
        keys.sort(function (a, b) { return map[a] - map[b]; });
        for (let i = 0; i < keys.length - 400; i++) delete map[keys[i]];
      }
      return api.storage.local.set({ darkHosts: map });
    }).catch(function () { /* storage unavailable */ });
  }

  let detectTimer = 0, lastDetect = 0;
  function scheduleDetect(minGap) {
    if (detectTimer) return;
    const wait = Math.max(300, minGap - (Date.now() - lastDetect));
    detectTimer = setTimeout(function () { detectTimer = 0; detect(); }, wait);
  }

  /* ---------- Watching the page ---------- */

  let observer = null, attrObserver = null, watching = false, bodySeen = false;

  function watch(on) {
    if (on === watching) { if (on) watchAttrs(); return; }
    watching = on;
    if (on) {
      if (!observer) observer = new MutationObserver(onMutations);
      observer.observe(doc, { childList: true, subtree: true });
      watchAttrs();
    } else {
      if (observer) observer.disconnect();
      if (attrObserver) attrObserver.disconnect();
      attrWatched = null;
    }
  }

  // A theme switch on the site usually changes a class on <html> or <body>.
  let attrWatched = null;
  function watchAttrs() {
    const body = doc.body;
    if (!watching || !body || attrWatched === body) return;
    if (!attrObserver) attrObserver = new MutationObserver(function () { scheduleDetect(350); });
    attrObserver.disconnect();
    attrObserver.observe(doc.documentElement, { attributes: true });
    attrObserver.observe(body, { attributes: true });
    attrWatched = body;
  }

  function onMutations(records) {
    if (mode !== 'off' && !domIntact()) ensureDom();
    if (!bodySeen && doc.body) {
      bodySeen = true;
      detect();                 // first look, before the page is painted
      watchAttrs();
    } else {
      scheduleDetect(2500);
    }
    if (workOn && imagesMode !== 'invert') {
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1 && treeQueue.length < 3000) treeQueue.push(added[j]);
        }
      }
      if (treeQueue.length) schedulePump();
    }
  }

  /* ---------- Images, canvases and CSS backgrounds ---------- */

  let workOn = false, pumpTimer = 0, canvasTimer = 0, canvasSoon = 0;
  let seen = new WeakSet(), imgDone = new WeakMap();
  const treeQueue = [], imgQueue = [];
  const verdicts = new Map();       // image URL -> 'inv' | 'nat' | 'unk'
  const waiting = new Map();        // image URL -> callbacks while a probe is running
  const canvases = new Set();
  let walker = null, scanned = 0, probes = 0, probing = 0;
  const probeQueue = [];
  let probeCanvas = null;

  function startWork(reset) {
    if (!workOn) {
      workOn = true;
      reset = true;
      doc.addEventListener('load', onLoadCapture, true);
      canvasTimer = setInterval(checkCanvases, 4000);
    }
    if (reset) {
      seen = new WeakSet();
      imgDone = new WeakMap();
      treeQueue.length = 0;
      imgQueue.length = 0;
      walker = null;
      scanned = 0;
      if (imagesMode !== 'invert') {
        if (doc.body) treeQueue.push(doc.body);
        const imgs = doc.images;
        for (let i = 0; i < imgs.length; i++) imgQueue.push(imgs[i]);
      }
      queueCanvasCheck();
    }
    schedulePump();
  }

  function stopWork() {
    if (!workOn) return;
    workOn = false;
    doc.removeEventListener('load', onLoadCapture, true);
    clearInterval(canvasTimer);
    clearTimeout(pumpTimer);
    pumpTimer = 0;
  }

  function onLoadCapture(e) {
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (t.tagName === 'IMG') { imgQueue.push(t); schedulePump(); }
    else if (t.tagName === 'IFRAME') setTimeout(sweepFrames, 700);
  }

  function schedulePump() {
    if (!pumpTimer && workOn) pumpTimer = setTimeout(pump, 16);
  }

  // Does a little work, then yields, so scrolling never stutters.
  function pump() {
    pumpTimer = 0;
    if (!workOn || imagesMode === 'invert') return;
    const t0 = performance.now();
    let more = true;
    while (performance.now() - t0 < 8) {
      if (imgQueue.length) { handleImg(imgQueue.pop()); continue; }
      if (!walker) {
        const next = treeQueue.shift();
        if (!next) { more = false; break; }
        if (!next.isConnected || scanned >= MAX_SCAN) continue;
        walker = doc.createTreeWalker(next, NodeFilter.SHOW_ELEMENT, skipFilter);
        visit(next);
        continue;
      }
      const el = walker.nextNode();
      if (!el || scanned >= MAX_SCAN) { walker = null; continue; }
      visit(el);
    }
    if (more) schedulePump();
  }

  const SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, HEAD: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, svg: 1, BR: 1, HR: 1 };
  const skipFilter = {
    acceptNode: function (el) {
      return SKIP[el.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  };

  function visit(el) {
    if (seen.has(el)) return;
    seen.add(el);
    scanned++;
    const tag = el.tagName;
    if (SKIP[tag] || tag.indexOf('SHUTEYE-') === 0) return;
    if (tag === 'IMG') { handleImg(el); return; }
    if (tag === 'CANVAS') { canvases.add(el); queueCanvasCheck(); return; }
    if (tag === 'VIDEO' || tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') return;
    checkBackground(el);
  }

  function mark(el, verdict) {
    if (verdict === 'inv' || verdict === 'nat') {
      if (el.getAttribute(ATTR) !== verdict) el.setAttribute(ATTR, verdict);
    } else if (el.hasAttribute(ATTR)) {
      el.removeAttribute(ATTR);
    }
  }

  // Draws onto a 32x32 scratch canvas and classifies the pixels.
  function analyze(source) {
    if (!probeCanvas) probeCanvas = doc.createElement('canvas');
    probeCanvas.width = 32;
    probeCanvas.height = 32;
    try {
      const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, 32, 32);
      return NR.classifyPixels(ctx.getImageData(0, 0, 32, 32).data);
    } catch (e) {
      probeCanvas = null;       // a tainted canvas stays unreadable, so start fresh next time
      return e && e.name === 'SecurityError' ? 'tainted' : 'empty';
    }
  }

  // Formulas are black text on a see-through background: always keep them inverted.
  function looksLikeMath(img, src) {
    const cls = typeof img.className === 'string' ? img.className : '';
    return /(^|[\s_-])(mwe-math|latex|tex|math|formula|equation)/i.test(cls) ||
      /\/math\/render\/|latex|mathtex|codecogs/i.test(src);
  }

  function handleImg(img) {
    if (imagesMode !== 'smart' || !img || !img.isConnected) return;
    if (!img.complete || !img.naturalWidth) return;         // its load event will bring it back
    const src = img.currentSrc || img.src;
    if (!src || imgDone.get(img) === src) return;
    imgDone.set(img, src);
    if (img.naturalWidth < 4 || img.naturalHeight < 4) { mark(img, null); return; }
    if (looksLikeMath(img, src)) { mark(img, 'inv'); return; }

    const cached = verdicts.get(src);
    if (cached) { mark(img, cached === 'inv' ? 'inv' : null); return; }

    const v = analyze(img);
    if (v === 'inv' || v === 'nat') {
      verdicts.set(src, v);
      mark(img, v === 'inv' ? 'inv' : null);
      return;
    }
    mark(img, null);
    if (v !== 'tainted') return;

    // Cross-site image: ask for a readable copy. Small JPEGs are photos, skip those.
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const isJpeg = /\.jpe?g(\?|#|$)/i.test(src);
    if (isJpeg && (w < 300 || h < 380)) { verdicts.set(src, 'nat'); return; }
    classifyUrl(src, function (verdict) {
      if (img.isConnected && (img.currentSrc || img.src) === src) mark(img, verdict === 'inv' ? 'inv' : null);
    });
  }

  function classifyUrl(url, done) {
    const known = verdicts.get(url);
    if (known) { done(known); return; }
    if (!/^(https?:|data:|blob:)/i.test(url)) { done('unk'); return; }
    const list = waiting.get(url);
    if (list) { list.push(done); return; }
    if (probes >= MAX_PROBES) { done('unk'); return; }
    probes++;
    waiting.set(url, [done]);
    probeQueue.push(url);
    runProbes();
  }

  function runProbes() {
    while (probing < 3 && probeQueue.length) {
      const url = probeQueue.shift();
      probing++;
      const im = new Image();
      let settled = false;
      const finish = function (verdict) {
        if (settled) return;
        settled = true;
        probing--;
        verdicts.set(url, verdict);
        const list = waiting.get(url) || [];
        waiting.delete(url);
        for (let i = 0; i < list.length; i++) list[i](verdict);
        runProbes();
      };
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        const v = analyze(im);
        finish(v === 'inv' || v === 'nat' ? v : 'unk');
      };
      im.onerror = function () { finish('unk'); };
      setTimeout(function () { finish('unk'); }, 15000);
      im.src = url;
    }
  }

  // Photos set as CSS backgrounds (hero banners, cards) are restored too.
  function checkBackground(el) {
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage;
    if (!bi || bi === 'none' || bi.indexOf('url(') < 0) return;
    if (el === doc.body || el === doc.documentElement) return;
    if (el.offsetWidth < 64 || el.offsetHeight < 64) return;                 // icons and sprites stay inverted
    if (cs.backgroundRepeat.indexOf('no-repeat') < 0 && /auto/.test(cs.backgroundSize)) return;   // tiled texture
    if ((el.textContent || '').trim().length > 300) return;                  // a text container, not a picture
    const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(bi);
    if (!m || !m[2]) return;
    const url = m[2];
    if (imagesMode === 'natural') { mark(el, 'nat'); return; }
    classifyUrl(url, function (verdict) {
      if (!el.isConnected) return;
      if (verdict === 'nat' || (verdict === 'unk' && /\.(jpe?g|webp|avif)(\?|#|$)/i.test(url))) mark(el, 'nat');
    });
  }

  function queueCanvasCheck() {
    if (canvasSoon) return;
    canvasSoon = setTimeout(function () {
      canvasSoon = 0;
      checkCanvases();
      setTimeout(checkCanvases, 1500);
    }, 350);
  }

  // Canvases change over time (PDF pages render in, charts animate), so re-check them.
  function checkCanvases() {
    if (!workOn || imagesMode !== 'smart' || !canvases.size || doc.hidden) return;
    let ran = false;
    const run = function () {
      if (ran) return;
      ran = true;
      let n = 0;
      canvases.forEach(function (c) {
        if (!c.isConnected) { canvases.delete(c); return; }
        if (++n > 40 || c.width < 32 || c.height < 32) return;
        const v = analyze(c);
        // White pages and charts stay inverted (dark). Photos, games and maps are restored.
        mark(c, v === 'nat' || v === 'tainted' ? 'nat' : null);
      });
    };
    // Right after the page's own drawing, so WebGL canvases can still be read.
    if (win.requestAnimationFrame) win.requestAnimationFrame(run);
    setTimeout(run, 150);
  }

  /* ---------- Frames ---------- */

  function hello() {
    if (isTop) return;
    try { win.parent.postMessage({ __shuteye: 'hello' }, '*'); } catch (e) { /* detached */ }
  }

  function frameList() { return doc.querySelectorAll('iframe, frame, object'); }

  function notifyChildren() {
    lastChildCtx = childCtx();
    const frames = frameList();
    for (let i = 0; i < frames.length; i++) {
      try {
        const w = frames[i].contentWindow;
        if (w) w.postMessage({ __shuteye: 'ctx', active: lastChildCtx, known: frames[i].getAttribute(ATTR) === 'nat' }, '*');
      } catch (e) { /* frame gone */ }
    }
  }

  win.addEventListener('message', function (e) {
    const d = e.data;
    if (!d || typeof d !== 'object' || !d.__shuteye) return;
    if (d.__shuteye === 'hello') {
      // A frame running ShutEye darkens itself, so show it un-flipped.
      let known = false;
      const frames = frameList();
      for (let i = 0; i < frames.length; i++) {
        let w = null;
        try { w = frames[i].contentWindow; } catch (err) { /* ignore */ }
        if (w && w === e.source) {
          if (frames[i].tagName !== 'OBJECT') { mark(frames[i], 'nat'); known = true; }
          break;
        }
      }
      try { e.source.postMessage({ __shuteye: 'ctx', active: childCtx(), known: known }, '*'); } catch (err) { /* gone */ }
    } else if (d.__shuteye === 'ctx' && !isTop && e.source === win.parent) {
      const nextCtx = !!d.active, nextInv = !!d.active && !d.known;
      if (nextCtx !== ctxActive || nextInv !== parentInverts) {
        ctxActive = nextCtx;
        parentInverts = nextInv;
        apply();
        if (childCtx() !== lastChildCtx) notifyChildren();
      }
    }
  });

  // Same-origin frames where the extension did not load (some blob: or srcdoc
  // frames) are inverted with the page, so their pictures need undoing here.
  function sweepFrames() {
    const on = mode === 'full' || mode === 'rev';
    const frames = doc.querySelectorAll('iframe:not([' + ATTR + '="nat"])');
    for (let i = 0; i < frames.length; i++) {
      let d = null;
      try { d = frames[i].contentDocument; } catch (e) { /* cross-origin */ }
      if (!d || !d.documentElement || d.readyState === 'loading') continue;
      let s = d.getElementById('shuteye-fallback');
      if (on && !s && imagesMode !== 'invert') {
        s = d.createElement('style');
        s.id = 'shuteye-fallback';
        s.textContent = 'img, video { -webkit-filter: ' + NR.REVERSE + ' !important; filter: ' + NR.REVERSE + ' !important; }';
        (d.head || d.documentElement).appendChild(s);
      } else if (s && (!on || imagesMode === 'invert')) {
        s.remove();
      }
    }
  }

  /* ---------- Wiring ---------- */

  function load() {
    return api.storage.local.get(['cfg', 'darkHosts']).then(function (d) {
      cfg = NR.normalize(d && d.cfg);
      darkHosts = (d && d.darkHosts) || {};
    }).catch(function () { /* keep defaults */ }).then(function () {
      if (pageDark === null && ownHost && darkHosts[ownHost]) pageDark = true;
      ready = true;
      apply();
      if (doc.body) { bodySeen = true; detect(); }
    });
  }

  api.storage.onChanged.addListener(function (changes, area) {
    if (area && area !== 'local') return;
    if (changes.darkHosts) darkHosts = changes.darkHosts.newValue || {};
    if (changes.cfg) {
      cfg = NR.normalize(changes.cfg.newValue);
      apply(true);
      if (!isTop) setTimeout(hello, 200);
    }
  });

  // The popup asks the top frame what is going on.
  if (api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!isTop || !msg || msg.type !== 'shuteye-status') return;
      sendResponse({ host: siteHost, reason: reason, active: mode === 'full', pageDark: pageDark, isPdf: isPdfDoc, url: location.href });
    });
  }

  if (sysDark.addEventListener) sysDark.addEventListener('change', function () { apply(true); });
  setInterval(function () { if (cfg.schedule === 'time' && !doc.hidden) apply(true); }, 30000);

  doc.addEventListener('DOMContentLoaded', function () {
    bodySeen = true;
    tidyDom();
    detect();
    setThemeColor();
  });
  win.addEventListener('load', function () {
    loaded = true;
    detect();
    setTimeout(detect, 1500);
  });
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) return;
    apply();
    scheduleDetect(1000);
    hello();
  });
  win.addEventListener('pageshow', function (e) { if (e.persisted) load(); });
  win.addEventListener('popstate', function () { if (lastPath !== sitePath()) { lastPath = sitePath(); apply(); } });

  hello();
  load();
})();
