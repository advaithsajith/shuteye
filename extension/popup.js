/*
 * ShutEye — popup.js
 * The control panel. It only reads and writes settings; every open page listens
 * for the change and restyles itself straight away.
 */
(function (scope) {
  'use strict';

  /*
   * The panel can live in two places: the extension's popup document, or a
   * shadow root placed on the page by the userscript. "env" says where it is
   * and how to reach the current tab.
   */
  function mount(env) {
    const U = env.U, api = U.api;
    const $ = function (id) { return env.root.getElementById(id); };

    let cfg = U.normalize(null);
    let tab = null, host = '', section = '', scope = 'site', status = null;
    let saveTimer = 0, statusTimer = 0;

    /* ---------- Storage ---------- */

    function save(soon) {
      clearTimeout(saveTimer);
      const write = function () {
        api.storage.local.set({ cfg: cfg }).catch(function () { /* popup closing */ });
        clearTimeout(statusTimer);
        statusTimer = setTimeout(askStatus, 450);
      };
      if (soon) saveTimer = setTimeout(write, 70); else write();   // sliders write at most ~14x a second
    }

    function askStatus() {
      env.getStatus(tab).then(function (res) { status = res || null; }, function () { status = null; }).then(renderSite);
    }

    /* ---------- Small UI helpers ---------- */

    // Segmented control: buttons with data-v, exactly one pressed.
    function seg(el, onPick) {
      el.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-v]');
        if (b) onPick(b.getAttribute('data-v'));
      });
      return function (value) {
        el.querySelectorAll('button[data-v]').forEach(function (b) {
          b.setAttribute('aria-pressed', b.getAttribute('data-v') === value ? 'true' : 'false');
        });
      };
    }

    function slider(key, label) {
      const input = $(key), out = $(key + 'Out');
      input.addEventListener('input', function () {
        cfg[key] = Number(input.value);
        out.textContent = label(cfg[key]);
        renderSummaries();
        save(true);
      });
      return function () { input.value = cfg[key]; out.textContent = label(cfg[key]); };
    }

    function toggle(id, get, set) {
      const input = $(id);
      input.addEventListener('change', function () { set(input.checked); renderAll(); save(); });
      return function () { input.checked = get(); };
    }

    /* ---------- The popup wears the active theme ---------- */

    function paint() {
      const p = U.palette(cfg);
      const s = env.vars.style;
      s.setProperty('--bg', U.css(p.bg));
      s.setProperty('--fg', U.css(p.fg));
      s.setProperty('--accent', U.css(p.accent));
      s.setProperty('--on-accent', U.lum(p.accent) > 0.55 ? '#141414' : '#ffffff');
      s.setProperty('--card', U.css(U.mix(p.bg, p.fg, 0.07)));
      s.setProperty('--line', U.css(U.mix(p.bg, p.fg, 0.16)));
      s.setProperty('--sub', U.css(U.mix(p.fg, p.bg, 0.4)));
      env.wrap.classList.toggle('off', !cfg.enabled);
      env.wrap.classList.toggle('winding', cfg.enabled && U.windFactor(cfg, new Date()) > 0);
      if (env.winding) env.winding(cfg.enabled && U.windFactor(cfg, new Date()) > 0);
      paintToolbarIcon(p);
    }

    // Redraws the Safari toolbar icon in the theme's colours where the browser allows it.
    function paintToolbarIcon(p) {
      try {
        const action = api.action || api.browserAction;
        if (!action || !action.setIcon) return;
        const images = {};
        [32, 64].forEach(function (size) {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const x = c.getContext('2d');
          U.drawFox(x, size, { fur: U.css(p.accent), cheek: U.css(p.fg), dark: U.css(p.bg), ear: U.css(U.mix(p.accent, p.bg, 0.4)) });
          images[size] = x.getImageData(0, 0, size, size);
        });
        const r = action.setIcon({ imageData: images });
        if (r && r.catch) r.catch(function () { /* not supported here */ });
      } catch (e) { /* not supported here */ }
    }

    /* ---------- Site card ---------- */

    const STATUS_TEXT = {
      'on': 'Dark mode is on',
      'off-global': 'ShutEye is switched off',
      'off-site': 'Switched off for this site',
      'off-list': 'Not one of your picked sites',
      'off-dark': 'Already dark, left as it is',
      'off-reading': 'Reading mode is open'
    };

    // Rules are saved for the whole site, or for one section of it ("host/section").
    function ruleKey() { return scope === 'section' && section ? host + '/' + section : host; }
    const setScope = seg($('siteScope'), function (v) { scope = v; renderSite(); });

    const setSiteMode = seg($('siteMode'), function (v) {
      U.setSiteRule(cfg, ruleKey(), { mode: v === 'auto' ? null : v });
      renderAll(); save();
    });
    const setSiteImages = seg($('siteImages'), function (v) {
      U.setSiteRule(cfg, ruleKey(), { images: v === 'default' ? null : v });
      renderAll(); save();
    });

    function looksLikePdf() {
      return (status && status.isPdf) || (tab && /\.pdf([?#]|$)/i.test(tab.url || ''));
    }

    function renderSite() {
      const web = !!host;
      $('siteHost').textContent = web ? host : 'This page';
      $('siteControls').hidden = !web;
      $('pdfBtn').hidden = !(env.canRead() && tab && /^https?:/i.test(tab.url || '') && looksLikePdf());

      let text;
      if (!cfg.enabled) text = STATUS_TEXT['off-global'];
      else if (status && status.reason === 'off-schedule') {
        text = cfg.schedule === 'system' ? 'Paused while your device is in Light mode' : 'Paused until ' + cfg.timeFrom;
      } else if (status) text = STATUS_TEXT[status.reason] || '';
      else if (!$('pdfBtn').hidden) text = "Safari's PDF viewer can't be restyled. Use the reader.";
      else text = web ? 'Reload the page to start ShutEye here' : "ShutEye can't run on this page";
      $('siteStatus').textContent = text;
      $('siteDot').classList.toggle('on', !!(status && status.active));

      $('scopeField').hidden = !section;
      $('scopeSection').textContent = '/' + section;
      setScope(scope);
      const rule = cfg.sites[ruleKey()] || {};
      setSiteMode(rule.mode || 'auto');
      setSiteImages(rule.images || 'default');
      fillSiteThemes(rule.theme);
    }

    // A site can wear its own theme, whatever the theme is everywhere else.
    function fillSiteThemes(current) {
      const pick = $('siteTheme');
      pick.textContent = '';
      const option = function (value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; pick.appendChild(o); };
      option('', 'Same as everywhere');
      cfg.mine.forEach(function (t) { option(t.id, t.name + ' (mine)'); });
      U.THEMES.forEach(function (t) { option(t.id, t.name); });
      option('custom', 'Custom');
      pick.value = current || '';
    }
    $('siteTheme').addEventListener('change', function () {
      U.setSiteRule(cfg, ruleKey(), { theme: $('siteTheme').value || null });
      renderAll(); save();
    });

    $('readBtn').addEventListener('click', function () { env.read(tab); });

    /* ---------- Themes ---------- */

    let tilesFor = null;
    // The grid shows your saved themes first, then the built-in ones, then the Custom slot.
    function buildTiles() {
      const box = $('themes');
      box.textContent = '';
      const tiles = cfg.mine.map(function (m) { return { id: m.id, name: m.name, mine: true }; })
        .concat(U.THEMES, [{ id: 'custom', name: 'Custom' }]);
      tiles.forEach(function (t) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme';
        b.setAttribute('data-theme', t.id);
        b.title = t.note || t.name;
        env.html(b, '<span class="aa">Aa</span><span class="bar"></span>' + (t.mine ? '<span class="mine">mine</span>' : '') + '<span class="name"></span>');
        b.querySelector('.name').textContent = t.name;
        box.appendChild(b);
      });
      tilesFor = JSON.stringify(cfg.mine);
    }

    function buildThemes() {
      buildTiles();
      $('themes').addEventListener('click', function (e) {
        const b = e.target.closest('.theme');
        if (!b) return;
        const id = b.getAttribute('data-theme');
        const before = U.themeById(cfg.theme), picked = U.themeById(id);
        // A theme may bring its own warmth. Keep the user's setting if they changed it.
        if (cfg.sepia === ((before && before.warm) || 0)) cfg.sepia = (picked && picked.warm) || 0;
        cfg.theme = id;
        renderAll(); save();
      });
    }

    function renderThemes() {
      if (tilesFor !== JSON.stringify(cfg.mine)) buildTiles();
      env.root.querySelectorAll('.theme').forEach(function (b) {
        const id = b.getAttribute('data-theme');
        const t = U.findTheme(cfg, id);
        if (!t) return;
        b.style.background = t.bg;
        b.style.color = t.fg;
        b.querySelector('.bar').style.background = t.accent;
        b.setAttribute('aria-pressed', cfg.theme === id ? 'true' : 'false');
      });
      const p = U.palette(cfg), t = U.themeById(cfg.theme);
      const saved = cfg.mine.some(function (m) { return m.id === cfg.theme; });
      $('themeName').textContent = t && t.note ? t.note : (saved ? 'One of yours' : p.name);
      $('customBox').hidden = cfg.theme !== 'custom';
      $('mineForm').hidden = cfg.theme !== 'custom';
      $('mineDelete').hidden = !saved;
      $('cBg').value = cfg.custom.bg;
      $('cFg').value = cfg.custom.fg;
      $('cAccent').value = cfg.custom.accent;
    }

    // My themes: keep a custom look under a name, as many as you like.
    $('mineForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const name = $('mineName').value.trim() || 'My theme ' + (cfg.mine.length + 1);
      cfg.theme = U.addMine(cfg, { name: name, bg: cfg.custom.bg, fg: cfg.custom.fg, accent: cfg.custom.accent });
      $('mineName').value = '';
      renderAll(); save();
    });
    $('mineDelete').addEventListener('click', function () {
      U.removeMine(cfg, cfg.theme);
      renderAll(); save();
    });

    // Add a theme someone shared, from its link or just the code at the end of it.
    $('importForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const raw = $('importCode').value.trim(), status = $('importStatus');
      const m = /theme=([A-Za-z0-9_-]+)/.exec(raw);
      const theme = U.readThemeCode(m ? m[1] : raw);
      status.hidden = false;
      if (!theme) { status.textContent = "That doesn't look like a ShutEye theme link."; return; }
      cfg.theme = U.addMine(cfg, { name: theme.name, bg: theme.custom.bg, fg: theme.custom.fg, accent: theme.custom.accent });
      cfg.brightness = theme.brightness; cfg.contrast = theme.contrast; cfg.sepia = theme.sepia; cfg.gray = theme.gray;
      $('importCode').value = '';
      status.textContent = 'Added "' + theme.name + '" to your themes.';
      renderAll(); save();
    });

    [['cBg', 'bg'], ['cFg', 'fg'], ['cAccent', 'accent']].forEach(function (pair) {
      $(pair[0]).addEventListener('input', function (e) {
        cfg.custom[pair[1]] = e.target.value;
        cfg.theme = 'custom';
        paint(); renderThemes(); save(true);
      });
    });

    // Share the current look as a link. Opening it on another device offers to apply it.
    $('shareBtn').addEventListener('click', function () {
      const link = U.themeLink(cfg), box = $('shareLink'), status = $('shareStatus');
      box.value = link; box.hidden = false; status.hidden = false;
      const copied = function () { status.textContent = 'Link copied. Anyone with ShutEye can open it to get this theme.'; };
      const manual = function () { status.textContent = 'Copy this link and send it:'; box.focus(); box.select(); };
      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        navigator.share({ title: 'A ShutEye theme', url: link }).then(function () { status.textContent = 'Shared.'; }, manual);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(copied, manual);
      } else manual();
    });

    /* ---------- Fine-tune ---------- */

    const pctLabel = function (v) { return v + '%'; };
    const setBrightness = slider('brightness', pctLabel);
    const setContrast = slider('contrast', pctLabel);
    const setSepia = slider('sepia', function (v) { return v === 0 ? 'Off' : v + '%'; });
      const setImageDim = slider('imageDim', pctLabel);
    const setGray = slider('gray', function (v) { return v === 0 ? 'Off' : v + '%'; });
    const setTint = toggle('tint', function () { return cfg.tint; }, function (v) { cfg.tint = v; });
    const setAccentLinks = toggle('accentLinks', function () { return cfg.accentLinks; }, function (v) { cfg.accentLinks = v; });
    const setImages = seg($('images'), function (v) { cfg.images = v; renderAll(); save(); });

    $('resetTune').addEventListener('click', function () {
      const t = U.themeById(cfg.theme);
      cfg.brightness = 100; cfg.contrast = 100; cfg.sepia = t && t.warm ? t.warm : 0; cfg.imageDim = 100; cfg.gray = 0;
      cfg.tint = true; cfg.accentLinks = false; cfg.images = 'smart';
      renderAll(); save();
    });

    /* ---------- Motion ---------- */

    const animBox = $('anim');
    U.ANIMATIONS.forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-v', a.id);
      b.textContent = a.name;
      animBox.appendChild(b);
    });
    const setAnim = seg(animBox, function (v) { cfg.anim = v; renderAll(); save(); playDemo(); });
    const setAnimMs = slider('animMs', function (v) { return (v / 1000).toFixed(2).replace(/0$/, '') + ' s'; });
    $('animMs').addEventListener('change', playDemo);
    $('demo').addEventListener('click', playDemo);

    // A miniature of what a page does when ShutEye switches on.
    function playDemo() {
      const dark = $('demoDark'), light = $('demoLight');
      if (!dark.animate) return;
      [dark, light].forEach(function (el) { el.getAnimations().forEach(function (a) { a.cancel(); }); });
      // Each animation moves one layer: either the dark page arrives, or the light page leaves.
      const moves = {
        blink: ['light', [{ clipPath: 'ellipse(160% 110% at 50% 50%)' }, { clipPath: 'ellipse(160% 0% at 50% 50%)' }]],
        ripple: ['dark', [{ clipPath: 'circle(0% at 100% 0%)' }, { clipPath: 'circle(150% at 100% 0%)' }]],
        curtain: ['dark', [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }]],
        mist: ['dark', [{ opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0)' }]],
        fade: ['dark', [{ opacity: 0 }, { opacity: 1 }]],
        none: ['dark', [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1, offset: 1 }]]
      }[cfg.anim];
      const lightOnTop = moves[0] === 'light';
      light.style.zIndex = lightOnTop ? 2 : 1;
      dark.style.zIndex = lightOnTop ? 1 : 2;
      (lightOnTop ? light : dark).animate(moves[1], {
        duration: cfg.anim === 'none' ? 500 : cfg.animMs, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', delay: 250, fill: 'both'
      });
    }

    /* ---------- Schedule ---------- */

    const setSchedule = seg($('schedule'), function (v) { cfg.schedule = v; renderAll(); save(); });
    ['timeFrom', 'timeTo'].forEach(function (id) {
      $(id).addEventListener('change', function (e) {
        if (/^\d\d:\d\d$/.test(e.target.value)) { cfg[id] = e.target.value; renderAll(); save(); }
      });
    });

    const setWind = toggle('windOn', function () { return cfg.wind.on; }, function (v) { cfg.wind.on = v; });
    $('windAt').addEventListener('change', function (e) {
      if (/^\d\d:\d\d$/.test(e.target.value)) { cfg.wind.at = e.target.value; renderAll(); save(); }
    });

    /* ---------- Sites ---------- */

    const setAutoDetect = toggle('autoDetect', function () { return cfg.autoDetect; }, function (v) { cfg.autoDetect = v; });
    const setListedOnly = toggle('listedOnly', function () { return cfg.defaultMode === 'listed'; },
      function (v) { cfg.defaultMode = v ? 'listed' : 'all'; });

    function renderRules() {
      const list = $('rules');
      list.textContent = '';
      const hosts = Object.keys(cfg.sites).sort();
      hosts.forEach(function (h) {
        const r = cfg.sites[h], bits = [];
        if (r.mode) bits.push(r.mode === 'on' ? 'Always' : 'Never');
        if (r.images) bits.push(r.images === 'natural' ? 'Natural images' : 'Dark images');
        if (r.theme) bits.push((U.findTheme(cfg, r.theme) || { name: 'Theme' }).name);
        const li = document.createElement('li');
        const name = document.createElement('span'); name.className = 'host'; name.textContent = h;
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = bits.join(' · ');
        const del = document.createElement('button'); del.type = 'button'; del.textContent = '×';
        del.setAttribute('aria-label', 'Remove the rule for ' + h);
        del.addEventListener('click', function () { delete cfg.sites[h]; renderAll(); save(); });
        li.appendChild(name); li.appendChild(tag); li.appendChild(del);
        list.appendChild(li);
      });
      $('rulesEmpty').hidden = hosts.length > 0;
    }

    /* ---------- PDF reader ---------- */

    $('pdfBtn').addEventListener('click', function () { env.openReader(tab && tab.url, cfg); });
    $('readerBtn').addEventListener('click', function () { env.openReader('', cfg); });

    /* ---------- Backup ---------- */

    function backupNote(text) { const s = $('backupStatus'); s.hidden = false; s.textContent = text; }

    $('backupSave').addEventListener('click', function () {
      const text = JSON.stringify({ app: 'ShutEye', saved: new Date().toISOString().slice(0, 10), cfg: cfg }, null, 1);
      $('backupText').value = text;
      try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'shuteye-backup.json';
        (env.root.body || env.wrap).appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        backupNote('Backup saved as shuteye-backup.json. The same text is in the box above if you would rather copy it.');
      } catch (e) {
        backupNote('Copy the text in the box above and keep it somewhere safe.');
      }
    });

    function restore(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { backupNote("That isn't a ShutEye backup."); return; }
      const incoming = data && typeof data === 'object' ? (data.cfg || data) : null;
      if (!incoming || typeof incoming !== 'object' || (!('theme' in incoming) && !('sites' in incoming))) { backupNote("That isn't a ShutEye backup."); return; }
      cfg = U.normalize(incoming);
      renderAll(); save();
      backupNote('Restored: ' + cfg.mine.length + ' saved theme' + (cfg.mine.length === 1 ? '' : 's') + ' and ' + Object.keys(cfg.sites).length + ' site rule' + (Object.keys(cfg.sites).length === 1 ? '' : 's') + '.');
    }
    $('backupLoad').addEventListener('click', function () { $('backupFile').click(); });
    $('backupFile').addEventListener('change', function (e) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { restore(String(reader.result)); };
      reader.readAsText(file);
    });
    $('backupPaste').addEventListener('click', function () { restore($('backupText').value); });

    /* ---------- Render ---------- */

    const setEnabled = toggle('enabled', function () { return cfg.enabled; }, function (v) { cfg.enabled = v; });

    function renderSummaries() {
      const tuned = [];
      if (cfg.brightness !== 100) tuned.push('Brightness ' + cfg.brightness + '%');
      if (cfg.contrast !== 100) tuned.push('Contrast ' + cfg.contrast + '%');
      if (cfg.sepia > 0) tuned.push('Warmth ' + cfg.sepia + '%');
      if (cfg.gray > 0) tuned.push('Black and white ' + cfg.gray + '%');
      $('tuneSummary').textContent = tuned.length ? tuned[0] + (tuned.length > 1 ? ' +' + (tuned.length - 1) : '') : 'Theme defaults';

      const a = U.ANIMATIONS.filter(function (x) { return x.id === cfg.anim; })[0];
      $('motionSummary').textContent = a.name;

      $('scheduleSummary').textContent = cfg.schedule === 'always' ? 'Always on'
        : cfg.schedule === 'system' ? 'Follows system' : cfg.timeFrom + ' – ' + cfg.timeTo;
      $('scheduleHint').textContent = cfg.schedule === 'always' ? 'ShutEye darkens pages day and night.'
        : cfg.schedule === 'system' ? 'ShutEye runs while your device is in Dark mode, so it follows sunset if Appearance is set to Automatic.'
        : 'ShutEye runs between these hours every day.';
      $('times').hidden = cfg.schedule !== 'time';
      $('windTimes').hidden = !cfg.wind.on;

      const n = Object.keys(cfg.sites).length;
      $('sitesSummary').textContent = n === 0 ? 'No rules' : n + (n === 1 ? ' rule' : ' rules');
      const wound = U.windFactor(cfg, new Date());
      $('tagline').textContent = !cfg.enabled ? 'Wide awake (switched off)'
        : wound >= 1 ? 'Wound down for the night' : wound > 0 ? 'Winding down\u2026 ' + Math.round(wound * 100) + '%' : 'Lights out for every website';
    }

    function renderAll() {
      paint();
      $('readerBtn').hidden = !env.canRead();
      setEnabled();
      renderSite();
      renderThemes();
      setBrightness(); setContrast(); setSepia(); setImageDim(); setGray(); setTint(); setAccentLinks(); setImages(cfg.images);
      setAnim(cfg.anim); setAnimMs();
      setSchedule(cfg.schedule);
      $('timeFrom').value = cfg.timeFrom;
      $('timeTo').value = cfg.timeTo;
      setWind();
      $('windAt').value = cfg.wind.at;
      setAutoDetect(); setListedOnly();
      renderRules();
      renderSummaries();
    }

    env.html($('mascot'), U.foxSvg());
    buildThemes();
    renderAll();

    // Loads the saved settings and the current page, then redraws everything.
    function refresh() {
      return Promise.all([
        api.storage.local.get('cfg').catch(function () { return {}; }),
        env.getTab()
      ]).then(function (res) {
        cfg = U.normalize(res[0] && res[0].cfg);
        tab = res[1];
        try {
          const u = new URL((tab && tab.url) || '');
          host = /^https?:$/.test(u.protocol) ? U.cleanHost(u.hostname) : '';
        } catch (e) { host = ''; }
        try { section = host ? U.sectionOf(new URL(tab.url).pathname) : ''; } catch (e) { section = ''; }
        scope = section && cfg.sites[host + '/' + section] ? 'section' : 'site';
        renderAll();
        askStatus();
      });
    }
    refresh();

    $('motionCard').addEventListener('toggle', function (e) { if (e.target.open) playDemo(); });

    return { refresh: refresh };
  }

  scope.ShutEyeMountPanel = mount;

  // In the extension, the panel is the popup document itself.
  if (scope.document && !scope.__shuteyeEmbed) {
    const api = scope.ShutEye.api;
    mount({
      U: scope.ShutEye,
      root: document,
      vars: document.documentElement,
      wrap: document.body,
      html: function (el, markup) { el.innerHTML = markup; },
      getTab: function () {
        if (!api.tabs || !api.tabs.query) return Promise.resolve(null);
        return api.tabs.query({ active: true, currentWindow: true }).then(function (tabs) { return tabs && tabs[0]; })
          .catch(function () { return null; });
      },
      getStatus: function (tab) {
        if (!tab || tab.id === undefined || !api.tabs.sendMessage) return Promise.resolve(null);
        return api.tabs.sendMessage(tab.id, { type: 'shuteye-status' }, { frameId: 0 });
      },
      read: function (tab) {
        if (!tab || tab.id === undefined) return;
        api.tabs.sendMessage(tab.id, { type: 'shuteye-read' }, { frameId: 0 }).then(function () { window.close(); }, function () { /* page not ready */ });
      },
      canRead: function () { return true; },
      openReader: function (src) {
        const url = api.runtime.getURL('reader.html') + (src ? '?src=' + encodeURIComponent(src) : '');
        const p = api.tabs.create({ url: url });
        if (p && p.then) p.then(function () { window.close(); }, function () { /* stay open */ });
      }
    });
  }
})(globalThis);
