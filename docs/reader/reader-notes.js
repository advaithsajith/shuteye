/*
 * ShutEye — reader-notes.js
 * Annotation tools for the PDF reader: highlight, underline and strike through
 * text, draw with a pen, pin notes, type text on the page, search the
 * document, browse its outline, and save a copy of the PDF with everything
 * drawn into it.
 *
 * Annotations are stored in page units (the PDF's own points, measured from the
 * top-left of the page), so they stay in place at any zoom. They are saved on
 * this device, per document.
 */
(function () {
  'use strict';

  const R = globalThis.ShutEyeReader;
  if (!R) return;
  const U = R.U, api = R.api;
  const $ = function (id) { return document.getElementById(id); };
  const SVG = 'http://www.w3.org/2000/svg';
  const COLOURS = ['#ffd84d', '#7ee081', '#ff7eb6', '#6fb7ff', '#ffa24d'];
  const MARKS = { highlight: 1, underline: 1, strike: 1 };
  const NAMES = { highlight: 'Highlight', underline: 'Underline', strike: 'Strike-through', ink: 'Drawing', note: 'Note', text: 'Text' };

  let pdf = null, key = '', docName = '';
  let anns = [];              // this document's annotations
  let store = {};             // every document's annotations, as saved
  let tool = 'select', colour = COLOURS[0];
  let undoStack = [];
  let editing = null;         // the note or text being typed

  /* ---------- Saving ---------- */

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!key) return;
      if (anns.length) store[key] = { name: docName, at: Date.now(), list: anns }; else delete store[key];
      const keys = Object.keys(store);
      if (keys.length > 80) {                       // keep the 80 most recently annotated documents
        keys.sort(function (a, b) { return store[a].at - store[b].at; });
        for (let i = 0; i < keys.length - 80; i++) delete store[keys[i]];
      }
      api.storage.local.set({ annotations: store }).catch(function () { /* storage full or unavailable */ });
    }, 400);
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function add(ann, quiet) {
    anns.push(ann);
    if (!quiet) undoStack.push({ op: 'add', ann: ann });
    drawPage(ann.page); list(); save();
  }
  function remove(id, quiet) {
    const i = anns.findIndex(function (a) { return a.id === id; });
    if (i < 0) return;
    const ann = anns.splice(i, 1)[0];
    if (!quiet) undoStack.push({ op: 'del', ann: ann });
    drawPage(ann.page); list(); save();
  }
  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    if (last.op === 'add') remove(last.ann.id, true); else add(last.ann, true);
  }

  /* ---------- Drawing annotations on a page ---------- */

  function pageOf(n) { return R.pages()[n - 1]; }

  function layerFor(p) {
    let svg = p.el.querySelector('svg.notes');
    if (!svg) {
      svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'notes');
      svg.setAttribute('data-page', p.num);
      p.el.appendChild(svg);
      svg.addEventListener('pointerdown', onPointerDown);
    }
    svg.setAttribute('viewBox', '0 0 ' + p.w + ' ' + p.h);
    return svg;
  }

  function el(name, attrs) {
    const node = document.createElementNS(SVG, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function pathOf(points) {
    return points.map(function (pt, i) { return (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join(' ');
  }

  function drawPage(n) {
    const p = pageOf(n);
    if (!p || p.drawn < 0) return;
    const svg = layerFor(p);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    anns.forEach(function (a) {
      if (a.page !== n) return;
      const g = el('g', { 'data-id': a.id, 'class': 'ann ann-' + a.type });
      if (MARKS[a.type]) {
        a.rects.forEach(function (r) {
          if (a.type === 'highlight') g.appendChild(el('rect', { x: r[0], y: r[1], width: r[2], height: r[3], fill: a.color, 'fill-opacity': 0.38, rx: 1.5 }));
          else {
            const y = a.type === 'underline' ? r[1] + r[3] - 0.5 : r[1] + r[3] * 0.55;
            g.appendChild(el('line', { x1: r[0], y1: y, x2: r[0] + r[2], y2: y, stroke: a.color, 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
            g.appendChild(el('rect', { x: r[0], y: r[1], width: r[2], height: r[3], fill: 'transparent' }));   // easier to tap
          }
        });
      } else if (a.type === 'ink') {
        g.appendChild(el('path', { d: pathOf(a.path), fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        g.appendChild(el('path', { d: pathOf(a.path), fill: 'none', stroke: 'transparent', 'stroke-width': 22 }));
      } else if (a.type === 'note') {
        g.appendChild(el('path', { d: 'M' + a.x + ' ' + a.y + ' h16 a3 3 0 0 1 3 3 v10 a3 3 0 0 1 -3 3 h-9 l-5 5 v-5 h-2 a3 3 0 0 1 -3 -3 v-10 a3 3 0 0 1 3 -3 z', transform: 'translate(-3 0)', fill: a.color, stroke: '#141a4a', 'stroke-width': 1.2 }));
        g.appendChild(el('path', { d: 'M' + (a.x + 1) + ' ' + (a.y + 6) + ' h11 M' + (a.x + 1) + ' ' + (a.y + 10.5) + ' h8', stroke: '#141a4a', 'stroke-width': 1.3, 'stroke-linecap': 'round', fill: 'none' }));
        g.setAttribute('class', g.getAttribute('class') + ' tappable');
      } else if (a.type === 'text') {
        const t = el('text', { x: a.x, y: a.y, fill: a.color, 'font-size': a.size || 12, 'font-family': 'Helvetica, Arial, sans-serif' });
        String(a.text).split('\n').forEach(function (line, i) {
          const span = el('tspan', { x: a.x, dy: i ? (a.size || 12) * 1.25 : 0 });
          span.textContent = line || ' ';
          t.appendChild(span);
        });
        g.appendChild(t);
        g.setAttribute('class', g.getAttribute('class') + ' tappable');
      }
      svg.appendChild(g);
    });
  }

  function drawAll() { R.pages().forEach(function (p) { if (p.drawn >= 0) drawPage(p.num); }); }

  /* ---------- Pointer work: pen, notes, text, eraser ---------- */

  function toPage(svg, e) {
    const p = pageOf(Number(svg.getAttribute('data-page')));
    const box = svg.getBoundingClientRect();
    return { p: p, x: (e.clientX - box.left) / box.width * p.w, y: (e.clientY - box.top) / box.height * p.h };
  }

  function onPointerDown(e) {
    const svg = e.currentTarget;
    const hit = e.target.closest ? e.target.closest('g.ann') : null;
    const id = hit && hit.getAttribute('data-id');

    if (tool === 'eraser') { if (id) { e.preventDefault(); remove(id); } return; }
    if (id && (tool === 'select' || tool === 'note' || tool === 'text')) {
      const ann = anns.find(function (a) { return a.id === id; });
      if (ann && (ann.type === 'note' || ann.type === 'text')) { e.preventDefault(); edit(ann, false); return; }
    }
    if (tool === 'pen') { e.preventDefault(); startInk(svg, e); return; }
    if (tool === 'note' || tool === 'text') {
      e.preventDefault();
      const at = toPage(svg, e);
      edit({ id: uid(), page: at.p.num, type: tool, color: tool === 'text' ? textColour() : colour, x: Math.round(at.x), y: Math.round(at.y), text: '', size: 12 }, true);
    }
  }

  // Typed text must stay readable on the page, whatever highlighter colour is picked.
  function textColour() { return R.cfg().reader.dark ? '#c0392b' : '#c0392b'; }

  function startInk(svg, e) {
    const first = toPage(svg, e), p = first.p;
    const points = [[first.x, first.y]];
    const width = Math.max(1.2, p.w / 380);
    const live = el('path', { fill: 'none', stroke: colour, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    svg.appendChild(live);
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    const move = function (ev) {
      const at = toPage(svg, ev), last = points[points.length - 1];
      if (Math.hypot(at.x - last[0], at.y - last[1]) < 0.7) return;
      points.push([at.x, at.y]);
      live.setAttribute('d', pathOf(points));
    };
    const end = function () {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', end);
      svg.removeEventListener('pointercancel', end);
      live.remove();
      if (points.length > 1) add({ id: uid(), page: p.num, type: 'ink', color: colour, width: width, path: points.map(function (pt) { return [Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10]; }) });
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  /* ---------- Marking selected text ---------- */

  function markSelection() {
    if (!MARKS[tool]) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const rects = Array.prototype.slice.call(sel.getRangeAt(0).getClientRects()).filter(function (r) { return r.width > 1.5 && r.height > 3; });
    if (!rects.length) return;
    const byPage = {};
    R.pages().forEach(function (p) {
      if (p.drawn < 0) return;
      const box = p.el.getBoundingClientRect();
      rects.forEach(function (r) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom) return;
        (byPage[p.num] = byPage[p.num] || []).push([
          (r.left - box.left) / box.width * p.w, (r.top - box.top) / box.height * p.h,
          r.width / box.width * p.w, r.height / box.height * p.h
        ]);
      });
    });
    Object.keys(byPage).forEach(function (n) {
      add({ id: uid(), page: Number(n), type: tool, color: colour, rects: mergeLines(byPage[n]), text: String(sel).slice(0, 200) });
    });
    sel.removeAllRanges();
  }

  // The browser reports one box per word or run. Join the ones on the same line.
  function mergeLines(rects) {
    rects.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
    const out = [];
    rects.forEach(function (r) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - r[1]) < r[3] * 0.5 && r[0] <= last[0] + last[2] + r[3]) {
        const right = Math.max(last[0] + last[2], r[0] + r[2]);
        last[0] = Math.min(last[0], r[0]);
        last[2] = right - last[0];
        last[3] = Math.max(last[3], r[3]);
      } else out.push(r.map(function (v) { return Math.round(v * 10) / 10; }));
    });
    return out;
  }

  let markTimer = 0;
  document.addEventListener('selectionchange', function () {
    if (!MARKS[tool]) return;
    clearTimeout(markTimer);
    markTimer = setTimeout(markSelection, 650);     // wait until the selection has settled
  });
  document.addEventListener('pointerup', function () { if (MARKS[tool]) { clearTimeout(markTimer); markTimer = setTimeout(markSelection, 120); } });

  /* ---------- Typing a note or text ---------- */

  function edit(ann, isNew) {
    editing = { ann: ann, isNew: isNew };
    $('noteTitle').textContent = (isNew ? 'New ' : 'Edit ') + (ann.type === 'note' ? 'note' : 'text') + ' · page ' + ann.page;
    $('noteText').value = ann.text || '';
    $('noteDelete').hidden = isNew;
    $('noteBox').hidden = false;
    setTimeout(function () { $('noteText').focus(); }, 30);
  }
  function closeEdit() { $('noteBox').hidden = true; editing = null; }
  $('noteSave').addEventListener('click', function () {
    if (!editing) return;
    const text = $('noteText').value.trim(), ann = editing.ann;
    if (!text) { if (!editing.isNew) remove(ann.id); closeEdit(); return; }
    ann.text = text;
    if (editing.isNew) add(ann); else { drawPage(ann.page); list(); save(); }
    closeEdit();
  });
  $('noteDelete').addEventListener('click', function () { if (editing) remove(editing.ann.id); closeEdit(); });
  $('noteCancel').addEventListener('click', closeEdit);

  /* ---------- Tool bar ---------- */

  function setTool(next) {
    tool = next;
    document.body.setAttribute('data-tool', tool);
    document.querySelectorAll('#toolbar [data-tool]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-tool') === tool ? 'true' : 'false');
    });
    $('toolHint').textContent = {
      select: 'Scroll and select text as usual. Tap a note to read it.',
      highlight: 'Select text to highlight it.', underline: 'Select text to underline it.', strike: 'Select text to strike it through.',
      pen: 'Draw on the page. Pick Read to scroll again.', note: 'Tap the page where the note should go.',
      text: 'Tap the page where the text should go.', eraser: 'Tap a highlight, drawing or note to remove it.'
    }[tool];
  }
  $('toolbar').addEventListener('click', function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-tool')) setTool(b.getAttribute('data-tool'));
    else if (b.hasAttribute('data-colour')) {
      colour = b.getAttribute('data-colour');
      document.querySelectorAll('#toolbar [data-colour]').forEach(function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
    }
  });
  const swatches = $('swatches');
  COLOURS.forEach(function (c, i) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.style.background = c;
    b.setAttribute('data-colour', c);
    b.setAttribute('aria-label', 'Colour ' + (i + 1));
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    swatches.appendChild(b);
  });
  $('undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/TEXTAREA|INPUT/.test(e.target.tagName)) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && pdf) { e.preventDefault(); openPanel('find'); $('findInput').focus(); }
    if (e.key === 'Escape') { closeEdit(); $('panel').hidden = true; }
  });

  /* ---------- Side panel: notes, outline, search ---------- */

  function openPanel(tab) {
    $('panel').hidden = false;
    document.querySelectorAll('#panelTabs button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tab') === tab ? 'true' : 'false'); });
    ['notes', 'outline', 'find'].forEach(function (t) { $('tab-' + t).hidden = t !== tab; });
  }
  $('panelBtn').addEventListener('click', function () { if ($('panel').hidden) openPanel('notes'); else $('panel').hidden = true; });
  $('panelClose').addEventListener('click', function () { $('panel').hidden = true; });
  $('panelTabs').addEventListener('click', function (e) { const b = e.target.closest('button'); if (b) openPanel(b.getAttribute('data-tab')); });

  function jump(n) {
    R.goTo(n);
    if (window.innerWidth < 760) $('panel').hidden = true;
  }

  function row(label, sub, onGo, onDelete, dot) {
    const li = document.createElement('li');
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'row-go';
    if (dot) { const d = document.createElement('i'); d.style.background = dot; go.appendChild(d); }
    const text = document.createElement('span');
    const strong = document.createElement('b'); strong.textContent = label;
    const small = document.createElement('small'); small.textContent = sub;
    text.appendChild(strong); text.appendChild(small);
    go.appendChild(text);
    go.addEventListener('click', onGo);
    li.appendChild(go);
    if (onDelete) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'row-del'; del.textContent = '×';
      del.setAttribute('aria-label', 'Delete');
      del.addEventListener('click', onDelete);
      li.appendChild(del);
    }
    return li;
  }

  function list() {
    const box = $('notesList');
    box.textContent = '';
    const sorted = anns.slice().sort(function (a, b) { return a.page - b.page || (a.y || (a.rects && a.rects[0][1]) || 0) - (b.y || (b.rects && b.rects[0][1]) || 0); });
    sorted.forEach(function (a) {
      box.appendChild(row(a.text ? a.text.slice(0, 90) : NAMES[a.type], NAMES[a.type] + ' · page ' + a.page,
        function () { jump(a.page); }, function () { remove(a.id); }, a.color));
    });
    $('notesEmpty').hidden = anns.length > 0;
    $('notesCount').textContent = anns.length ? String(anns.length) : '';
    $('saveCopy').disabled = !pdf;
    $('clearAll').hidden = anns.length === 0;
  }

  $('clearAll').addEventListener('click', function () {
    if (!anns.length || !window.confirm('Remove all ' + anns.length + ' annotations from this document? This cannot be undone.')) return;
    anns = []; undoStack = [];
    drawAll(); list(); save();
  });

  function buildOutline() {
    const box = $('outlineList');
    box.textContent = '';
    $('outlineEmpty').hidden = true;
    if (!pdf) return;
    pdf.getOutline().then(function (items) {
      if (!items || !items.length) { $('outlineEmpty').hidden = false; return; }
      const walk = function (nodes, depth) {
        nodes.slice(0, 400).forEach(function (item) {
          const li = row(item.title || 'Untitled', '', function () {
            Promise.resolve(typeof item.dest === 'string' ? pdf.getDestination(item.dest) : item.dest).then(function (dest) {
              if (!dest) return;
              return pdf.getPageIndex(dest[0]).then(function (i) { jump(i + 1); });
            }).catch(function () { /* broken link in the PDF */ });
          });
          li.style.paddingLeft = (depth * 14) + 'px';
          box.appendChild(li);
          if (item.items && item.items.length && depth < 3) walk(item.items, depth + 1);
        });
      };
      walk(items, 0);
    }).catch(function () { $('outlineEmpty').hidden = false; });
  }

  /* ---------- Search ---------- */

  const pageText = {};
  let query = '', searchRun = 0;

  function textOf(n) {
    if (pageText[n] !== undefined) return Promise.resolve(pageText[n]);
    return pdf.getPage(n).then(function (page) { return page.getTextContent(); }).then(function (c) {
      pageText[n] = c.items.map(function (i) { return i.str; }).join(' ').toLowerCase();
      return pageText[n];
    }).catch(function () { return ''; });
  }

  function search(q) {
    query = q.trim().toLowerCase();
    const run = ++searchRun, box = $('findList');
    box.textContent = '';
    markHits();
    if (!pdf || query.length < 2) { $('findStatus').textContent = query ? 'Type at least two letters.' : ''; return; }
    let total = 0, n = 1;
    const step = function () {
      if (run !== searchRun || !pdf) return;
      if (n > pdf.numPages) { $('findStatus').textContent = total ? total + (total === 1 ? ' match' : ' matches') : 'No matches.'; return; }
      const page = n++;
      textOf(page).then(function (text) {
        if (run !== searchRun) return;
        let count = 0, at = text.indexOf(query), first = at;
        while (at >= 0) { count++; at = text.indexOf(query, at + query.length); }
        if (count) {
          total += count;
          const snippet = text.slice(Math.max(0, first - 30), first + query.length + 50).trim();
          box.appendChild(row('Page ' + page + (count > 1 ? '  (' + count + ')' : ''), '…' + snippet + '…', function () { jump(page); }));
        }
        $('findStatus').textContent = 'Searching… page ' + page + ' of ' + pdf.numPages;
        step();
      });
    };
    step();
  }

  // Lights up matching words on the pages that are drawn.
  function markHits() {
    document.querySelectorAll('.textLayer span').forEach(function (s) {
      s.classList.toggle('hit', !!query && query.length > 1 && s.textContent.toLowerCase().indexOf(query) >= 0);
    });
  }

  $('findForm').addEventListener('submit', function (e) { e.preventDefault(); search($('findInput').value); });
  $('findBtn').addEventListener('click', function () { openPanel('find'); setTimeout(function () { $('findInput').focus(); }, 30); });

  /* ---------- Save a copy of the PDF with the annotations drawn in ---------- */

  function loadPdfLib() {
    if (globalThis.PDFLib) return Promise.resolve(globalThis.PDFLib);
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'vendor/pdf-lib.min.js';
      s.onload = function () { resolve(globalThis.PDFLib); };
      s.onerror = function () { reject(new Error('Could not load the PDF writer.')); };
      document.head.appendChild(s);
    });
  }

  function rgbOf(lib, hexColour) { const c = U.hex(hexColour); return lib.rgb(c[0] / 255, c[1] / 255, c[2] / 255); }
  // The built-in PDF font only has Western European letters.
  function plain(text) { return String(text).replace(/[^\x20-\x7e\xa1-\xff\n]/g, '?'); }

  function wrap(text, font, size, width) {
    const lines = [];
    plain(text).split('\n').forEach(function (para) {
      let line = '';
      para.split(' ').forEach(function (word) {
        const next = line ? line + ' ' + word : word;
        if (line && font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = word; } else line = next;
      });
      lines.push(line);
    });
    return lines;
  }

  function saveCopy() {
    if (!pdf) return;
    const btn = $('saveCopy');
    btn.disabled = true; btn.textContent = 'Preparing…';
    Promise.all([loadPdfLib(), pdf.getData()]).then(function (res) {
      const lib = res[0];
      return lib.PDFDocument.load(res[1], { ignoreEncryption: true }).then(function (doc) {
        return doc.embedFont(lib.StandardFonts.Helvetica).then(function (font) {
          const pages = doc.getPages();
          anns.forEach(function (a) {
            const page = pages[a.page - 1];
            if (!page) return;
            const H = page.getHeight(), col = rgbOf(lib, a.color);
            if (a.type === 'highlight') {
              a.rects.forEach(function (r) { page.drawRectangle({ x: r[0], y: H - r[1] - r[3], width: r[2], height: r[3], color: col, opacity: 0.38, blendMode: lib.BlendMode.Multiply }); });
            } else if (a.type === 'underline' || a.type === 'strike') {
              a.rects.forEach(function (r) {
                const y = H - (a.type === 'underline' ? r[1] + r[3] - 0.5 : r[1] + r[3] * 0.55);
                page.drawLine({ start: { x: r[0], y: y }, end: { x: r[0] + r[2], y: y }, thickness: 1.4, color: col });
              });
            } else if (a.type === 'ink') {
              page.drawSvgPath(pathOf(a.path), { x: 0, y: H, borderColor: col, borderWidth: a.width, borderLineCap: lib.LineCapStyle.Round });
            } else if (a.type === 'text') {
              const size = a.size || 12;
              plain(a.text).split('\n').forEach(function (line, i) { page.drawText(line, { x: a.x, y: H - a.y - i * size * 1.25, size: size, font: font, color: col }); });
            } else if (a.type === 'note') {
              const size = 9, pad = 5, width = Math.min(190, page.getWidth() - a.x - 8);
              const lines = wrap(a.text, font, size, Math.max(60, width - pad * 2));
              const boxH = lines.length * size * 1.3 + pad * 2;
              page.drawRectangle({ x: a.x, y: H - a.y - boxH, width: Math.max(60, width), height: boxH, color: col, borderColor: lib.rgb(0.08, 0.1, 0.29), borderWidth: 0.8, opacity: 0.95 });
              lines.forEach(function (line, i) { page.drawText(line, { x: a.x + pad, y: H - a.y - pad - size - i * size * 1.3, size: size, font: font, color: lib.rgb(0.08, 0.1, 0.29) }); });
            }
          });
          return doc.save();
        });
      });
    }).then(function (bytes) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = docName.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + ' (annotated).pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      $('saveStatus').textContent = 'Saved a copy with ' + anns.length + ' annotation' + (anns.length === 1 ? '' : 's') + '.';
    }).catch(function (err) {
      console.warn('ShutEye Reader:', err);
      $('saveStatus').textContent = 'This PDF could not be saved with annotations (it may be protected).';
    }).then(function () { btn.disabled = false; btn.textContent = 'Save a copy with annotations'; });
  }
  $('saveCopy').addEventListener('click', saveCopy);

  /* ---------- Following the reader ---------- */

  R.on('open', function (info) {
    pdf = info.pdf; key = info.key; docName = info.name;
    undoStack = []; query = '';
    Object.keys(pageText).forEach(function (k) { delete pageText[k]; });
    $('toolbar').hidden = false;
    $('findList').textContent = ''; $('findStatus').textContent = ''; $('saveStatus').textContent = '';
    api.storage.local.get('annotations').catch(function () { return {}; }).then(function (d) {
      store = (d && d.annotations) || {};
      anns = (store[key] && store[key].list) || [];
      drawAll(); list(); buildOutline();
    });
  });
  R.on('close', function () {
    pdf = null; key = ''; anns = [];
    $('toolbar').hidden = true; $('panel').hidden = true;
    closeEdit(); list();
  });
  R.on('page', function (p) { drawPage(p.num); });
  R.on('text', function () { if (query) markHits(); });

  setTool('select');
  list();
})();
