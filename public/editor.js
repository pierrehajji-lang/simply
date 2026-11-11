'use strict';
/* Simply — l'éditeur par blocs : texte enrichi, listes, blocs dépliables, encadrés, images, tableaux, schémas… */

const TEXT = new Set(['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code']);
const LIST = new Set(['bullet', 'number', 'todo', 'toggle']);
const BLOCKS = [
  { type: 'p', label: 'Texte', icon: 'Aa', kw: 'paragraphe texte', sec: 'Blocs de base' },
  { type: 'h1', label: 'Titre 1', icon: 'H1', kw: 'titre heading grand' },
  { type: 'h2', label: 'Titre 2', icon: 'H2', kw: 'titre heading moyen' },
  { type: 'h3', label: 'Titre 3', icon: 'H3', kw: 'titre heading petit' },
  { type: 'bullet', label: 'Liste à puces', icon: '•', kw: 'liste puces' },
  { type: 'number', label: 'Liste numérotée', icon: '1.', kw: 'liste numerotee nombre' },
  { type: 'todo', label: 'Liste de tâches', icon: 'i:square-check', kw: 'tache todo case cocher' },
  { type: 'toggle', label: 'Liste dépliable', icon: '▸', kw: 'toggle depliable repliable accordeon' },
  { type: 'quote', label: 'Citation', icon: '❝', kw: 'citation' },
  { type: 'callout', label: 'Encadré', icon: 'i:lightbulb', kw: 'encadre callout note info astuce' },
  { type: 'divider', label: 'Séparateur', icon: '—', kw: 'separateur ligne' },
  { type: 'code', label: 'Code', icon: '</>', kw: 'code programme' },
  { type: 'page', label: 'Sous-page', icon: 'i:file-text', kw: 'page sous-page nouvelle', sec: 'Pages' },
  { type: 'link', label: 'Lien vers une page', icon: '↗', kw: 'lien page existante mention' },
  { type: 'image', label: 'Image', icon: 'i:image', kw: 'image photo illustration', sec: 'Médias' },
  { type: 'table', label: 'Tableau simple', icon: '⊞', kw: 'tableau grille cellules simple', },
  { type: 'diagram', label: 'Schéma', icon: '◇', kw: 'schema diagramme dessin carte mentale organigramme fleche' },
  { type: 'db', label: 'Base de données — Tableau', icon: '▦', kw: 'base donnees tableau table excel', sec: 'Bases de données', view: 'table' },
  { type: 'db', label: 'Base de données — Kanban', icon: '▤', kw: 'base donnees kanban board tableau', view: 'board' },
  { type: 'db', label: 'Base de données — Calendrier', icon: '📅', kw: 'base donnees calendrier agenda', view: 'calendar' },
  { type: 'db', label: 'Base de données — Galerie', icon: '▣', kw: 'base donnees galerie cartes', view: 'gallery' },
  { type: 'db', label: 'Base de données — Liste', icon: '☰', kw: 'base donnees liste', view: 'list' },
];
const PH = { p: 'Tapez « / » pour insérer un bloc…', h1: 'Titre 1', h2: 'Titre 2', h3: 'Titre 3', bullet: 'Liste', number: 'Liste', todo: 'À faire', toggle: 'Titre du bloc dépliable', quote: 'Citation', callout: 'Écrivez quelque chose…', code: 'Code' };

let drag = null;   // bloc en cours de glisser-déposer
let slash = null;  // état du menu « / »

const newBlock = (type = 'p', html = '') => ({ id: uid(), type, html, text: textOfHtml(html) });
const textOf = id => $(`#main .block[data-id="${id}"] .text.nav`);
const indentOf = b => b.indent || 0;
// Fin (exclue) du groupe formé par un bloc et ses enfants (blocs suivants plus indentés).
function spanEnd(p, i) { const n = indentOf(p.blocks[i]); let j = i + 1; while (j < p.blocks.length && indentOf(p.blocks[j]) > n) j++; return j; }
const isEmptyDoc = p => !p.blocks.length || p.blocks.every(b => TEXT.has(b.type) && !b.text);

function insertAfter(p, b, type, html = '') {
  const nb = newBlock(type, html);
  nb.indent = indentOf(b);
  p.blocks.splice(p.blocks.indexOf(b) + 1, 0, nb);
  return nb;
}
function setHtml(b, html) { b.html = html; b.text = textOfHtml(html); }

// ---------- Rendu de la liste de blocs ----------
function renderBlocks(p) {
  const list = h('div', { class: 'blocks' });
  const nums = [];
  let hideBelow = null;
  p.blocks.forEach(b => {
    const ind = indentOf(b);
    if (hideBelow != null && ind > hideBelow) return;
    hideBelow = null;
    if (b.type === 'toggle' && !b.open) hideBelow = ind;
    nums.length = ind + 1;
    nums[ind] = b.type === 'number' ? (nums[ind] || 0) + 1 : 0;
    list.append(renderBlock(p, b, nums[ind]));
  });
  return list;
}

function renderBlock(p, b, num) {
  const ind = indentOf(b);
  const row = h('div', { class: `block b-${b.type}${b.checked ? ' done' : ''}${b.color ? ' ' + b.color : ''}`, 'data-id': b.id, style: ind ? `margin-left:${ind * 26}px` : null });
  row.append(h('div', { class: 'gutter' },
    h('div', { title: 'Ajouter un bloc en dessous', onclick: () => { const nb = insertAfterGroup(p, b); renderMain(); focusBlock(nb.id); const el = textOf(nb.id); if (el) openSlash(p, nb, el, -1); } }, ico('plus')),
    h('div', {
      class: 'handle', draggable: true, title: 'Glisser pour déplacer · cliquer pour le menu',
      onclick: e => blockMenu(e.currentTarget, p, b),
      ondragstart: e => { drag = { p, id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); e.dataTransfer.setDragImage(row, 0, 0); row.classList.add('dragging'); },
      ondragend: () => { drag = null; row.classList.remove('dragging'); clearDrop(); },
    }, ico('grip-vertical'))));
  row.addEventListener('dragover', e => {
    if (drag && drag.p === p) {
      e.preventDefault();
      const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      clearDrop(); row.classList.add(after ? 'drop-after' : 'drop-before');
    } else if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); clearDrop(); row.classList.add('drop-after'); }
  });
  row.addEventListener('drop', async e => {
    if (e.dataTransfer.files.length && !drag) {
      e.preventDefault(); clearDrop();
      return dropImages(p, b, [...e.dataTransfer.files]);
    }
    if (!drag || drag.p !== p) return;
    e.preventDefault();
    const after = row.classList.contains('drop-after'), id = drag.id;
    drag = null; clearDrop();
    moveBlock(p, id, b, after);
  });

  const t = b.type;
  if (t === 'divider') row.append(h('hr'));
  else if (t === 'db') row.append(renderDb(p, b));
  else if (t === 'image') row.append(renderImage(p, b));
  else if (t === 'table') row.append(renderTableBlock(p, b));
  else if (t === 'diagram') row.append(renderDiagram(p, b));
  else if (t === 'page' || t === 'link') {
    const tp = page(b.pageId);
    row.append(h('div', { class: 'page-link', onclick: () => tp && !tp.trashed ? openPage(b.pageId) : toast('Cette page est dans la corbeille ou n’existe plus.') },
      h('span', { class: 'pl-ic' }, tp ? tp.icon || '📄' : '❓'), h('span', { class: 'pl-t' }, tp ? (tp.title || 'Sans titre') : 'Page supprimée'),
      t === 'link' ? h('span', { class: 'muted small' }, '↗ lien') : null, tp?.trashed ? h('span', { class: 'muted small' }, '(corbeille)') : null));
  } else {
    if (t === 'bullet') row.append(h('span', { class: 'marker' }, ['•', '◦', '▪'][ind % 3]));
    if (t === 'number') row.append(h('span', { class: 'marker' }, (ind % 3 === 1 ? String.fromCharCode(96 + ((num - 1) % 26) + 1) : ind % 3 === 2 ? roman(num) : num) + '.'));
    if (t === 'todo') row.append(h('input', { type: 'checkbox', checked: !!b.checked, title: 'Cocher', onchange: e => { b.checked = e.target.checked; row.classList.toggle('done', b.checked); save(); } }));
    if (t === 'toggle') row.append(h('button', { class: 'tg-arrow' + (b.open ? ' open' : ''), title: b.open ? 'Replier' : 'Déplier', onclick: () => { b.open = !b.open; save(); renderMain(); if (b.open) ensureToggleChild(p, b); } }, '▶'));
    if (t === 'callout') row.append(h('button', { class: 'co-ic', title: 'Changer l’icône', onclick: e => iconPicker(e.currentTarget, b.icon, v => { b.icon = v || '💡'; save(); renderMain(); }) }, b.icon || '💡'));
    const ed = h('div', { class: 'text nav', contenteditable: t === 'code' ? 'plaintext-only' : 'true', spellcheck: t !== 'code', 'data-ph': PH[t] });
    if (t === 'code') ed.textContent = b.text; else ed.innerHTML = b.html ?? esc(b.text);
    ed.addEventListener('input', () => onInput(p, b, ed));
    ed.addEventListener('keydown', e => onKey(e, p, b, ed));
    ed.addEventListener('paste', e => onPaste(e, p, b, ed));
    row.append(ed);
  }
  return row;
}
const roman = n => { let r = '', v = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; for (const [k, s] of v) while (n >= k) { r += s; n -= k; } return r; };
const clearDrop = () => $$('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));

function moveBlock(p, id, target, after) {
  const i = p.blocks.findIndex(x => x.id === id);
  if (i < 0 || p.blocks[i] === target) return;
  const group = p.blocks.slice(i, spanEnd(p, i));
  if (group.includes(target)) return;
  p.blocks.splice(i, group.length);
  let at = p.blocks.indexOf(target);
  if (after) at = spanEnd(p, at);
  // Le groupe prend l'indentation de la cible.
  const d = indentOf(target) - indentOf(group[0]);
  group.forEach(x => { x.indent = Math.max(0, indentOf(x) + d); });
  p.blocks.splice(at, 0, ...group);
  save(); renderMain();
}

function focusBlock(id, pos = 'end') {
  const el = textOf(id);
  if (el) setCaret(el, pos === 'start' ? 0 : pos);
}
// Ajoute un bloc après un bloc et tous ses enfants.
function insertAfterGroup(p, b, type = 'p') {
  const i = p.blocks.indexOf(b), end = spanEnd(p, i);
  const nb = newBlock(type); nb.indent = indentOf(b);
  p.blocks.splice(end, 0, nb);
  save();
  return nb;
}
function ensureToggleChild(p, b) {
  const i = p.blocks.indexOf(b);
  if (spanEnd(p, i) > i + 1) return;
  const nb = newBlock('p'); nb.indent = indentOf(b) + 1;
  p.blocks.splice(i + 1, 0, nb); save(); renderMain(); focusBlock(nb.id);
}

function setType(p, b, type, opts = {}) {
  if (type === 'page' && !b.pageId) { b.pageId = createPage(docHost(p), b.text.trim()).id; renderSidebar(); }
  if (type === 'db' && !b.db) b.db = newDb(opts.title || 'Base de données', opts.view || 'table');
  if (type === 'table' && !b.rows) { b.rows = [['', '', ''], ['', '', ''], ['', '', '']]; b.header = true; }
  if (type === 'diagram' && !b.diagram) b.diagram = newDiagram();
  if (type === 'callout' && !b.icon) b.icon = '💡';
  if (type === 'code' && b.html) b.text = textOfHtml(b.html);
  if (!TEXT.has(type)) { b.html = ''; b.text = ''; }
  if (type === 'toggle') b.open = true;
  b.type = type;
}

// Choix d'un type depuis le menu « / » : transforme la ligne vide, ou ajoute un bloc en dessous.
async function applyType(p, b, item) {
  const type = item.type;
  if (type === 'link') {
    const pid = await choosePage('Lien vers une page');
    if (!pid) return renderMain();
    const target = b.text.trim() ? insertAfter(p, b, 'p') : b;
    setType(p, target, 'link'); target.pageId = pid; save(); renderMain(); return;
  }
  const target = b.text.trim() ? insertAfter(p, b, 'p') : b;
  setType(p, target, type, { view: item.view });
  save();
  if (type === 'page') return openPage(target.pageId, true);
  if (!TEXT.has(type)) {
    let next = p.blocks[p.blocks.indexOf(target) + 1];
    if (!next || !TEXT.has(next.type)) next = insertAfter(p, target, 'p');
    renderMain();
    if (type === 'divider') focusBlock(next.id, 'start');
    if (type === 'image') chooseImageFor(p, target);
    return;
  }
  renderMain(); focusBlock(target.id, 'end');
  if (type === 'toggle') ensureToggleChild(p, target);
}

function blockMenu(anchor, p, b) {
  const items = [];
  if (TEXT.has(b.type)) {
    items.push({ header: 'Transformer en' });
    BLOCKS.filter(x => TEXT.has(x.type)).forEach(x => items.push({ icon: x.icon, label: x.label, check: b.type === x.type, action: () => { setType(p, b, x.type); save(); renderMain(); focusBlock(b.id); if (x.type === 'toggle') ensureToggleChild(p, b); } }));
    items.push('-');
  }
  if (b.type !== 'db' && b.type !== 'diagram') items.push({ icon: '🎨', label: 'Couleur', hint: '›', action: () => colorMenu(anchor, b) });
  if (b.type === 'image' && b.url) items.push({ icon: '↺', label: 'Remplacer l’image', action: () => chooseImageFor(p, b) });
  if (b.type === 'table') items.push({ icon: '☰', label: b.header ? 'Sans ligne d’en-tête' : 'Avec ligne d’en-tête', action: () => { b.header = !b.header; save(); renderMain(); } });
  items.push({ icon: '⧉', label: 'Dupliquer', action: () => { const i = p.blocks.indexOf(b), end = spanEnd(p, i); const copy = p.blocks.slice(i, end).map(x => ({ ...clone(x), id: uid() })); copy.forEach(x => { if (x.db) x.db = refreshDbIds(x.db); }); p.blocks.splice(end, 0, ...copy); save(); renderMain(); } });
  items.push({ icon: '⇥', label: 'Décaler à droite', hint: 'Tab', action: () => { shiftIndent(p, b, 1); renderMain(); } });
  if (indentOf(b)) items.push({ icon: '⇤', label: 'Décaler à gauche', hint: '⇧Tab', action: () => { shiftIndent(p, b, -1); renderMain(); } });
  items.push('-');
  items.push({ icon: '🗑', label: 'Supprimer', danger: true, action: () => deleteBlock(p, b) });
  menu(anchor, items);
}
async function deleteBlock(p, b) {
  if (b.type === 'db' && b.db.rows.length && !await dialog({ title: 'Supprimer la base de données ?', text: `« ${b.db.title || 'Sans titre'} » et ses ${b.db.rows.length} fiche(s) seront supprimées (⌘Z pour annuler).`, ok: 'Supprimer', danger: true })) return;
  const i = p.blocks.indexOf(b);
  // Les enfants remontent d'un cran au lieu de disparaître.
  for (let j = i + 1; j < spanEnd(p, i); j++) p.blocks[j].indent = Math.max(0, indentOf(p.blocks[j]) - 1);
  p.blocks.splice(i, 1);
  save(); renderMain();
}
function colorMenu(anchor, b) {
  const set = c => { b.color = c; save(); renderMain(); };
  popup(anchor, [
    h('div', { class: 'mh' }, 'Couleur du texte'),
    h('button', { class: 'mi', onclick: () => { closePopup(); set(null); } }, h('span', { class: 'mi-ic' }, 'A'), 'Par défaut', !b.color ? h('span', { class: 'chk' }, '✓') : null),
    COLORS.map(c => h('button', { class: 'mi', onclick: () => { closePopup(); set('tc-' + c); } }, h('span', { class: 'mi-ic tc-' + c }, 'A'), COLOR_FR[c], b.color === 'tc-' + c ? h('span', { class: 'chk' }, '✓') : null)),
    h('div', { class: 'mh' }, 'Couleur de fond'),
    COLORS.map(c => h('button', { class: 'mi', onclick: () => { closePopup(); set('bg-' + c); } }, h('span', { class: 'mi-ic bg-' + c }, ' '), 'Fond ' + COLOR_FR[c].toLowerCase(), b.color === 'bg-' + c ? h('span', { class: 'chk' }, '✓') : null)),
  ]);
}
function shiftIndent(p, b, d) {
  const i = p.blocks.indexOf(b), end = spanEnd(p, i);
  if (d > 0) {
    const prev = p.blocks[i - 1];
    if (!prev || indentOf(b) > indentOf(prev)) return false;
  } else if (!indentOf(b)) return false;
  for (let j = i; j < end; j++) p.blocks[j].indent = Math.max(0, indentOf(p.blocks[j]) + d);
  save();
  return true;
}

// ---------- Saisie ----------
const MD = [['# ', 'h1'], ['## ', 'h2'], ['### ', 'h3'], ['- ', 'bullet'], ['* ', 'bullet'], ['1. ', 'number'], ['[] ', 'todo'], ['[ ] ', 'todo'], ['> ', 'toggle'], ['" ', 'quote'], ['```', 'code']];

function onInput(p, b, ed) {
  if (b.type === 'code') { b.text = ed.textContent; save(); return; }
  if (!ed.textContent && !ed.querySelector('img')) ed.innerHTML = '';
  setHtml(b, sanitize(ed.innerHTML));
  $('.tpl-strip')?.remove();
  save();
  const c = getCaret(ed);
  // Raccourcis façon Markdown : « # » + espace = titre, « - » + espace = puce, etc.
  if (b.type === 'p') {
    for (const [k, t] of MD) if (b.text.startsWith(k) && c === k.length) {
      closePopup(); rangeAt(ed, 0, k.length).deleteContents(); setHtml(b, sanitize(ed.innerHTML));
      setType(p, b, t); save(); renderMain(); focusBlock(b.id, 'start');
      if (t === 'toggle') ensureToggleChild(p, b);
      return;
    }
    if (b.text === '---') { closePopup(); setType(p, b, 'divider'); const nb = insertAfter(p, b, 'p'); save(); renderMain(); focusBlock(nb.id); return; }
  }
  if (slash && slash.b === b) return drawSlash();
  if (b.text[c - 1] === '/' && (c === 1 || /\s/.test(b.text[c - 2]))) openSlash(p, b, ed, c - 1);
}

function onKey(e, p, b, ed) {
  if (slash && slash.b === b) {
    const n = slash.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { slash.active = (slash.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; drawSlash(); } return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const it = slash.items[slash.active]; it ? chooseSlash(it) : closePopup(); return; }
    if (e.key === 'Escape') { e.preventDefault(); closePopup(); return; }
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'e' && b.type !== 'code') { e.preventDefault(); inlineCode(ed); return; }
  if (mod && e.key.toLowerCase() === 'k' && b.type !== 'code' && !getSelection().isCollapsed) { e.preventDefault(); e.stopPropagation(); addLink(ed); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (b.type === 'code' && !e.shiftKey) { document.execCommand('insertText', false, '  '); return; }
    const c = getCaret(ed);
    if (shiftIndent(p, b, e.shiftKey ? -1 : 1)) { renderMain(); focusBlock(b.id, c); }
    return;
  }
  const c = getCaret(ed), collapsed = getSelection().isCollapsed;
  if (e.key === 'Enter' && !e.shiftKey && (b.type !== 'code' || mod)) {
    e.preventDefault();
    if (LIST.has(b.type) && !b.text) {
      if (indentOf(b)) shiftIndent(p, b, -1); else b.type = 'p';
      save(); renderMain(); focusBlock(b.id); return;
    }
    // Coupe le texte au curseur : la fin part dans un nouveau bloc.
    let afterHtml = '';
    if (b.type !== 'code') {
      const sel = getSelection(); if (!collapsed) sel.getRangeAt(0).deleteContents();
      const r = document.createRange(); r.setStart(...pointAt(ed, getCaret(ed))); r.setEnd(ed, ed.childNodes.length);
      const box = document.createElement('div'); box.append(r.extractContents());
      afterHtml = sanitize(box.innerHTML);
      setHtml(b, sanitize(ed.innerHTML));
    }
    let nb;
    if (b.type === 'toggle' && b.open) {
      nb = newBlock('p', afterHtml); nb.indent = indentOf(b) + 1;
      p.blocks.splice(p.blocks.indexOf(b) + 1, 0, nb);
    } else if (b.type === 'toggle' || (b.type !== 'code' && /^h[123]$/.test(b.type) && c === 0 && b.text)) {
      nb = insertAfterGroup(p, b, b.type === 'toggle' ? 'toggle' : 'p'); setHtml(nb, afterHtml);
    } else {
      const keep = LIST.has(b.type) ? b.type : b.type === 'callout' || b.type === 'quote' ? 'p' : 'p';
      nb = insertAfter(p, b, keep, afterHtml);
      if (keep === 'toggle') nb.open = false;
    }
    save(); renderMain(); focusBlock(nb.id, 'start');
    return;
  }
  if (e.key === 'Backspace' && c === 0 && collapsed) {
    if (b.type !== 'p') { e.preventDefault(); if (b.type === 'code') b.html = esc(b.text); b.type = 'p'; save(); renderMain(); focusBlock(b.id, 'start'); return; }
    if (indentOf(b)) { e.preventDefault(); shiftIndent(p, b, -1); renderMain(); focusBlock(b.id, 'start'); return; }
    const i = p.blocks.indexOf(b);
    const prevEl = navList()[navList().indexOf(ed) - 1];
    const prev = prevEl && p.blocks.find(x => x.id === prevEl.closest('.block')?.dataset.id);
    if (prev && TEXT.has(prev.type)) {
      e.preventDefault();
      const at = prev.text.length;
      if (prev.type === 'code') prev.text += b.text; else setHtml(prev, (prev.html ?? esc(prev.text)) + b.html);
      p.blocks.splice(i, 1);
      save(); renderMain(); focusBlock(prev.id, at);
    } else if (!b.text && i > 0) {
      e.preventDefault();
      p.blocks.splice(i, 1);
      const before = p.blocks.slice(0, i).reverse().find(x => TEXT.has(x.type));
      save(); renderMain(); if (before) focusBlock(before.id, 'end');
    }
    return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && collapsed && atEdge(ed, e.key === 'ArrowUp')) {
    const all = navList();
    const t = all[all.indexOf(ed) + (e.key === 'ArrowUp' ? -1 : 1)];
    if (t) { e.preventDefault(); setCaret(t, e.key === 'ArrowUp' ? 'end' : 0); }
  }
}
const navList = () => $$('#main .page-title, #main .text.nav');

// ---------- Coller ----------
async function onPaste(e, p, b, ed) {
  const cd = e.clipboardData;
  const files = [...cd.files].filter(f => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); return dropImages(p, b, files); }
  if (b.type === 'code') return; // collage brut
  e.preventDefault();
  const text = cd.getData('text/plain'), html = cd.getData('text/html');
  // Un lien collé sur du texte sélectionné devient un lien.
  if (/^https?:\/\/\S+$/.test(text.trim()) && !getSelection().isCollapsed) { document.execCommand('createLink', false, text.trim()); return onInput(p, b, ed); }
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.filter(l => l.trim()).length > 1) {
    const blocks = mdToBlocks(text);
    if (!blocks.length) return;
    blocks.forEach(x => { x.indent = indentOf(x) + indentOf(b); });
    const i = p.blocks.indexOf(b);
    if (!b.text) p.blocks.splice(i, 1, ...blocks); else p.blocks.splice(i + 1, 0, ...blocks);
    save(); renderMain();
    const last = blocks.filter(x => TEXT.has(x.type)).at(-1);
    if (last) focusBlock(last.id, 'end');
    return;
  }
  if (html) document.execCommand('insertHTML', false, sanitize(html).replace(/<br>/g, ' '));
  else document.execCommand('insertText', false, text);
  onInput(p, b, ed);
}

async function dropImages(p, b, files) {
  let at = b;
  for (const f of files) {
    if (!/^image\//.test(f.type)) { toast(`« ${f.name} » n’est pas une image.`); continue; }
    try {
      const url = await uploadImage(f);
      const nb = { id: uid(), type: 'image', url, caption: '', width: 100, indent: indentOf(at) };
      if (at.type === 'p' && !at.text && at === b) { Object.assign(at, nb, { id: at.id }); }
      else { p.blocks.splice(p.blocks.indexOf(at) + 1, 0, nb); at = nb; }
    } catch (err) { toast(err.message); }
  }
  save(); renderMain();
}

// ---------- Texte enrichi : barre de mise en forme ----------
let fmtBar = null;
function hideFmt() { fmtBar?.remove(); fmtBar = null; }
document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  const ed = sel.rangeCount && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('[contenteditable="true"]');
  if (!ed || sel.isCollapsed || !ed.closest('#main') || ed.classList.contains('page-title') || ed.closest('.dg') || !sel.toString().trim()) return hideFmt();
  showFmt(ed, sel.getRangeAt(0).getBoundingClientRect());
});
function showFmt(ed, rect) {
  const btn = (label, title, fn, cls = '') => h('button', { class: cls, title, onmousedown: e => { e.preventDefault(); fn(); } }, label);
  const run = (cmd, val) => { document.execCommand(cmd, false, val); ed.dispatchEvent(new Event('input')); };
  const bar = h('div', { class: 'fmtbar' },
    btn(h('b', {}, 'B'), 'Gras (⌘B)', () => run('bold')),
    btn(h('i', {}, 'I'), 'Italique (⌘I)', () => run('italic')),
    btn(h('u', {}, 'U'), 'Souligné (⌘U)', () => run('underline')),
    btn(h('s', {}, 'S'), 'Barré', () => run('strikeThrough')),
    btn('</>', 'Code (⌘E)', () => inlineCode(ed), 'mono'),
    btn('🔗', 'Lien (⌘K)', () => addLink(ed)),
    btn(h('span', { class: 'tc-red' }, 'A'), 'Couleur', () => textColorMenu(bar, ed)),
    btn('⌫', 'Effacer la mise en forme', () => { run('removeFormat'); run('unlink'); }),
    btn('✨ IA', 'Corriger, améliorer, traduire avec l’assistant', () => aiSelectionMenu(bar, ed), 'ai-btn'));
  hideFmt();
  fmtBar = bar;
  document.body.append(bar);
  bar.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - bar.offsetWidth / 2, innerWidth - bar.offsetWidth - 8)) + 'px';
  bar.style.top = Math.max(8, rect.top - bar.offsetHeight - 8) + 'px';
}
function textColorMenu(anchor, ed) {
  const sel = getSelection(), range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const apply = (cmd, c) => {
    closePopup();
    ed.focus(); sel.removeAllRanges(); range && sel.addRange(range);
    if (cmd === 'reset') { document.execCommand('removeFormat'); }
    else {
      document.execCommand('styleWithCSS', false, cmd === 'hiliteColor');
      document.execCommand(cmd, false, SENTINEL(c));
      document.execCommand('styleWithCSS', false, false);
    }
    ed.dispatchEvent(new Event('input'));
    const b = blockOfEd(ed); if (b && b.type !== 'code') ed.innerHTML = b.html;
  };
  popup(anchor, [
    h('div', { class: 'mh' }, 'Couleur du texte'),
    h('div', { class: 'swatches' }, COLORS.map(c => h('button', { class: 'sw tc-' + c, title: COLOR_FR[c], onmousedown: e => e.preventDefault(), onclick: () => apply('foreColor', c) }, 'A'))),
    h('div', { class: 'mh' }, 'Surlignage'),
    h('div', { class: 'swatches' }, COLORS.map(c => h('button', { class: 'sw bg-' + c, title: COLOR_FR[c], onmousedown: e => e.preventDefault(), onclick: () => apply('hiliteColor', c) }, 'A'))),
    h('button', { class: 'mi', onmousedown: e => e.preventDefault(), onclick: () => apply('reset') }, h('span', { class: 'mi-ic' }, '⌫'), 'Couleur par défaut'),
  ]);
}
function blockOfEd(ed) {
  const id = ed.closest('.block')?.dataset.id;
  const d = currentDoc();
  return id && d && d.blocks.find(x => x.id === id);
}
function inlineCode(ed) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const txt = sel.toString();
  const inCode = (sel.anchorNode.parentElement || sel.anchorNode).closest('code');
  if (inCode) inCode.replaceWith(inCode.textContent);
  else document.execCommand('insertHTML', false, `<code>${esc(txt)}</code>`);
  ed.dispatchEvent(new Event('input'));
}
async function addLink(ed) {
  const sel = getSelection(), range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  hideFmt();
  const pages = S.pages.filter(x => !x.trashed);
  const v = await dialog({ title: 'Ajouter un lien', text: 'Adresse web (https://…) ou nom d’une de vos pages :', input: '', ok: 'Ajouter', placeholder: 'https://… ou nom de page' });
  if (!v || !range) return;
  ed.focus(); sel.removeAllRanges(); sel.addRange(range);
  let href = v;
  const pg = pages.find(x => fold(x.title) === fold(v)) || (!/[./:]/.test(v) && pages.find(x => fold(x.title).includes(fold(v))));
  if (pg) href = '#page:' + pg.id;
  else if (!/^(https?:|mailto:|tel:)/i.test(v)) href = 'https://' + v;
  document.execCommand('createLink', false, href);
  ed.dispatchEvent(new Event('input'));
}
// Clic sur un lien dans le texte : ouvre la page ou le site.
document.addEventListener('click', e => {
  const a = e.target.closest('#main .text a[href], #main .cell-ed a[href]');
  if (!a || !getSelection().isCollapsed) return;
  const href = a.getAttribute('href');
  e.preventDefault();
  if (href.startsWith('#page:')) openPage(href.slice(6));
  else window.open(href, '_blank', 'noopener');
});

// ---------- Menu « / » ----------
function openSlash(p, b, el, start) { slash = { p, b, el, start, active: 0, items: BLOCKS }; drawSlash(); }
function drawSlash() {
  const s = slash, text = s.el.textContent, c = getCaret(s.el);
  if (s.start >= 0 && (c <= s.start || text[s.start] !== '/')) return closePopup();
  const q = s.start >= 0 ? fold(text.slice(s.start + 1, c)).trim() : '';
  s.items = BLOCKS.filter(x => !q || fold(x.label + ' ' + x.kw).includes(q));
  if (!s.items.length && q.length > 12) return closePopup();
  s.active = Math.max(0, Math.min(s.active, s.items.length - 1));
  const list = [];
  s.items.forEach((x, i) => {
    if (!q && x.sec) list.push(h('div', { class: 'mh' }, x.sec));
    list.push(h('button', { class: 'mi' + (i === s.active ? ' on' : ''), onmousedown: e => e.preventDefault(), onclick: () => chooseSlash(x) }, h('span', { class: 'mi-ic' }, x.icon), x.label));
  });
  const el = popup(caretRect(s.el), list.length ? list : [h('div', { class: 'pad muted small' }, 'Aucun bloc trouvé')], null, 'slash-pop');
  slash = s; // popup() a réinitialisé l'état : on le remet
  el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function chooseSlash(item) {
  const { p, b, el, start } = slash, c = getCaret(el);
  closePopup();
  if (start >= 0) { rangeAt(el, start, c).deleteContents(); setHtml(b, sanitize(el.innerHTML)); }
  applyType(p, b, item);
}

// Choisir une page existante (lien, déplacement…).
function choosePage(title, exclude = new Set()) {
  return new Promise(res => {
    let close, done = false;
    const finish = v => { if (done) return; done = true; close(); res(v); };
    const inp = h('input', { class: 'search-in', placeholder: 'Chercher une page…' });
    const list = h('div', { class: 'results' });
    const draw = () => {
      const q = fold(inp.value.trim());
      const pages = S.pages.filter(x => !x.trashed && !exclude.has(x.id) && (!q || fold(x.title || 'Sans titre').includes(q))).slice(0, 40);
      list.replaceChildren(...(pages.length ? pages.map(pg => h('button', { class: 'res', onclick: () => finish(pg.id) }, h('span', {}, pg.icon || '📄'), h('span', { class: 'res-main' }, h('span', { class: 'res-t' }, pg.title || 'Sans titre'), h('span', { class: 'res-s' }, pathOf(pg)))))
        : [h('div', { class: 'pad muted' }, 'Aucune page')]));
    };
    inp.oninput = draw;
    inp.onkeydown = e => { if (e.key === 'Enter') list.querySelector('.res')?.click(); };
    close = modal(title, h('div', {}, inp, list), () => finish(null));
    draw(); inp.focus();
  });
}

// ---------- Image ----------
async function chooseImageFor(p, b) {
  const f = await pickImage();
  if (!f) return;
  try { b.url = await uploadImage(f); b.width ||= 100; save(); renderMain(); } catch (err) { toast(err.message); }
}
function renderImage(p, b) {
  if (!b.url) {
    const box = h('div', { class: 'img-empty' },
      h('span', {}, '🖼  Ajouter une image'),
      h('button', { class: 'btn', onclick: () => chooseImageFor(p, b) }, 'Choisir un fichier'),
      h('button', { class: 'btn', onclick: async () => { const u = await dialog({ title: 'Image depuis un lien', text: 'Adresse de l’image :', input: '', ok: 'Ajouter', placeholder: 'https://…' }); if (u) { b.url = u; b.width = 100; save(); renderMain(); } } }, 'Coller un lien'),
      h('span', { class: 'muted small' }, 'ou glissez / collez une image ici'));
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) uploadImage(f).then(u => { b.url = u; b.width = 100; save(); renderMain(); }).catch(err => toast(err.message)); });
    return box;
  }
  const img = h('img', { src: b.url, alt: b.caption || '', draggable: false, onclick: () => openLightbox(b.url) });
  const fig = h('figure', { class: 'img-fig', style: `width:${b.width || 100}%` }, img,
    h('div', { class: 'img-handle', title: 'Glisser pour redimensionner', onmousedown: e => resizeImage(e, b, fig) }),
    h('figcaption', { class: 'img-cap', contenteditable: 'plaintext-only', 'data-ph': 'Ajouter une légende…', text: b.caption || '', oninput: e => { b.caption = e.target.textContent; save(); } }));
  return h('div', { class: 'img-wrap' }, fig);
}
function resizeImage(e, b, fig) {
  e.preventDefault();
  const wrap = fig.parentElement.getBoundingClientRect(), x0 = e.clientX, w0 = fig.getBoundingClientRect().width;
  const move = ev => { const w = Math.max(15, Math.min(100, ((w0 + (ev.clientX - x0) * 2) / wrap.width) * 100)); fig.style.width = w + '%'; b.width = Math.round(w); };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); save(); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}
function openLightbox(url) {
  const ov = h('div', { class: 'lightbox', onclick: () => ov.remove() }, h('img', { src: url }));
  document.body.append(ov);
}

// ---------- Tableau simple ----------
function renderTableBlock(p, b) {
  const nCols = Math.max(1, ...b.rows.map(r => r.length));
  b.rows.forEach(r => { while (r.length < nCols) r.push(''); });
  const redraw = () => { save(); renderMain(); };
  const cellMenu = (e, i, j) => {
    e.preventDefault();
    menu({ getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) }, [
      { icon: '↑', label: 'Insérer une ligne au-dessus', action: () => { b.rows.splice(i, 0, Array(nCols).fill('')); redraw(); } },
      { icon: '↓', label: 'Insérer une ligne en dessous', action: () => { b.rows.splice(i + 1, 0, Array(nCols).fill('')); redraw(); } },
      { icon: '←', label: 'Insérer une colonne à gauche', action: () => { b.rows.forEach(r => r.splice(j, 0, '')); redraw(); } },
      { icon: '→', label: 'Insérer une colonne à droite', action: () => { b.rows.forEach(r => r.splice(j + 1, 0, '')); redraw(); } },
      '-',
      b.rows.length > 1 ? { icon: '🗑', label: 'Supprimer la ligne', danger: true, action: () => { b.rows.splice(i, 1); redraw(); } } : null,
      nCols > 1 ? { icon: '🗑', label: 'Supprimer la colonne', danger: true, action: () => { b.rows.forEach(r => r.splice(j, 1)); redraw(); } } : null,
    ]);
  };
  const table = h('table', { class: 'stbl' + (b.header ? ' with-head' : '') }, b.rows.map((r, i) => h('tr', {}, r.map((v, j) => {
    const cell = h(i === 0 && b.header ? 'th' : 'td', {}, h('div', {
      class: 'cell-ed', contenteditable: 'true', html: v,
      oninput: e => { b.rows[i][j] = sanitize(e.target.innerHTML); save(); },
      oncontextmenu: e => cellMenu(e, i, j),
      onkeydown: e => {
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          const eds = $$('.cell-ed', table);
          let k = eds.indexOf(e.target) + (e.key === 'Enter' ? nCols : e.shiftKey ? -1 : 1);
          if (k >= eds.length) { b.rows.push(Array(nCols).fill('')); save(); renderMain(); const t2 = $(`#main .block[data-id="${b.id}"] .stbl`); const all = $$('.cell-ed', t2); setCaret(all[Math.min(k, all.length - 1)], 0); return; }
          if (k >= 0) setCaret(eds[k], 'end');
        }
      },
    }));
    return cell;
  }))));
  return h('div', { class: 'stbl-wrap' },
    h('div', { class: 'stbl-scroll' }, table, h('button', { class: 'stbl-addc', title: 'Ajouter une colonne', onclick: () => { b.rows.forEach(r => r.push('')); redraw(); } }, '+')),
    h('button', { class: 'stbl-addr', title: 'Ajouter une ligne', onclick: () => { b.rows.push(Array(nCols).fill('')); redraw(); } }, '+'),
    h('div', { class: 'muted small hint' }, 'Clic droit sur une case pour ajouter ou supprimer des lignes et colonnes.'));
}

// ---------- Markdown → blocs (copier-coller et import) ----------
function inlineMd(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
}
// Le texte peut déjà contenir quelques balises HTML (export Notion) : on les garde après nettoyage.
function richLine(s) {
  if (/<\/?(b|i|u|s|code|a|strong|em|span|br|mention-page|mention-date|mention-user)[\s>/]/i.test(s)) {
    const md = s.replace(/<mention-page[^>]*url="([^"]*)"[^>]*>(.*?)<\/mention-page>/g, '$2').replace(/<\/?mention-[^>]*>/g, '').replace(/<span[^>]*color="([a-z]+)[^"]*"[^>]*>/g, '<span class="tc-$1">');
    return sanitize(inlineMd(md).replace(/&lt;(\/?(?:b|i|u|s|code|strong|em|br|span)(?:\s[^&]*)?\/?)&gt;/gi, '<$1>').replace(/&lt;a href=&quot;([^&]*)&quot;&gt;/g, '<a href="$1">').replace(/&lt;\/a&gt;/g, '</a>').replace(/&quot;/g, '"'));
  }
  return inlineMd(s.replace(/\\([\[\]*_`#|-])/g, '$1'));
}
function mdToBlocks(md) {
  const out = [];
  const lines = md.replace(/\r/g, '').split('\n');
  const push = (type, html, ind, extra) => { const b = newBlock(type, html); if (ind) b.indent = ind; Object.assign(b, extra || {}); out.push(b); return b; };
  const indentLevel = s => { const m = s.match(/^[\t ]*/)[0]; return Math.floor(m.replace(/\t/g, '  ').length / 2); };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let line = raw.trim();
    const ind = indentLevel(raw);
    if (!line || line === '<p />' || line === '<p></p>' || line === '<empty-block/>') continue;
    if (line.startsWith('```')) {
      const code = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
      const b = push('code', '', ind); b.text = code.join('\n'); b.html = esc(b.text);
      continue;
    }
    // Tableau « | a | b | »
    if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const l = lines[i].trim();
        if (/^\|[\s:|-]+\|$/.test(l)) continue;
        rows.push(l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => richLine(c.trim())));
      }
      i--;
      push('table', '', ind, { rows, header: true });
      continue;
    }
    // Tableau HTML (<table>…</table>)
    if (/^<table/i.test(line)) {
      let buf = line;
      while (!/<\/table>/i.test(buf) && ++i < lines.length) buf += '\n' + lines[i];
      const d = document.createElement('div'); d.innerHTML = buf;
      const rows = $$('tr', d).map(tr => $$('td,th', tr).map(td => sanitize(td.innerHTML.trim())));
      if (rows.length) push('table', '', ind, { rows, header: !!d.querySelector('th') || /header-row="true"/.test(buf) });
      continue;
    }
    // Encadré Notion : <callout icon="💡"> … </callout>
    if (/^<callout/i.test(line)) {
      const icon = (line.match(/icon="([^"]*)"/) || [])[1] || '💡';
      const color = (line.match(/color="([a-z]+)/) || [])[1];
      const body = [];
      let rest = line.replace(/^<callout[^>]*>/i, '');
      if (/<\/callout>/i.test(rest)) body.push(rest.replace(/<\/callout>.*/i, ''));
      else { if (rest.trim()) body.push(rest); while (++i < lines.length && !/<\/callout>/i.test(lines[i])) body.push(lines[i].trim()); if (i < lines.length) body.push(lines[i].replace(/<\/callout>.*/i, '').trim()); }
      push('callout', body.filter(Boolean).map(richLine).join('<br>'), ind, { icon, color: color && COLORS.includes(color) ? 'bg-' + color : null });
      continue;
    }
    // Bloc dépliable Notion : <details><summary>Titre</summary> … </details>
    if (/^<details/i.test(line)) {
      const sm = line.match(/<summary>(.*?)<\/summary>/i);
      push('toggle', richLine(sm ? sm[1] : ''), ind, { open: false });
      continue;
    }
    if (/^<\/?(details|summary|columns|column|div|page|database|synced_block)[^>]*>$/i.test(line)) continue;
    if (/^<image/i.test(line) || /^!\[.*\]\(.*\)$/.test(line)) {
      const src = (line.match(/source="([^"]*)"/) || line.match(/\]\(([^)]*)\)/) || [])[1];
      if (src && /^https?:/.test(src)) push('image', '', ind, { url: src, width: 100, caption: '' });
      continue;
    }
    let m;
    if (/^(---|\*\*\*|___)$/.test(line)) { push('divider', '', ind); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { push('h' + Math.min(3, m[1].length), richLine(m[2]), ind); continue; }
    if ((m = line.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/))) { push('todo', richLine(m[2]), ind, { checked: m[1] !== ' ' }); continue; }
    if ((m = line.match(/^\[([ xX])\]\s+(.*)$/))) { push('todo', richLine(m[2]), ind, { checked: m[1] !== ' ' }); continue; }
    if ((m = line.match(/^[-*+•]\s+(.*)$/))) { push('bullet', richLine(m[1]), ind); continue; }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { push('number', richLine(m[1]), ind); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { push('quote', richLine(m[1]), ind); continue; }
    push('p', richLine(line.replace(/^<p>|<\/p>$/g, '')), ind);
  }
  return out;
}

// Blocs → Markdown (export)
function blocksToMd(blocks) {
  const md = html => {
    const d = document.createElement('div'); d.innerHTML = html || '';
    const walk = n => [...n.childNodes].map(c => {
      if (c.nodeType === 3) return c.textContent;
      const inner = walk(c);
      switch (c.tagName) {
        case 'B': return `**${inner}**`; case 'I': return `*${inner}*`; case 'S': return `~~${inner}~~`; case 'CODE': return '`' + inner + '`';
        case 'A': return `[${inner}](${c.getAttribute('href')})`; case 'BR': return '\n'; default: return inner;
      }
    }).join('');
    return walk(d);
  };
  let n = 0;
  return blocks.map(b => {
    const pre = '  '.repeat(indentOf(b));
    n = b.type === 'number' ? n + 1 : 0;
    switch (b.type) {
      case 'h1': return `# ${md(b.html)}`; case 'h2': return `## ${md(b.html)}`; case 'h3': return `### ${md(b.html)}`;
      case 'bullet': case 'toggle': return `${pre}- ${md(b.html)}`;
      case 'number': return `${pre}${n}. ${md(b.html)}`;
      case 'todo': return `${pre}- [${b.checked ? 'x' : ' '}] ${md(b.html)}`;
      case 'quote': return `> ${md(b.html)}`;
      case 'callout': return `> ${b.icon || '💡'} ${md(b.html)}`;
      case 'code': return '```\n' + b.text + '\n```';
      case 'divider': return '---';
      case 'image': return `![${b.caption || ''}](${b.url || ''})`;
      case 'table': return b.rows.map((r, i) => '| ' + r.map(c => md(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |' + (i === 0 ? '\n|' + r.map(() => ' --- |').join('') : '')).join('\n');
      case 'page': case 'link': { const t = page(b.pageId); return t ? `[${t.icon || ''} ${t.title || 'Sans titre'}]` : ''; }
      case 'db': return dbToMd(b.db);
      case 'diagram': return `*[Schéma : ${b.diagram.nodes.map(x => x.text).filter(Boolean).join(', ')}]*`;
      default: return pre + md(b.html);
    }
  }).join('\n\n');
}
