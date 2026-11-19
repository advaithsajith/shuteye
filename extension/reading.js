/*
 * ShutEye — reading.js
 * Reading mode: finds the article on a page and shows just that, in the
 * active theme, with a typeface, text size and column width you choose.
 *
 * Nothing is fetched and nothing leaves the page: the article is copied out of
 * the page that is already loaded, with scripts, forms, menus and ads left behind.
 */
(function () {
  'use strict';

  const NR = globalThis.ShutEye;
  if (!NR || globalThis.ShutEyeReading) return;

  const DROP = 'script,style,link,meta,noscript,iframe,form,input,button,select,textarea,nav,aside,footer,dialog,template,object,embed,canvas,video,audio';
  // Class and id names that mark page furniture rather than the article.
  const FURNITURE = /(^|[\s_-])(comments?|share|sharing|social|promo|related|sidebar|advert|ads?|sponsor(ed)?|newsletter|subscribe|cookie|consent|banner|breadcrumbs?|toolbar|menu|popup|modal|navbox|editsection|noprint|toc|skip|hidden)([\s_-]|$)/i;
  const KEEP_ATTR = { href: 1, src: 1, srcset: 1, alt: 1, title: 1, colspan: 1, rowspan: 1, start: 1, lang: 1, dir: 1 };
  const FONTS = {
    serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  };
  const WIDTHS = { narrow: 560, normal: 700, wide: 900 };

  let host = null, root = null, wrap = null, opts = null, prevOverflow = '', stopVoice = null;

  function textLen(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim().length; }

  /* ---------- Finding the article ----------
   * Every decent paragraph votes for its parent (and half a vote for its
   * grandparent). The element with the most votes holds the article.
   */
  function find() {
    const votes = new Map();
    const vote = function (el, n) { if (el && el !== document.documentElement) votes.set(el, (votes.get(el) || 0) + n); };
    const blocks = document.querySelectorAll('p, pre, blockquote, li');
    for (let i = 0; i < blocks.length && i < 6000; i++) {
      const b = blocks[i];
      const len = textLen(b);
      if (len < 60 || b.closest('nav, aside, footer, form, [role="navigation"], shuteye-ui')) continue;
      const weight = b.tagName === 'LI' ? len * 0.4 : len;
      vote(b.parentElement, weight);
      if (b.parentElement) vote(b.parentElement.parentElement, weight / 2);
    }
    let best = null, bestScore = 0;
    votes.forEach(function (score, el) { if (score > bestScore) { best = el; bestScore = score; } });
    if (!best || bestScore < 500) return null;
    // A surrounding <article> usually adds the headline and lead picture.
    const article = best.closest('article, [itemprop="articleBody"]');
    if (article && textLen(article) < textLen(best) * 2.5) best = article;
    return best;
  }

  function title() {
    const h1 = document.querySelector('article h1, main h1, h1');
    const t = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
    if (t.length > 3 && t.length < 220) return t;
    return (document.title || '').split(/\s+[|–—-]\s+/)[0].trim();
  }

  // A cleaned copy of the article: no scripts, no furniture, no styling hooks.
  function clean(source, heading) {
    const copy = source.cloneNode(true);
    copy.querySelectorAll(DROP).forEach(function (n) { n.remove(); });

    const all = Array.prototype.slice.call(copy.querySelectorAll('*'));
    all.forEach(function (el) {
      if (!el.parentNode) return;
      if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') { el.remove(); return; }
      const name = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      const len = textLen(el);
      if (FURNITURE.test(name) && len < 700) { el.remove(); return; }
      // Blocks that are mostly links are menus and "more stories" lists.
      const tag = el.tagName;
      if ((tag === 'DIV' || tag === 'UL' || tag === 'OL' || tag === 'SECTION' || tag === 'TABLE') && len > 0 && len < 1500) {
        let linked = 0;
        el.querySelectorAll('a').forEach(function (a) { linked += textLen(a); });
        if (linked / len > 0.65) { el.remove(); return; }
      }
    });

    copy.querySelectorAll('img').forEach(function (img) {
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (lazy && (!img.getAttribute('src') || /^data:/.test(img.getAttribute('src')))) img.setAttribute('src', lazy);
      const w = Number(img.getAttribute('width')) || 0;
      if (!img.getAttribute('src') || (w && w < 48)) { img.remove(); return; }
      try { img.setAttribute('src', new URL(img.getAttribute('src'), location.href).href); } catch (e) { img.remove(); }
    });
    copy.querySelectorAll('a[href]').forEach(function (a) {
      try { a.setAttribute('href', new URL(a.getAttribute('href'), location.href).href); } catch (e) { a.removeAttribute('href'); }
    });

    // Strip every attribute that could carry the site's styling or behaviour.
    const strip = function (el) {
      for (let i = el.attributes.length - 1; i >= 0; i--) {
        const n = el.attributes[i].name;
        if (!KEEP_ATTR[n] || (n === 'href' && /^\s*javascript:/i.test(el.attributes[i].value))) el.removeAttribute(n);
      }
    };
    strip(copy);
    copy.querySelectorAll('*').forEach(strip);

    // The page's own headline would repeat ours.
    const first = copy.querySelector('h1');
    if (first && heading && first.textContent.replace(/\s+/g, ' ').trim() === heading) first.remove();

    // Empty shells left behind by the clean-up.
    Array.prototype.slice.call(copy.querySelectorAll('div, section, span, p, figure, ul, ol')).reverse().forEach(function (el) {
      if (!textLen(el) && !el.querySelector('img, svg, table, pre')) el.remove();
    });
    return copy;
  }

  /* ---------- The reading view ---------- */

  const CSS = [
    ':host { all: initial; }',
    '.wrap { position: absolute; top: 0; left: 0; right: 0; bottom: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; background: var(--bg); color: var(--fg); }',
    '.bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 10px 12px; padding-top: max(10px, env(safe-area-inset-top)); background: var(--bg); border-bottom: 1px solid var(--line); font: 500 14px ui-monospace, "SF Mono", Menlo, Consolas, monospace; }',
    '.bar span { flex: 1; }',
    '.bar button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 999px; min-height: 38px; min-width: 42px; padding: 6px 13px; cursor: pointer; }',
    '.bar button.done { background: var(--fg); color: var(--bg); border-color: var(--fg); font-style: italic; font-weight: 800; text-transform: uppercase; }',
    '.bar button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.doc { max-width: var(--width); margin: 0 auto; padding: 26px 20px 140px; font-family: var(--font); font-size: var(--size); line-height: 1.7; overflow-wrap: break-word; filter: var(--tone); }',
    'h1.title { font-size: 1.75em; line-height: 1.18; margin: 0 0 0.3em; letter-spacing: -0.01em; text-wrap: balance; }',
    '.from { color: var(--sub); font: 500 13px ui-monospace, "SF Mono", Menlo, Consolas, monospace; margin: 0 0 1.6em; }',
    'h1, h2, h3, h4 { line-height: 1.25; margin: 1.5em 0 0.5em; text-wrap: balance; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }',
    'p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1.1em; } ul, ol { padding-left: 1.4em; } li { margin-bottom: 0.35em; }',
    'a { color: var(--accent); text-underline-offset: 2px; }',
    'img { max-width: 100%; height: auto; border-radius: 6px; filter: brightness(var(--photo)); }',
    'figure { margin-left: 0; margin-right: 0; } figcaption, small, sup { color: var(--sub); font-size: 0.78em; }',
    'blockquote { border-left: 3px solid var(--accent); margin-left: 0; padding-left: 1em; color: var(--sub); }',
    'pre, code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; background: var(--card); border-radius: 6px; } code { padding: 0.1em 0.35em; } pre { padding: 12px 14px; overflow-x: auto; } pre code { padding: 0; background: none; }',
    'table { display: block; overflow-x: auto; border-collapse: collapse; font-size: 0.85em; } th, td { border: 1px solid var(--line); padding: 6px 9px; text-align: left; }',
    'hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }',
    '.none { text-align: center; padding-top: 18vh; color: var(--sub); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }',
    '::selection { background: var(--accent); color: var(--bg); }',
    '@media print { .bar { display: none; } .wrap { position: static; } }'
  ].join('\n');

  function paint(cfg) {
    if (!host) return;
    const p = NR.palette(cfg), r = cfg.reading, s = host.style;
    s.setProperty('--bg', NR.css(p.bg));
    s.setProperty('--fg', NR.css(p.fg));
    s.setProperty('--accent', NR.css(p.accent));
    s.setProperty('--sub', NR.css(NR.mix(p.fg, p.bg, 0.4)));
    s.setProperty('--line', NR.css(NR.mix(p.bg, p.fg, 0.16)));
    s.setProperty('--card', NR.css(NR.mix(p.bg, p.fg, 0.08)));
    s.setProperty('--font', FONTS[r.font]);
    s.setProperty('--size', r.size + 'px');
    s.setProperty('--width', WIDTHS[r.width] + 'px');
    s.setProperty('--photo', (cfg.imageDim / 100).toFixed(2));
    let tone = 'brightness(' + cfg.brightness + '%)';
    if (cfg.sepia > 0) tone += ' sepia(' + cfg.sepia + '%)';
    if (cfg.gray > 0) tone += ' grayscale(' + cfg.gray + '%)';
    s.setProperty('--tone', cfg.brightness === 100 && !cfg.sepia && !cfg.gray ? 'none' : tone);
  }

  function button(label, name, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', name);
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  function open(options) {
    if (host) return true;
    opts = options;
    const source = find();
    const heading = title();

    host = document.createElement('shuteye-reading');
    ['position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647', 'display:block', 'visibility:visible', 'opacity:1'].forEach(function (pair) {
      const kv = pair.split(':');
      host.style.setProperty(kv[0], kv[1], 'important');
    });
    root = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);
    }

    wrap = document.createElement('div');
    wrap.className = 'wrap';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const change = function (patch) {
      Object.assign(opts.cfg.reading, patch);
      paint(opts.cfg);
      opts.save(opts.cfg.reading);
    };
    bar.appendChild(button('Done', 'Close reading mode', close, 'done'));
    bar.appendChild(document.createElement('span'));
    bar.appendChild(button('A−', 'Smaller text', function () { change({ size: Math.max(14, opts.cfg.reading.size - 1) }); }));
    bar.appendChild(button('A+', 'Larger text', function () { change({ size: Math.min(30, opts.cfg.reading.size + 1) }); }));
    bar.appendChild(button('Font', 'Change typeface', function () {
      const order = ['serif', 'sans', 'mono'];
      change({ font: order[(order.indexOf(opts.cfg.reading.font) + 1) % 3] });
    }));
    bar.appendChild(button('Width', 'Change column width', function () {
      const order = ['narrow', 'normal', 'wide'];
      change({ width: order[(order.indexOf(opts.cfg.reading.width) + 1) % 3] });
    }));
    const article = document.createElement('div');
    article.className = 'doc';
    const voice = NR.speaker();
    if (voice.supported) {
      const listen = button('Listen', 'Read the article aloud', function () {
        if (voice.isPlaying()) { voice.stop(); listen.textContent = 'Listen'; return; }
        listen.textContent = 'Stop';
        voice.say(article.innerText || article.textContent, function () { listen.textContent = 'Listen'; });
      });
      bar.insertBefore(listen, bar.children[2]);
      stopVoice = function () { voice.stop(); };
    }
    wrap.appendChild(bar);

    if (source) {
      const h = document.createElement('h1');
      h.className = 'title';
      h.textContent = heading;
      const from = document.createElement('p');
      from.className = 'from';
      from.textContent = location.hostname.replace(/^www\./, '');
      article.appendChild(h);
      article.appendChild(from);
      article.appendChild(clean(source, heading));
    } else {
      const none = document.createElement('p');
      none.className = 'none';
      none.textContent = 'ShutEye could not find an article on this page.';
      article.appendChild(none);
    }
    wrap.appendChild(article);
    root.appendChild(wrap);

    paint(opts.cfg);
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.appendChild(host);
    document.addEventListener('keydown', onKey, true);
    return true;
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function close() {
    if (!host) return;
    if (stopVoice) { stopVoice(); stopVoice = null; }
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    host = root = wrap = null;
    document.documentElement.style.overflow = prevOverflow;
    const done = opts && opts.onClose;
    opts = null;
    if (done) done();
  }

  globalThis.ShutEyeReading = {
    open: open,
    close: close,
    isOpen: function () { return !!host; },
    update: function (cfg) { if (host && opts) { opts.cfg = cfg; paint(cfg); } }
  };
})();
