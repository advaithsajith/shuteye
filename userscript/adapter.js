/*
 * ShutEye userscript — storage adapter.
 * Gives the extension code the same storage calls it uses in Safari, backed by
 * the userscript manager's own storage (GM.getValue / GM.setValue), so settings
 * are shared by every website.
 */
function makeApi() {
  const PREFIX = 'shuteye_';
  const hasGM = typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function' && typeof GM.setValue === 'function';
  const hasLegacy = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function readRaw(key) {
    try {
      if (hasGM) return Promise.resolve(GM.getValue(PREFIX + key));
      if (hasLegacy) return Promise.resolve(GM_getValue(PREFIX + key));
      return Promise.resolve(localStorage.getItem(PREFIX + key));   // last resort: per-site only
    } catch (e) { return Promise.resolve(undefined); }
  }
  function writeRaw(key, text) {
    try {
      if (hasGM) return Promise.resolve(GM.setValue(PREFIX + key, text));
      if (hasLegacy) return Promise.resolve(GM_setValue(PREFIX + key, text));
      localStorage.setItem(PREFIX + key, text);
    } catch (e) { /* storage unavailable */ }
    return Promise.resolve();
  }
  function parse(v) {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return undefined; }
  }

  const cache = {};                      // key -> last JSON text we saw
  const changeListeners = [], messageListeners = [];

  function fire(changes) {
    changeListeners.forEach(function (l) { try { l(changes, 'local'); } catch (e) { /* keep going */ } });
  }

  function get(keys) {
    const list = [].concat(keys);
    return Promise.all(list.map(function (k) { return readRaw(k).catch(function () { return undefined; }); })).then(function (vals) {
      const out = {};
      list.forEach(function (k, i) {
        const v = parse(vals[i]);
        cache[k] = v === undefined ? undefined : JSON.stringify(v);
        if (v !== undefined) out[k] = v;
      });
      return out;
    });
  }

  function set(obj) {
    const changes = {};
    const jobs = Object.keys(obj).map(function (k) {
      const text = JSON.stringify(obj[k]);
      if (cache[k] !== text) changes[k] = { oldValue: parse(cache[k]), newValue: obj[k] };
      cache[k] = text;
      return writeRaw(k, text);
    });
    if (Object.keys(changes).length) fire(changes);
    return Promise.all(jobs).then(function () { if (changes.cfg) tellFrames(); });
  }

  // Settings may have been changed from another tab or frame: look again.
  function resync() {
    const before = cache.cfg;
    return readRaw('cfg').then(function (raw) {
      const v = parse(raw), text = v === undefined ? undefined : JSON.stringify(v);
      if (text === before) return;
      cache.cfg = text;
      fire({ cfg: { oldValue: parse(before), newValue: v } });
      tellFrames();
    }).catch(function () { /* ignore */ });
  }

  function tellFrames() {
    const frames = document.querySelectorAll('iframe, frame');
    for (let i = 0; i < frames.length; i++) {
      try { frames[i].contentWindow.postMessage({ __shuteye: 'sync' }, '*'); } catch (e) { /* frame gone */ }
    }
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.__shuteye === 'sync' && window.parent !== window && e.source === window.parent) resync();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resync(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) resync(); });

  return {
    storage: {
      local: { get: get, set: set },
      onChanged: { addListener: function (l) { changeListeners.push(l); } }
    },
    runtime: { onMessage: { addListener: function (l) { messageListeners.push(l); } } },
    // Lets the panel ask the page's own ShutEye engine what it is doing.
    ask: function (msg) {
      return new Promise(function (resolve) {
        let answered = false;
        messageListeners.forEach(function (l) { l(msg, {}, function (res) { answered = true; resolve(res); }); });
        if (!answered) resolve(null);
      });
    }
  };
}
