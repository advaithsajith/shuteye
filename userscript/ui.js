/*
 * ShutEye userscript — the fox button and the settings sheet.
 * A userscript has no toolbar popup, so the control panel lives on the page
 * itself, inside a shadow root (the site's own styles cannot reach it).
 *
 * Open it by tapping the fox, by holding two fingers still on the page for a
 * second, or with Alt+Shift+S on a keyboard.
 */
function startUi(SCOPE, PANEL_HTML, PANEL_CSS, UI_CSS, VERSION) {
  let top = false;
  try { top = window.top === window; } catch (e) { top = false; }
  if (!top) return;

  const U = SCOPE.ShutEye, api = U.api;
  let host = null, root = null, panel = null, sheet = null, shade = null, fab = null;
  let ui = { fab: true }, siteBase = '', isSitePage = false;

  // Some sites only accept HTML through a "trusted types" policy.
  let policy = null;
  function setHtml(el, markup) {
    try { el.innerHTML = markup; return; } catch (e) { /* try a policy */ }
    try {
      if (!policy && window.trustedTypes) policy = window.trustedTypes.createPolicy('shuteye', { createHTML: function (s) { return s; } });
      if (policy) el.innerHTML = policy.createHTML(markup);
    } catch (e) { /* this site blocks it; the panel will be unavailable here */ }
  }

  function themeOnly(cfg) {
    return { theme: cfg.theme, custom: cfg.custom, brightness: cfg.brightness, contrast: cfg.contrast, sepia: cfg.sepia, tint: cfg.tint, reader: cfg.reader };
  }

  function build() {
    if (host || !document.documentElement) return;
    host = document.createElement('shuteye-ui');
    root = host.attachShadow({ mode: 'closed' });
    const css = PANEL_CSS + '\n' + UI_CSS;
    try {
      const sheetCss = new CSSStyleSheet();
      sheetCss.replaceSync(css);
      root.adoptedStyleSheets = [sheetCss];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = css;
      root.appendChild(style);
    }
    const box = document.createElement('div');
    setHtml(box,
      '<button type="button" class="se-fab" id="seFab" aria-label="Open ShutEye settings">' + U.foxSvg() + '</button>' +
      '<div class="se-shade" id="seShade" hidden></div>' +
      '<div class="se-sheet" id="seSheet" role="dialog" aria-label="ShutEye settings" hidden>' +
        '<div class="se-top"><button type="button" class="se-close" id="seClose">Done</button></div>' +
        '<div class="se-wrap" id="seWrap">' + PANEL_HTML +
          '<div class="card"><label class="row" style="margin-top:0"><span>Show the fox button' +
          '<small>If hidden, hold two fingers still on the page for a second to open ShutEye.</small></span>' +
          '<span class="switch small"><input type="checkbox" id="seFabToggle"><span class="track"><span class="thumb"></span></span></span></label></div>' +
        '</div>' +
      '</div>');
    root.appendChild(box);
    fab = root.getElementById('seFab');
    sheet = root.getElementById('seSheet');
    shade = root.getElementById('seShade');
    if (!fab || !sheet) { host = null; return; }          // the site refused our markup
    document.documentElement.appendChild(host);

    panel = SCOPE.ShutEyeMountPanel({
      U: U, root: root, vars: host, wrap: root.getElementById('seWrap'), html: setHtml,
      getTab: function () { return Promise.resolve({ id: 0, url: location.href }); },
      getStatus: function () { return api.ask({ type: 'shuteye-status' }); },
      canRead: function () { return !!siteBase; },
      openReader: function (src, cfg) {
        const url = siteBase + 'reader/' + (src ? '?src=' + encodeURIComponent(src) : '') +
          '#' + encodeURIComponent(JSON.stringify(themeOnly(cfg)));
        if (!window.open(url, '_blank')) location.href = url;
      }
    });

    fab.addEventListener('click', open);
    shade.addEventListener('click', close);
    root.getElementById('seClose').addEventListener('click', close);
    const toggle = root.getElementById('seFabToggle');
    toggle.addEventListener('change', function () {
      ui.fab = toggle.checked;
      api.storage.local.set({ ui: ui });
      showFab();
    });
    showFab();
  }

  function showFab() {
    if (!fab) return;
    fab.hidden = !ui.fab;
    const toggle = root.getElementById('seFabToggle');
    if (toggle) toggle.checked = ui.fab;
  }

  function open() {
    build();
    if (!sheet) return;
    panel.refresh();
    sheet.hidden = false;
    shade.hidden = false;
    fab.classList.add('tucked');
  }
  function close() {
    if (!sheet) return;
    sheet.hidden = true;
    shade.hidden = true;
    fab.classList.remove('tucked');
  }

  /* ---------- Ways to open it ---------- */

  // The fox ducks out of the way while you scroll down, and comes back when you scroll up.
  let lastY = window.scrollY;
  window.addEventListener('scroll', function () {
    const y = window.scrollY;
    if (fab && sheet && sheet.hidden) {
      if (y > lastY + 12) fab.classList.add('tucked');
      else if (y < lastY - 12 || y < 40) fab.classList.remove('tucked');
    }
    if (Math.abs(y - lastY) > 12) lastY = y;
  }, { passive: true });

  // Two fingers held still for 0.7 s.
  let holdTimer = 0, holdStart = null;
  function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; holdStart = null; }
  document.addEventListener('touchstart', function (e) {
    cancelHold();
    if (e.touches.length !== 2) return;
    holdStart = [e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY];
    holdTimer = setTimeout(function () { cancelHold(); open(); }, 700);
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', function (e) {
    if (!holdStart || e.touches.length !== 2) { cancelHold(); return; }
    const now = [e.touches[0].clientX, e.touches[0].clientY, e.touches[1].clientX, e.touches[1].clientY];
    for (let i = 0; i < 4; i++) if (Math.abs(now[i] - holdStart[i]) > 14) { cancelHold(); return; }
  }, { passive: true, capture: true });
  document.addEventListener('touchend', cancelHold, { passive: true, capture: true });
  document.addEventListener('touchcancel', cancelHold, { passive: true, capture: true });

  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); if (sheet && !sheet.hidden) close(); else open(); }
    else if (e.key === 'Escape' && sheet && !sheet.hidden) close();
  }, true);

  /* ---------- ShutEye's own website ----------
   * The install page and the web PDF reader carry <meta name="shuteye-site">.
   * There we tell the page it is installed, remember where the reader lives,
   * and pass theme changes on so the reader can match.
   */
  function sitePage() {
    const meta = document.querySelector('meta[name="shuteye-site"]');
    if (!meta) return;
    isSitePage = true;
    document.documentElement.setAttribute('data-shuteye-installed', VERSION);
    let base = '';
    try { base = new URL(meta.getAttribute('content') || './', location.href).href; } catch (e) { return; }
    let sameHost = false;
    try { sameHost = !!siteBase && new URL(siteBase).host === location.host; } catch (e) { sameHost = false; }
    if (!siteBase || sameHost) {
      siteBase = base;
      api.storage.local.set({ site: base });
    }
    api.storage.local.get('cfg').then(function (d) { shareTheme(U.normalize(d.cfg)); });
  }
  function shareTheme(cfg) {
    if (isSitePage) window.postMessage({ __shuteyeTheme: themeOnly(cfg) }, location.origin);
  }
  api.storage.onChanged.addListener(function (changes) {
    if (changes.cfg) shareTheme(U.normalize(changes.cfg.newValue));
  });

  /* ---------- Start ---------- */

  function start() {
    api.storage.local.get(['ui', 'site']).then(function (d) {
      if (d.ui && typeof d.ui === 'object') ui = { fab: d.ui.fab !== false };
      if (typeof d.site === 'string') siteBase = d.site;
      sitePage();
      build();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
