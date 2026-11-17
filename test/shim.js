/* Test-only stand-in for the extension APIs, so the real extension files can run on a plain web page. */
(function () {
  if (globalThis.chrome && globalThis.chrome.storage) return;
  var KEY = 'shuteye-test-store';
  var listeners = [], msgListeners = [];
  var chan = new BroadcastChannel('shuteye-test');
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function fire(before, after) {
    var changes = {}, any = false;
    Object.keys(Object.assign({}, before, after)).forEach(function (k) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { changes[k] = { oldValue: before[k], newValue: after[k] }; any = true; }
    });
    if (any) listeners.forEach(function (l) { l(changes, 'local'); });
  }
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) fire(JSON.parse(e.oldValue || '{}'), JSON.parse(e.newValue || '{}'));
  });
  chan.addEventListener('message', function (e) {
    var m = e.data;
    if (m.kind === 'ask') msgListeners.forEach(function (l) { l(m.msg, {}, function (res) { chan.postMessage({ kind: 'answer', id: m.id, res: res }); }); });
  });
  globalThis.chrome = {
    storage: {
      local: {
        get: function (keys) {
          var all = read(), out = {};
          if (!keys) return Promise.resolve(all);
          [].concat(keys).forEach(function (k) { if (k in all) out[k] = all[k]; });
          return Promise.resolve(out);
        },
        set: function (obj) {
          var before = read(), after = Object.assign({}, before, obj);
          localStorage.setItem(KEY, JSON.stringify(after));
          fire(before, after);
          return Promise.resolve();
        }
      },
      onChanged: { addListener: function (l) { listeners.push(l); } }
    },
    runtime: {
      onMessage: { addListener: function (l) { msgListeners.push(l); } },
      getURL: function (p) { return '/test/' + p; }
    },
    tabs: {
      query: function () { return Promise.resolve([{ id: 1, url: localStorage.getItem('shuteye-test-url') || location.origin + '/test/page.html' }]); },
      sendMessage: function (id, msg) {
        return new Promise(function (res, rej) {
          var mid = String(Math.random());
          var t = setTimeout(function () { chan.removeEventListener('message', h); rej(new Error('no receiver')); }, 500);
          function h(e) { if (e.data.kind === 'answer' && e.data.id === mid) { clearTimeout(t); chan.removeEventListener('message', h); res(e.data.res); } }
          chan.addEventListener('message', h);
          chan.postMessage({ kind: 'ask', id: mid, msg: msg });
        });
      },
      create: function (o) { window.open(o.url); return Promise.resolve(); }
    }
  };
  try { if (window.top === window && /page|dark/.test(location.pathname)) localStorage.setItem('shuteye-test-url', location.href); } catch (e) {}
})();

/* Test-only: the preview pane stops painting when it is hidden, which stalls requestAnimationFrame. Fall back to a timer. */
(function () {
  var nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    var done = false;
    function run(t) { if (done) return; done = true; cb(t || performance.now()); }
    nativeRaf(run);
    setTimeout(run, 60);
    return 0;
  };
})();
