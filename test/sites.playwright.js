// Runs the built userscript on real websites and reports what ShutEye did on each.
// Used through a Playwright runner:  async (page) => { ... }
async (page) => {
  const SCRIPT = 'C:/Users/sajit/SunSmart/shuteye/docs/shuteye.user.js';
  const SHOTS = 'C:/Users/sajit/AppData/Local/Temp/claude/403957198dde0a6e/1eb76527-57af-4565-b0c6-b7e2b6504738/scratchpad/shots/';
  const SITES = globalThis.__shuteyeSites || [
    ['wikipedia', 'https://en.wikipedia.org/wiki/Solar_eclipse'],
    ['wiki-math', 'https://en.m.wikipedia.org/wiki/Fourier_transform'],
    ['hackernews', 'https://news.ycombinator.com/'],
    ['bbc', 'https://www.bbc.com/news'],
    ['mdn', 'https://developer.mozilla.org/en-US/docs/Web/CSS/filter'],
    ['stackoverflow', 'https://stackoverflow.com/questions/11227809'],
    ['github', 'https://github.com/mozilla/pdf.js'],
    ['gutenberg', 'https://www.gutenberg.org/files/1342/1342-h/1342-h.htm'],
    ['youtube', 'https://www.youtube.com/'],
    ['duckduckgo', 'https://duckduckgo.com/?q=red+fox&ia=web'],
    ['apple', 'https://www.apple.com/'],
    ['verge', 'https://www.theverge.com/'],
    ['reddit', 'https://www.reddit.com/r/foxes/'],
    ['nytimes', 'https://www.nytimes.com/']
  ];

  if (!globalThis.__shuteyeInit) {
    await page.context().addInitScript({ path: SCRIPT });
    globalThis.__shuteyeInit = true;
  }
  await page.setViewportSize({ width: 393, height: 800 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));

  const out = [];
  for (const [name, url] of SITES) {
    errors.length = 0;
    const row = { name };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 30000 }));
      await page.waitForTimeout(4500);
      Object.assign(row, await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const imgs = [...document.images].filter((i) => i.naturalWidth > 8 && i.offsetWidth > 8);
        const inv = imgs.filter((i) => i.getAttribute('data-se-i') === 'inv');
        const tone = document.querySelector('shuteye-tone-a');
        return {
          on: !!document.getElementById('shuteye-style'),
          filter: cs.filter === 'none' ? 'none' : 'flip',
          htmlBg: cs.backgroundColor,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          fox: !!document.querySelector('shuteye-ui'),
          imgs: imgs.length,
          inv: inv.length,
          invNames: inv.slice(0, 5).map((i) => (i.currentSrc || i.src).split('?')[0].split('/').pop().slice(0, 34)),
          bgPhotos: document.querySelectorAll('[data-se-i="nat"]:not(iframe):not(canvas)').length,
          frames: document.querySelectorAll('iframe').length,
          framesOwn: document.querySelectorAll('iframe[data-se-i="nat"]').length,
          scrollX: document.documentElement.scrollWidth - innerWidth
        };
      }));
      await page.screenshot({ path: SHOTS + name + '.jpg', type: 'jpeg', quality: 55 });
    } catch (e) {
      row.fail = String(e.message).split('\n')[0].slice(0, 140);
    }
    if (errors.length) row.errors = [...new Set(errors)].slice(0, 4);
    out.push(row);
  }
  return JSON.stringify(out, null, 1);
}
