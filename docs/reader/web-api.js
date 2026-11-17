/*
 * ShutEye web reader — storage for the hosted PDF reader.
 * On a website there is no extension storage, so settings live in this site's
 * localStorage. The theme arrives from the ShutEye userscript: in the link that
 * opened the reader, and live whenever you change it in the fox panel.
 */
(function () {
  var PREFIX = 'shuteye_';
  var listeners = [];

  function read(key) {
    try { var v = localStorage.getItem(PREFIX + key); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; }
  }
  function write(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function set(obj) {
    var changes = {};
    Object.keys(obj).forEach(function (k) {
      var before = read(k);
      if (JSON.stringify(before) !== JSON.stringify(obj[k])) changes[k] = { oldValue: before, newValue: obj[k] };
      write(k, obj[k]);
    });
    if (Object.keys(changes).length) listeners.forEach(function (l) { l(changes, 'local'); });
    return Promise.resolve();
  }
  function get(keys) {
    var out = {};
    [].concat(keys).forEach(function (k) { var v = read(k); if (v !== undefined) out[k] = v; });
    return Promise.resolve(out);
  }

  // Only look-and-feel settings are accepted from outside.
  var THEME_KEYS = ['theme', 'custom', 'brightness', 'contrast', 'sepia', 'tint'];
  function adopt(theme) {
    if (!theme || typeof theme !== 'object') return;
    var cfg = Object.assign({}, read('cfg'));
    THEME_KEYS.forEach(function (k) { if (theme[k] !== undefined) cfg[k] = theme[k]; });
    set({ cfg: cfg });
  }

  if (location.hash.length > 1) {
    try { adopt(JSON.parse(decodeURIComponent(location.hash.slice(1)))); } catch (e) { /* not a theme */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }
  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.__shuteyeTheme) adopt(e.data.__shuteyeTheme);
  });

  globalThis.__shuteyeApi = {
    storage: { local: { get: get, set: set }, onChanged: { addListener: function (l) { listeners.push(l); } } }
  };
})();
