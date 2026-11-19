/*
 * ShutEye — shared.js
 * Settings model, theme palettes and colour maths used by the content script,
 * the popup and the PDF reader. Loaded before each of them.
 */
(function (g) {
  'use strict';
  if (g.ShutEye) return;

  // Safari exposes both `browser` and `chrome`; Chrome/Edge only `chrome`.
  // The userscript build passes in its own storage (g.__shuteyeApi).
  const api = g.__shuteyeApi || ((g.browser && g.browser.storage) ? g.browser : g.chrome);

  /* ---------- Themes ----------
   * A theme is three colours: page background, body text and an accent.
   * ShutEye maps every site onto them: white becomes `bg`, black becomes `fg`,
   * and colours in between keep their hue.
   * To add your own theme, add a line here (or use the Custom theme in the popup).
   */
  const THEMES = [
    { id: 'midnight',  name: 'Midnight',    bg: '#000000', fg: '#ebe6df', accent: '#ff9d4d', note: 'True black for OLED' },
    { id: 'graphite',  name: 'Graphite',    bg: '#1c1c1e', fg: '#dedede', accent: '#f2b25c', note: 'Soft dark gray' },
    { id: 'ember',     name: 'Ember',       bg: '#1d1712', fg: '#ecdfc8', accent: '#e8a04c', note: 'Warm sepia for long reads', warm: 30 },
    { id: 'dracula',   name: 'Dracula',     bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9' },
    { id: 'monokai',   name: 'Monokai',     bg: '#272822', fg: '#f8f8f2', accent: '#a6e22e' },
    { id: 'nord',      name: 'Nord',        bg: '#2e3440', fg: '#e5e9f0', accent: '#88c0d0' },
    { id: 'tokyo',     name: 'Tokyo Night', bg: '#1a1b26', fg: '#c0caf5', accent: '#7aa2f7' },
    { id: 'mocha',     name: 'Catppuccin',  bg: '#1e1e2e', fg: '#cdd6f4', accent: '#cba6f7' },
    { id: 'gruvbox',   name: 'Gruvbox',     bg: '#282828', fg: '#ebdbb2', accent: '#fabd2f' },
    { id: 'solarized', name: 'Solarized',   bg: '#002b36', fg: '#a3b1b1', accent: '#2aa198' },
    { id: 'onedark',   name: 'One Dark',    bg: '#282c34', fg: '#c8ccd4', accent: '#61afef' },
    { id: 'rosepine',  name: 'Rosé Pine',   bg: '#191724', fg: '#e0def4', accent: '#ebbcba' },
    { id: 'synthwave', name: 'Synthwave',   bg: '#241b2f', fg: '#f6eefc', accent: '#ff7edb' },
    { id: 'phosphor',  name: 'Phosphor',    bg: '#030b05', fg: '#bdf5c8', accent: '#39ff7a' }
  ];

  // How a page changes when ShutEye switches on or off.
  const ANIMATIONS = [
    { id: 'blink',   name: 'Blink' },     // the page shuts like an eyelid
    { id: 'ripple',  name: 'Ripple' },    // the dark spreads out as a growing circle
    { id: 'fade',    name: 'Fade' },
    { id: 'curtain', name: 'Curtain' },
    { id: 'mist',    name: 'Mist' },
    { id: 'none',    name: 'Off' }
  ];

  const LIMITS = {
    brightness: [50, 120],
    contrast:   [60, 130],
    sepia:      [0, 80],
    imageDim:   [30, 100],
    gray:       [0, 100],
    animMs:     [150, 1500]
  };

  const DEFAULTS = {
    enabled: true,
    schedule: 'always',        // 'always' | 'system' | 'time'
    timeFrom: '20:00',
    timeTo: '07:00',
    defaultMode: 'all',        // 'all' = every site unless excluded, 'listed' = only sites set to Always
    autoDetect: true,          // leave sites alone that are already dark
    theme: 'midnight',         // a THEMES id, or 'custom'
    custom: { bg: '#14161f', fg: '#e6e9f5', accent: '#ff9d5c' },
    brightness: 100,           // fine-tuning on top of the theme
    contrast: 100,
    sepia: 0,                  // warmth
    gray: 0,                   // 100 = fully black and white, for fewer distractions
    imageDim: 100,             // brightness of photos and video, for bright pictures at night
    tint: true,                // colour themes; off = neutral gray version (compatibility)
    accentLinks: false,        // recolour links with the theme accent
    anim: 'blink',
    animMs: 500,
    images: 'smart',           // 'smart' | 'natural' | 'invert'
    sites: {},                 // "host" or "host/section" -> { mode: 'on' | 'off', images: 'natural' | 'invert' }
    reader: { dark: true, keepPhotos: true }
  };

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function num(v, key) {
    const n = Number(v);
    const lim = LIMITS[key];
    return (v !== undefined && v !== null && Number.isFinite(n)) ? clamp(Math.round(n), lim[0], lim[1]) : DEFAULTS[key];
  }

  function oneOf(v, list, fallback) { return list.indexOf(v) >= 0 ? v : fallback; }
  function validTime(v, fallback) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : fallback; }
  function validHex(v, fallback) { return /^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : fallback; }

  function themeById(id) {
    for (let i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return null;
  }

  // Always returns a complete, valid settings object, whatever was stored.
  function normalize(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const cc = (c.custom && typeof c.custom === 'object') ? c.custom : {};
    const out = {
      enabled: c.enabled !== false,
      schedule: oneOf(c.schedule, ['always', 'system', 'time'], DEFAULTS.schedule),
      timeFrom: validTime(c.timeFrom, DEFAULTS.timeFrom),
      timeTo: validTime(c.timeTo, DEFAULTS.timeTo),
      defaultMode: oneOf(c.defaultMode, ['all', 'listed'], DEFAULTS.defaultMode),
      autoDetect: c.autoDetect !== false,
      theme: (c.theme === 'custom' || themeById(c.theme)) ? c.theme : DEFAULTS.theme,
      custom: {
        bg: validHex(cc.bg, DEFAULTS.custom.bg),
        fg: validHex(cc.fg, DEFAULTS.custom.fg),
        accent: validHex(cc.accent, DEFAULTS.custom.accent)
      },
      brightness: num(c.brightness, 'brightness'),
      contrast: num(c.contrast, 'contrast'),
      sepia: num(c.sepia, 'sepia'),
      imageDim: num(c.imageDim, 'imageDim'),
      gray: num(c.gray, 'gray'),
      tint: c.tint !== false,
      accentLinks: c.accentLinks === true,
      anim: oneOf(c.anim, ANIMATIONS.map(function (a) { return a.id; }), DEFAULTS.anim),
      animMs: num(c.animMs, 'animMs'),
      images: oneOf(c.images, ['smart', 'natural', 'invert'], DEFAULTS.images),
      sites: {},
      reader: {
        dark: !(c.reader && c.reader.dark === false),
        keepPhotos: !(c.reader && c.reader.keepPhotos === false)
      }
    };
    if (c.sites && typeof c.sites === 'object') {
      for (const host of Object.keys(c.sites)) {
        const r = c.sites[host] || {};
        const rule = {};
        if (r.mode === 'on' || r.mode === 'off') rule.mode = r.mode;
        if (r.images === 'natural' || r.images === 'invert') rule.images = r.images;
        if (rule.mode || rule.images) out.sites[cleanHost(host)] = rule;
      }
    }
    return out;
  }

  /* ---------- Sites ---------- */

  function cleanHost(host) {
    return String(host || '').trim().toLowerCase().replace(/^www\./, '');
  }

  // The first part of a path: "/document/d/abc" -> "document". Lets one site have
  // separate rules for its sections (Google Docs but not Google Sheets, say).
  function sectionOf(path) {
    const m = /^\/+([^/?#]+)/.exec(String(path || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // Finds the rule for a page. A section rule ("docs.google.com/document") beats
  // a site rule, and a rule for "wikipedia.org" also covers "en.wikipedia.org".
  function siteRule(cfg, host, path) {
    let h = cleanHost(host);
    const sites = cfg.sites || {}, section = sectionOf(path);
    const found = function (key) { return { key: key, mode: sites[key].mode || 'auto', images: sites[key].images || null }; };
    while (h) {
      if (section && Object.prototype.hasOwnProperty.call(sites, h + '/' + section)) return found(h + '/' + section);
      if (Object.prototype.hasOwnProperty.call(sites, h)) return found(h);
      const dot = h.indexOf('.');
      if (dot < 0 || h.indexOf('.', dot + 1) < 0) break;   // stop before the bare TLD
      h = h.slice(dot + 1);
    }
    return { key: null, mode: 'auto', images: null };
  }

  function setSiteRule(cfg, host, patch) {
    const h = cleanHost(host);
    if (!h) return;
    const next = Object.assign({}, cfg.sites[h], patch);
    if (next.mode !== 'on' && next.mode !== 'off') delete next.mode;
    if (next.images !== 'natural' && next.images !== 'invert') delete next.images;
    if (next.mode || next.images) cfg.sites[h] = next; else delete cfg.sites[h];
  }

  /* ---------- Schedule ---------- */

  function minutes(hhmm) {
    const p = hhmm.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  // Is dark mode allowed to run right now?
  function scheduleOn(cfg, now, systemIsDark) {
    if (cfg.schedule === 'system') return !!systemIsDark;
    if (cfg.schedule === 'time') {
      const t = now.getHours() * 60 + now.getMinutes();
      const from = minutes(cfg.timeFrom), to = minutes(cfg.timeTo);
      if (from === to) return true;
      return from < to ? (t >= from && t < to) : (t >= from || t < to);
    }
    return true;
  }

  /* ---------- Colour helpers ---------- */

  function hex(str) {
    return [parseInt(str.slice(1, 3), 16), parseInt(str.slice(3, 5), 16), parseInt(str.slice(5, 7), 16)];
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2); }).join('');
  }
  function css(rgb) { return 'rgb(' + Math.round(rgb[0]) + ', ' + Math.round(rgb[1]) + ', ' + Math.round(rgb[2]) + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // Perceived lightness, 0 (black) to 1 (white).
  function lum(rgb) { return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; }

  // Parses a computed-style colour. Returns [r, g, b, a] or null.
  function parseColor(str) {
    if (!str) return null;
    if (str === 'transparent') return [0, 0, 0, 0];
    let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(str);
    let scale = 1;
    if (!m) {
      m = /^color\(\s*(?:srgb|display-p3)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(str);
      scale = 255;
    }
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) a = m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]) * scale, Number(m[2]) * scale, Number(m[3]) * scale, a];
  }

  // The active palette as [r,g,b] arrays.
  function palette(cfg) {
    const t = cfg.theme === 'custom' ? cfg.custom : (themeById(cfg.theme) || THEMES[1]);
    return {
      id: cfg.theme,
      name: cfg.theme === 'custom' ? 'Custom' : t.name,
      bg: hex(t.bg), fg: hex(t.fg), accent: hex(t.accent)
    };
  }

  /* ---------- Colour transforms ----------
   * Everything ShutEye does to a pixel is a 3x3 matrix plus an offset ("affine").
   * Keeping it as maths lets us predict the result of the CSS filters, which is
   * how the popup previews themes and how the PDF reader recolours pages.
   */

  function aff(m, o) { return { m: m, o: o || [0, 0, 0] }; }
  function scaleAff(s, o) { return aff([s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]], o); }

  // "a then b"
  function then(a, b) {
    const m = new Array(9), o = new Array(3);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m[i * 3 + j] = b.m[i * 3] * a.m[j] + b.m[i * 3 + 1] * a.m[3 + j] + b.m[i * 3 + 2] * a.m[6 + j];
      }
      o[i] = b.m[i * 3] * a.o[0] + b.m[i * 3 + 1] * a.o[1] + b.m[i * 3 + 2] * a.o[2] + b.o[i];
    }
    return aff(m, o);
  }
  function chainAff(list) {
    let r = scaleAff([1, 1, 1]);
    for (let i = 0; i < list.length; i++) r = then(r, list[i]);
    return r;
  }

  const INVERT = scaleAff([-1, -1, -1], [1, 1, 1]);
  const HUE180 = aff([-0.574, 1.430, 0.144, 0.426, 0.430, 0.144, 0.426, 1.430, -0.856]);
  // invert + hue-rotate(180deg): light and dark swap, hues stay (blue links stay blue).
  const FLIP = then(INVERT, HUE180);

  function contrastAff(c) { return scaleAff([c, c, c], [0.5 - 0.5 * c, 0.5 - 0.5 * c, 0.5 - 0.5 * c]); }
  function brightAff(b) { return scaleAff([b, b, b]); }
  function grayAff(s) {
    const k = 1 - s;
    return aff([
      0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k,
      0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k,
      0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k
    ]);
  }
  function sepiaAff(s) {
    const k = 1 - s;
    return aff([
      0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
      0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
      0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k
    ]);
  }

  // Applies a transform to a 0-255 colour.
  function mapColor(rgb, t) {
    const r = rgb[0] / 255, g2 = rgb[1] / 255, b = rgb[2] / 255, m = t.m, o = t.o;
    return [
      Math.round(clamp01(m[0] * r + m[1] * g2 + m[2] * b + o[0]) * 255),
      Math.round(clamp01(m[3] * r + m[4] * g2 + m[5] * b + o[1]) * 255),
      Math.round(clamp01(m[6] * r + m[7] * g2 + m[8] * b + o[2]) * 255)
    ];
  }

  // Which colour ends up as `rgb` after transform t? (Used for accent-coloured links.)
  function preimage(rgb, t) {
    const m = t.m;
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (Math.abs(det) < 1e-6) return rgb;
    const inv = [
      (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
      (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
      (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det
    ];
    const v = [rgb[0] / 255 - t.o[0], rgb[1] / 255 - t.o[1], rgb[2] / 255 - t.o[2]];
    return [
      Math.round(clamp01(inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2]) * 255),
      Math.round(clamp01(inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2]) * 255),
      Math.round(clamp01(inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2]) * 255)
    ];
  }

  function isGray(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) <= 2; }

  // Undoes the flip on photos and video: applied to an element inside a flipped
  // page, it puts the original colours back.
  const REVERSE = 'invert(1) hue-rotate(180deg)';

  function pct(v) { return (Math.round(v * 1000) / 10) + '%'; }

  /*
   * Works out how to produce the active theme.
   *
   * Gray themes need nothing but CSS filter functions: contrast() lifts black up
   * to the theme background and brightness() sets the text level.
   *
   * Colour themes (Dracula, Nord...) cannot be made that way, because filter
   * functions treat red, green and blue alike. For those, two see-through
   * layers are laid over the page before it is flipped:
   *     screen layer    lifts the darkest tone to a chosen colour
   *     multiply layer  pulls the lightest tone down to a chosen colour
   * Together they remap each channel separately, so after the flip white lands
   * exactly on the theme background and black exactly on the theme text colour.
   *
   * allowTint = false gives the gray equivalent (used inside frames, and when
   * the user turns colour tint off).
   */
  function tone(cfg, allowTint) {
    const p = palette(cfg);
    const tinted = !!allowTint && cfg.tint && !(isGray(p.bg) && isGray(p.fg));
    const out = { tinted: tinted, palette: p, screen: null, multiply: null, pre: null, post: [] };
    let filter = REVERSE;

    if (tinted) {
      const bgPre = mapColor(p.bg, FLIP);       // light colour that flips to the theme background
      const fgPre = mapColor(p.fg, FLIP);       // dark colour that flips to the theme text
      const mult = bgPre.map(function (v) { return Math.max(v, 8); });
      const scr = fgPre.map(function (v, i) { return Math.min(255, Math.round(255 * v / mult[i])); });
      out.multiply = css(mult);
      out.screen = css(scr);
      // multiply(screen(x)) per channel = m*s + x*m*(1-s)
      out.pre = scaleAff(
        mult.map(function (m, i) { return (m / 255) * (1 - scr[i] / 255); }),
        mult.map(function (m, i) { return (m / 255) * (scr[i] / 255); })
      );
    } else {
      const lb = lum(p.bg), lf = lum(p.fg);
      if (lf > lb + 0.05) {
        const c = (lf - lb) / (lf + lb), b = lf + lb;
        out.post.push(contrastAff(c), brightAff(b));
        filter += ' contrast(' + pct(c) + ') brightness(' + pct(b) + ')';
      }
    }
    if (cfg.contrast !== 100) { out.post.push(contrastAff(cfg.contrast / 100)); filter += ' contrast(' + cfg.contrast + '%)'; }
    if (cfg.brightness !== 100) { out.post.push(brightAff(cfg.brightness / 100)); filter += ' brightness(' + cfg.brightness + '%)'; }
    if (cfg.gray > 0) { out.post.push(grayAff(cfg.gray / 100)); filter += ' grayscale(' + cfg.gray + '%)'; }
    if (cfg.sepia > 0) { out.post.push(sepiaAff(cfg.sepia / 100)); filter += ' sepia(' + cfg.sepia + '%)'; }
    out.filter = filter;
    return out;
  }

  /*
   * The transform a pixel goes through.
   *   'full'    a normal page pixel: (tint layers) -> flip -> tone
   *   'photo'   a restored photo: its flip is undone, only the tone remains
   *   'reverse' flip only
   */
  function matrix(t, kind) {
    if (kind === 'reverse') return FLIP;
    const list = [];
    if (kind === 'full') {
      if (t.pre) list.push(t.pre);
      list.push(FLIP);
    } else if (t.pre) {
      list.push(FLIP, t.pre, FLIP);
    }
    return chainAff(list.concat(t.post));
  }

  /* ---------- Image classifier ----------
   * Decides whether a picture should stay flipped with the page ('inv': diagrams,
   * formulas, line art, scanned pages) or be restored to its real colours
   * ('nat': photos, artwork). Works on a tiny thumbnail, so it is fast.
   * Returns 'inv', 'nat' or 'empty' (nothing drawn yet).
   */
  function classifyPixels(data) {
    let total = 0, clear = 0, light = 0, dark = 0, colourful = 0;
    for (let i = 0; i < data.length; i += 4) {
      total++;
      if (data[i + 3] < 40) { clear++; continue; }
      const r = data[i], g2 = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), sat = mx - mn;
      const l = (0.2126 * r + 0.7152 * g2 + 0.0722 * b) / 255;
      if (l > 0.8 && sat < 80) light++;
      else if (l < 0.25 && sat < 70) dark++;
      else if (sat >= 90) colourful++;
    }
    const solid = total - clear;
    if (!total || solid / total < 0.02) return 'empty';
    const clearF = clear / total, lightF = light / solid, darkF = dark / solid, colF = colourful / solid;
    if (colF >= 0.12) return 'nat';                         // real colour content: keep it natural
    if (clearF >= 0.2) return darkF >= 0.3 ? 'inv' : 'nat'; // dark ink on a see-through background
    return lightF >= 0.55 ? 'inv' : 'nat';                  // white paper: diagram, chart or scan
  }

  /* ---------- The fox ----------
   * ShutEye's mascot, as plain coordinates so the popup (SVG), the toolbar icon
   * (canvas) and the app icon (tools/make-icons.js) all draw the same animal.
   */
  const FOX = {
    box: [1, -3, 56, 48],                                   // x, y, width, height
    head: [[8, 5], [18, 13], [30, 13], [40, 5], [42, 22], [33, 34], [24, 41], [15, 34], [6, 22]],
    ears: [[[10.2, 9.2], [16, 14.2], [9.6, 18.5]], [[37.8, 9.2], [32, 14.2], [38.4, 18.5]]],
    cheeks: [[[6, 22], [15, 34], [24, 41], [24, 31], [16, 26]], [[42, 22], [33, 34], [24, 41], [24, 31], [32, 26]]],
    nose: [24, 39.2, 2.3],
    lids: [[[13.2, 24], [16.5, 27.2], [19.8, 24]], [[28.2, 24], [31.5, 27.2], [34.8, 24]]],   // closed eyes: start, bend, end
    eyes: [[16.5, 24.8, 2], [31.5, 24.8, 2]],                // open eyes: x, y, radius
    zs: [[[44.5, 10], [49, 10], [44.5, 15.2], [49, 15.2]], [[50, 1], [53.5, 1], [50, 5], [53.5, 5]]]
  };

  function pts(list) { return list.map(function (p) { return p[0] + ',' + p[1]; }).join(' '); }

  // The fox as SVG markup. Colours and the asleep/awake states come from CSS.
  function foxSvg() {
    const f = FOX;
    return '<svg class="fox" viewBox="' + f.box.join(' ') + '" aria-hidden="true"><g class="fox-head">' +
      '<polygon class="fox-fur" points="' + pts(f.head) + '"/>' +
      f.ears.map(function (e) { return '<polygon class="fox-ear" points="' + pts(e) + '"/>'; }).join('') +
      f.cheeks.map(function (c) { return '<polygon class="fox-cheek" points="' + pts(c) + '"/>'; }).join('') +
      '<circle class="fox-nose" cx="' + f.nose[0] + '" cy="' + f.nose[1] + '" r="' + f.nose[2] + '"/>' +
      f.lids.map(function (l) {
        return '<path class="fox-lid" d="M' + l[0][0] + ' ' + l[0][1] + ' Q' + l[1][0] + ' ' + l[1][1] + ' ' + l[2][0] + ' ' + l[2][1] + '"/>';
      }).join('') +
      f.eyes.map(function (e) { return '<circle class="fox-eye" cx="' + e[0] + '" cy="' + e[1] + '" r="' + e[2] + '"/>'; }).join('') +
      '</g><g class="fox-zz">' +
      f.zs.map(function (z, i) { return '<polyline class="fox-z fox-z' + (i + 1) + '" points="' + pts(z) + '"/>'; }).join('') +
      '</g></svg>';
  }

  // The sleeping fox on a canvas, in the given colours (used for the toolbar icon).
  function drawFox(ctx, size, col) {
    const f = FOX, s = size / f.box[2];
    const poly = function (list, fill) {
      ctx.beginPath();
      list.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    ctx.save();
    ctx.translate(0, (size - f.box[3] * s) / 2);
    ctx.scale(s, s);
    ctx.translate(-f.box[0], -f.box[1]);
    poly(f.head, col.fur);
    f.ears.forEach(function (e) { poly(e, col.ear); });
    f.cheeks.forEach(function (c) { poly(c, col.cheek); });
    ctx.fillStyle = col.dark;
    ctx.beginPath(); ctx.arc(f.nose[0], f.nose[1], f.nose[2], 0, 7); ctx.fill();
    ctx.strokeStyle = col.dark; ctx.lineWidth = 1.9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    f.lids.forEach(function (l) {
      ctx.beginPath(); ctx.moveTo(l[0][0], l[0][1]); ctx.quadraticCurveTo(l[1][0], l[1][1], l[2][0], l[2][1]); ctx.stroke();
    });
    ctx.strokeStyle = col.cheek; ctx.lineWidth = 1.5;
    f.zs.forEach(function (z) {
      ctx.beginPath();
      z.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.stroke();
    });
    ctx.restore();
  }

  g.ShutEye = {
    api, THEMES, ANIMATIONS, LIMITS, DEFAULTS, REVERSE, FOX,
    normalize, themeById, cleanHost, sectionOf, siteRule, setSiteRule, scheduleOn,
    palette, tone, matrix, mapColor, preimage,
    hex, toHex, css, mix, lum, parseColor, classifyPixels, clamp, foxSvg, drawFox
  };
})(globalThis);
