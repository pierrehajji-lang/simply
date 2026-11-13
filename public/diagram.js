'use strict';
/* Zoubiders — bloc « Schéma » : formes, textes et flèches à placer librement (cartes mentales, organigrammes, parcours…). */

const SHAPES = { rect: ['▭', 'Rectangle'], round: ['▢', 'Arrondi'], ellipse: ['◯', 'Rond'], diamond: ['◇', 'Losange'], note: ['🗒', 'Note'], text: ['T', 'Texte seul'] };
function newDiagram() {
  const a = { id: uid(), x: 60, y: 60, w: 150, h: 64, shape: 'round', text: 'Idée', color: 'blue' };
  const b = { id: uid(), x: 300, y: 60, w: 150, h: 64, shape: 'round', text: 'Étape suivante', color: 'green' };
  return { h: 360, nodes: [a, b], edges: [{ id: uid(), from: a.id, to: b.id, label: '' }] };
}

function renderDiagram(p, b) {
  const d = b.diagram;
  let sel = null, mode = null, pending = null; // sel : { kind:'node'|'edge', id }
  const box = h('div', { class: 'dg', tabindex: 0 });
  const area = h('div', { class: 'dg-area', style: `height:${d.h}px` });
  const s = svg('svg', { class: 'dg-svg' });
  area.append(s);
  const node = id => d.nodes.find(n => n.id === id);
  const pt = e => { const r = s.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const inside = (n, x, y) => {
    const dx = Math.abs(x - (n.x + n.w / 2)) / (n.w / 2), dy = Math.abs(y - (n.y + n.h / 2)) / (n.h / 2);
    return n.shape === 'ellipse' ? dx * dx + dy * dy <= 1 : n.shape === 'diamond' ? dx + dy <= 1 : dx <= 1 && dy <= 1;
  };
  // Point où la ligne entre deux formes sort de la forme (recherche par dichotomie).
  const exitPoint = (n, tx, ty) => {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    let lo = 0, hi = 1;
    for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (inside(n, cx + (tx - cx) * m, cy + (ty - cy) * m)) lo = m; else hi = m; }
    return { x: cx + (tx - cx) * hi, y: cy + (ty - cy) * hi };
  };

  function draw() {
    const W = Math.max(area.clientWidth || 700, ...d.nodes.map(n => n.x + n.w + 20));
    s.setAttribute('width', W); s.setAttribute('height', d.h);
    s.replaceChildren(svg('defs', {}, svg('marker', { id: 'ar-' + b.id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'dg-arrow' }))));
    for (const e of d.edges) {
      const a = node(e.from), c = node(e.to);
      if (!a || !c) continue;
      const p1 = exitPoint(a, c.x + c.w / 2, c.y + c.h / 2), p2 = exitPoint(c, a.x + a.w / 2, a.y + a.h / 2);
      const on = sel?.kind === 'edge' && sel.id === e.id;
      const g = svg('g', { class: 'dg-edge' + (on ? ' on' : ''), 'data-edge': e.id });
      g.append(svg('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'dg-hit' }),
        svg('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'dg-line' + (e.dashed ? ' dashed' : ''), 'marker-end': `url(#ar-${b.id})` }));
      if (e.label) {
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        g.append(svg('rect', { x: mx - e.label.length * 3.6 - 6, y: my - 11, width: e.label.length * 7.2 + 12, height: 22, rx: 5, class: 'dg-lbl-bg' }), svg('text', { x: mx, y: my + 4, class: 'dg-lbl' }, e.label));
      }
      s.append(g);
    }
    for (const n of d.nodes) {
      const on = sel?.kind === 'node' && sel.id === n.id;
      const g = svg('g', { class: `dg-node dg-c-${n.color || 'gray'} dg-s-${n.shape}${on ? ' on' : ''}${pending === n.id ? ' pend' : ''}`, 'data-node': n.id });
      const { x, y, w, h: hh } = n;
      if (n.shape === 'ellipse') g.append(svg('ellipse', { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2, class: 'dg-shape' }));
      else if (n.shape === 'diamond') g.append(svg('polygon', { points: `${x + w / 2},${y} ${x + w},${y + hh / 2} ${x + w / 2},${y + hh} ${x},${y + hh / 2}`, class: 'dg-shape' }));
      else g.append(svg('rect', { x, y, width: w, height: hh, rx: n.shape === 'round' ? 14 : n.shape === 'note' ? 2 : 4, class: 'dg-shape' }));
      const fo = svg('foreignObject', { x: x + 6, y: y + 4, width: Math.max(10, w - 12), height: Math.max(10, hh - 8) });
      fo.append(h('div', { class: 'dg-txt' }, n.text));
      g.append(fo);
      if (on) {
        g.append(svg('rect', { x: x + w - 5, y: y + hh - 5, width: 10, height: 10, class: 'dg-resize', 'data-resize': n.id }));
        g.append(svg('circle', { cx: x + w + 14, cy: y + hh / 2, r: 8, class: 'dg-conn', 'data-conn': n.id }));
        g.append(svg('text', { x: x + w + 14, y: y + hh / 2 + 4, class: 'dg-conn-t' }, '→'));
      }
      s.append(g);
    }
    tools.querySelector('.dg-del').disabled = !sel;
    tools.querySelector('.dg-col').disabled = !(sel?.kind === 'node');
    tools.querySelector('.dg-link').classList.toggle('on', mode === 'link');
  }
  const changed = () => { save(); draw(); };

  const addNode = (shape, at) => {
    const n = { id: uid(), x: at ? at.x - 70 : 40 + (d.nodes.length % 6) * 30, y: at ? at.y - 30 : 40 + (d.nodes.length % 6) * 24, w: shape === 'note' ? 150 : 140, h: shape === 'note' ? 110 : shape === 'diamond' ? 90 : 60, shape, text: shape === 'text' ? 'Texte' : '', color: shape === 'note' ? 'yellow' : 'gray' };
    d.nodes.push(n); sel = { kind: 'node', id: n.id }; changed();
    editText(n);
  };
  const remove = () => {
    if (!sel) return;
    if (sel.kind === 'node') { d.nodes = d.nodes.filter(n => n.id !== sel.id); d.edges = d.edges.filter(e => e.from !== sel.id && e.to !== sel.id); }
    else d.edges = d.edges.filter(e => e.id !== sel.id);
    sel = null; changed();
  };
  // Édition du texte d'une forme, directement par-dessus le schéma.
  function editText(n) {
    const ta = h('textarea', { class: 'dg-edit', value: n.text, style: `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px` });
    const done = () => { n.text = ta.value.trim(); ta.remove(); changed(); box.focus(); };
    ta.onblur = done;
    ta.onkeydown = e => { e.stopPropagation(); if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); ta.blur(); } };
    area.append(ta); ta.focus(); ta.select();
  }

  const tools = h('div', { class: 'dg-tools' },
    Object.entries(SHAPES).map(([k, [ic, l]]) => h('button', { class: 'tool', title: 'Ajouter : ' + l, onclick: () => addNode(k) }, ic)),
    h('span', { class: 'dg-sep' }),
    h('button', { class: 'tool dg-link', title: 'Relier deux formes : cliquez sur la première puis sur la seconde', onclick: () => { mode = mode === 'link' ? null : 'link'; pending = null; draw(); } }, '⟶ Relier'),
    h('button', { class: 'tool dg-col', title: 'Couleur de la forme', onclick: e => {
      const n = sel?.kind === 'node' && node(sel.id); if (!n) return;
      popup(e.currentTarget, h('div', { class: 'swatches' }, COLORS.map(c => h('button', { class: 'sw bg-' + c, title: COLOR_FR[c], onclick: () => { closePopup(); n.color = c; changed(); } }, ' '))));
    } }, '🎨'),
    h('button', { class: 'tool dg-del', title: 'Supprimer la sélection (Suppr)', onclick: remove }, '🗑'),
    h('span', { class: 'grow' }),
    h('span', { class: 'muted small' }, 'Double-clic : écrire · glisser → : relier'),
    h('button', { class: 'tool', title: 'Agrandir la zone', onclick: () => { d.h = Math.min(2000, d.h + 120); area.style.height = d.h + 'px'; changed(); } }, '↕+'),
    h('button', { class: 'tool', title: 'Réduire la zone', onclick: () => { d.h = Math.max(200, d.h - 120); area.style.height = d.h + 'px'; changed(); } }, '↕−'));

  // Souris : sélection, déplacement, redimensionnement, liaison.
  s.addEventListener('pointerdown', e => {
    box.focus({ preventScroll: true });
    const t = e.target, P = pt(e);
    const conn = t.closest('[data-conn]'), rs = t.closest('[data-resize]'), ng = t.closest('[data-node]'), eg = t.closest('[data-edge]');
    if (conn) {
      const from = node(conn.dataset.conn);
      const line = svg('line', { class: 'dg-line temp', x1: from.x + from.w / 2, y1: from.y + from.h / 2, x2: P.x, y2: P.y });
      s.append(line);
      const move = ev => { const q = pt(ev); line.setAttribute('x2', q.x); line.setAttribute('y2', q.y); };
      const up = ev => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); line.remove();
        const q = pt(ev), target = d.nodes.slice().reverse().find(n => n.id !== from.id && inside(n, q.x, q.y));
        if (target) { d.edges.push({ id: uid(), from: from.id, to: target.id, label: '' }); changed(); }
        else { // Lâché dans le vide : crée une nouvelle forme reliée.
          const n = { id: uid(), x: q.x - 70, y: q.y - 30, w: 140, h: 60, shape: from.shape === 'text' ? 'round' : from.shape, text: '', color: from.color };
          d.nodes.push(n); d.edges.push({ id: uid(), from: from.id, to: n.id, label: '' }); sel = { kind: 'node', id: n.id }; changed(); editText(n);
        }
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
      return;
    }
    if (rs) {
      const n = node(rs.dataset.resize), w0 = n.w, h0 = n.h;
      const move = ev => { const q = pt(ev); n.w = Math.max(40, w0 + q.x - P.x); n.h = Math.max(30, h0 + q.y - P.y); draw(); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); save(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
      return;
    }
    if (ng) {
      const n = node(ng.dataset.node);
      if (mode === 'link') {
        if (!pending) { pending = n.id; draw(); return; }
        if (pending !== n.id) d.edges.push({ id: uid(), from: pending, to: n.id, label: '' });
        pending = null; mode = null; changed(); return;
      }
      sel = { kind: 'node', id: n.id }; draw();
      const ox = P.x - n.x, oy = P.y - n.y; let moved = false;
      const move = ev => { const q = pt(ev); n.x = Math.max(0, q.x - ox); n.y = Math.max(0, Math.min(d.h - n.h, q.y - oy)); moved = true; draw(); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) save(); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
      return;
    }
    if (eg) { sel = { kind: 'edge', id: eg.dataset.edge }; draw(); return; }
    sel = null; pending = null; draw();
  });
  s.addEventListener('dblclick', async e => {
    const ng = e.target.closest('[data-node]'), eg = e.target.closest('[data-edge]');
    if (ng) return editText(node(ng.dataset.node));
    if (eg) {
      const ed = d.edges.find(x => x.id === eg.dataset.edge);
      const v = await dialog({ title: 'Texte de la flèche', input: ed.label || '', ok: 'OK', placeholder: 'Ex. : oui, ensuite, dépend de…' });
      if (v !== null) { ed.label = v; changed(); }
      return;
    }
    addNode('round', pt(e));
  });
  box.addEventListener('keydown', e => {
    if (e.target !== box) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(); }
    if (e.key === 'Escape') { sel = null; mode = null; pending = null; draw(); }
  });

  box.append(tools, area);
  requestAnimationFrame(draw);
  return box;
}
