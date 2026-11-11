'use strict';
/* Simply — bases de données : colonnes typées, fiches (chaque ligne est une page), vues, filtres, tris, calculs, modèles, CSV. */

const COLTYPES = {
  title: ['Titre', 'Aa'], text: ['Texte', '≡'], number: ['Nombre', '#'], select: ['Sélection', '▾'], status: ['Statut', '◔'],
  multi: ['Multi-sélection', '☰'], date: ['Date', '📅'], checkbox: ['Case à cocher', '☑'], url: ['Lien (URL)', '🔗'],
  email: ['E-mail', '@'], phone: ['Téléphone', '☎'], person: ['Personne', '👤'], relation: ['Relation', '↗'], created: ['Date de création', '🕒'],
};
const VIEWTYPES = { table: ['Tableau', '▦'], board: ['Kanban', '▤'], calendar: ['Calendrier', '📅'], gallery: ['Galerie', '▣'], list: ['Liste', '☰'], chart: ['Graphique', '📊'], timeline: ['Chronologie', '⟷'] };
const opt = (name, color) => ({ id: uid(), name, color: color || COLORS[0] });
const isChoice = t => t === 'select' || t === 'status' || t === 'multi';
const isMulti = t => t === 'multi' || t === 'relation';
const isBlank = v => v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
const pill = o => h('span', { class: 'pill c-' + (o.color || 'gray') }, o.name);

// ---------- Création ----------
function newView(type, db) {
  const sel = db.columns.find(c => c.type === 'status') || db.columns.find(c => c.type === 'select');
  return { id: uid(), name: VIEWTYPES[type][0], type, sorts: [], filters: [], hidden: [], groupBy: sel?.id || null, dateCol: db.columns.find(c => c.type === 'date')?.id || null, calc: {}, widths: {} };
}
function newDb(title = 'Base de données', view = 'table') {
  const db = { id: uid(), title, columns: [], rows: [], views: [], templates: [] };
  db.columns.push({ id: uid(), name: 'Nom', type: 'title' });
  db.columns.push({ id: uid(), name: 'Statut', type: 'status', options: [opt('À faire', 'gray'), opt('En cours', 'blue'), opt('Terminé', 'green')] });
  if (view === 'calendar') db.columns.push({ id: uid(), name: 'Date', type: 'date' });
  for (let i = 0; i < 3; i++) db.rows.push(newRowObj(db));
  if (view === 'calendar') db.rows.forEach((r, i) => { r.cells[db.columns[2].id] = today(i * 2); });
  const v = newView(view, db);
  db.views.push(v); db.view = v.id;
  return db;
}
function newRowObj(db, cells = {}) {
  return { id: uid(), cells: { ...cells }, created: new Date().toISOString(), blocks: [] };
}
// Copie d'une base avec de nouveaux identifiants (dupliquer un bloc, utiliser un modèle).
function refreshDbIds(db) {
  db = clone(db); db.id = uid();
  const rowMap = {};
  db.rows.forEach(r => { const n = uid(); rowMap[r.id] = n; r.id = n; });
  return db;
}

// ---------- Recherche des bases et des fiches dans tout l'espace ----------
function eachDb(fn) {
  const walk = (blocks, host) => {
    for (const b of blocks || []) if (b.type === 'db' && b.db) {
      if (fn(b.db, b, host) === false) return false;
      for (const r of b.db.rows) if (walk(r.blocks, host) === false) return false;
    }
  };
  for (const pg of S.pages) if (walk(pg.blocks, pg) === false) return;
}
function findDb(id) { let res = null; eachDb((db, b, host) => { if (db.id === id) { res = { db, b, host }; return false; } }); return res; }
function findRow(rowId) {
  let res = null;
  eachDb((db, b, host) => { const row = db.rows.find(r => r.id === rowId); if (row) { res = { db, b, host, row }; return false; } });
  return res;
}
const titleCol = db => db.columns.find(c => c.type === 'title') || db.columns[0];
const rowTitle = (db, r) => String(r.cells[titleCol(db).id] ?? '') ;
const colById = (db, id) => db.columns.find(c => c.id === id);
const optOf = (c, id) => (c.options || []).find(o => o.id === id);
const curView = db => db.views.find(v => v.id === db.view) || db.views[0];

// ---------- Valeurs ----------
function cellText(c, v, r) {
  if (c.type === 'created') return r ? fmtDateTime(r.created) : '';
  if (v == null || v === '') return '';
  switch (c.type) {
    case 'checkbox': return v ? 'Oui' : 'Non';
    case 'date': return fmtDate(v);
    case 'select': case 'status': return optOf(c, v)?.name || '';
    case 'multi': return [].concat(v).map(id => optOf(c, id)?.name).filter(Boolean).join(', ');
    case 'relation': { const t = findDb(c.relation)?.db; return t ? [].concat(v).map(id => t.rows.find(x => x.id === id)).filter(Boolean).map(x => rowTitle(t, x) || 'Sans titre').join(', ') : ''; }
    case 'number': return fmtNumber(c, v);
    default: return String(v);
  }
}
function fmtNumber(c, v) {
  if (v == null || v === '' || isNaN(v)) return '';
  const n = Number(v);
  if (c.format === 'euro') return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  if (c.format === 'percent') return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 6 });
}
function sortKey(c, v, r) {
  if (c.type === 'created') return r.created;
  if (v == null || v === '') return c.type === 'checkbox' ? 0 : null;
  if (c.type === 'number') return Number(v);
  if (c.type === 'checkbox') return v ? 1 : 0;
  if (c.type === 'select' || c.type === 'status') { const i = (c.options || []).findIndex(o => o.id === v); return i < 0 ? null : i; }
  if (c.type === 'date') return v;
  return cellText(c, v, r) || null;
}

// ---------- Filtres ----------
const OPS = {
  text: [['contains', 'contient'], ['ncontains', 'ne contient pas'], ['is', 'est'], ['empty', 'est vide'], ['nempty', 'n’est pas vide']],
  number: [['eq', '='], ['neq', '≠'], ['gt', '>'], ['lt', '<'], ['gte', '≥'], ['lte', '≤'], ['empty', 'est vide'], ['nempty', 'n’est pas vide']],
  select: [['is', 'est'], ['isnot', 'n’est pas'], ['empty', 'est vide'], ['nempty', 'n’est pas vide']],
  multi: [['has', 'contient'], ['nhas', 'ne contient pas'], ['empty', 'est vide'], ['nempty', 'n’est pas vide']],
  checkbox: [['checked', 'est coché'], ['unchecked', 'n’est pas coché']],
  date: [['is', 'est le'], ['before', 'avant le'], ['after', 'après le'], ['past', 'est passée'], ['future', 'aujourd’hui ou après'], ['week', 'cette semaine'], ['month', 'ce mois-ci'], ['empty', 'est vide'], ['nempty', 'n’est pas vide']],
};
const opGroup = t => ({ number: 'number', select: 'select', status: 'select', multi: 'multi', relation: 'multi', checkbox: 'checkbox', date: 'date', created: 'date' }[t] || 'text');
const NOVALUE = new Set(['empty', 'nempty', 'checked', 'unchecked', 'past', 'future', 'week', 'month']);
function matchFilter(c, f, r) {
  const v = c.type === 'created' ? r.created?.slice(0, 10) : r.cells[c.id];
  const val = f.value ?? '';
  switch (f.op) {
    case 'empty': return isBlank(v);
    case 'nempty': return !isBlank(v);
    case 'checked': return !!v;
    case 'unchecked': return !v;
  }
  if (!NOVALUE.has(f.op) && (val === '' || (Array.isArray(val) && !val.length))) return true; // filtre pas encore rempli
  const g = opGroup(c.type);
  if (g === 'number') {
    if (isBlank(v)) return f.op === 'neq';
    const x = Number(v), y = Number(String(val).replace(',', '.'));
    return { eq: x === y, neq: x !== y, gt: x > y, lt: x < y, gte: x >= y, lte: x <= y }[f.op];
  }
  if (g === 'select') return f.op === 'is' ? v === val : v !== val;
  if (g === 'multi') { const has = [].concat(v || []).includes(val); return f.op === 'has' ? has : !has; }
  if (g === 'date') {
    const d = v ? String(v).slice(0, 10) : '';
    const t = today();
    if (f.op === 'past') return !!d && d < t;
    if (f.op === 'future') return !!d && d >= t;
    if (f.op === 'week') { const n = new Date(); const day = (n.getDay() + 6) % 7; const a = today(-day), b = today(6 - day); return !!d && d >= a && d <= b; }
    if (f.op === 'month') return !!d && d.slice(0, 7) === t.slice(0, 7);
    if (!d) return false;
    return { is: d === val, before: d < val, after: d > val }[f.op];
  }
  const s = fold(cellText(c, v, r)), q = fold(val);
  return { contains: s.includes(q), ncontains: !s.includes(q), is: s === q }[f.op];
}
function visibleRows(db, view, q = '') {
  let rows = db.rows.slice();
  for (const f of view.filters || []) { const c = colById(db, f.col); if (c) rows = rows.filter(r => matchFilter(c, f, r)); }
  if (q.trim()) { const k = fold(q.trim()); rows = rows.filter(r => db.columns.some(c => fold(cellText(c, r.cells[c.id], r)).includes(k))); }
  const sorts = (view.sorts || []).map(s => ({ ...s, c: colById(db, s.col) })).filter(s => s.c);
  if (sorts.length) rows.sort((a, b) => {
    for (const { c, dir } of sorts) {
      const x = sortKey(c, a.cells[c.id], a), y = sortKey(c, b.cells[c.id], b);
      if (x === y) continue;
      if (x == null) return 1; // les cases vides restent en bas
      if (y == null) return -1;
      const k = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true, sensitivity: 'base' });
      if (k) return dir === 'desc' ? -k : k;
    }
    return 0;
  });
  return rows;
}

// ---------- Calculs en bas de colonne ----------
const CALCS = { count: 'Nombre de fiches', filled: 'Remplies', empty: 'Vides', unique: 'Valeurs uniques', sum: 'Somme', avg: 'Moyenne', min: 'Minimum', max: 'Maximum', checked: 'Cochées', pct: '% cochées', earliest: 'Plus ancienne', latest: 'Plus récente' };
function calcChoices(c) {
  const base = ['count', 'filled', 'empty', 'unique'];
  if (c.type === 'number') return [...base, 'sum', 'avg', 'min', 'max'];
  if (c.type === 'checkbox') return ['count', 'checked', 'pct'];
  if (c.type === 'date' || c.type === 'created') return [...base, 'earliest', 'latest'];
  return base;
}
function calcValue(c, fn, rows) {
  const vals = rows.map(r => c.type === 'created' ? r.created : r.cells[c.id]);
  const nums = vals.filter(v => !isBlank(v) && !isNaN(v)).map(Number);
  switch (fn) {
    case 'count': return rows.length;
    case 'filled': return vals.filter(v => !isBlank(v)).length;
    case 'empty': return vals.filter(isBlank).length;
    case 'unique': return new Set(vals.filter(v => !isBlank(v)).map(v => JSON.stringify(v))).size;
    case 'sum': return fmtNumber(c, nums.reduce((a, b) => a + b, 0));
    case 'avg': return nums.length ? fmtNumber(c, Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 100) / 100) : '—';
    case 'min': return nums.length ? fmtNumber(c, Math.min(...nums)) : '—';
    case 'max': return nums.length ? fmtNumber(c, Math.max(...nums)) : '—';
    case 'checked': return vals.filter(Boolean).length;
    case 'pct': return rows.length ? Math.round(vals.filter(Boolean).length / rows.length * 100) + ' %' : '—';
    case 'earliest': { const d = vals.filter(Boolean).sort()[0]; return d ? fmtDate(d) : '—'; }
    case 'latest': { const d = vals.filter(Boolean).sort().at(-1); return d ? fmtDate(d) : '—'; }
  }
  return '';
}

// ---------- Fiches ----------
function newRow(db, cells = {}, tplId) {
  const tpl = db.templates?.find(t => t.id === (tplId === undefined ? db.defaultTpl : tplId));
  const r = newRowObj(db, tpl ? { ...clone(tpl.cells || {}), ...cells } : cells);
  if (tpl) { r.blocks = freshBlocks(tpl.blocks); if (tpl.icon) r.icon = tpl.icon; }
  // Valeur par défaut des statuts : la première option.
  db.columns.forEach(c => { if (c.type === 'status' && r.cells[c.id] == null && c.options?.length) r.cells[c.id] = c.options[0].id; });
  db.rows.push(r);
  return r;
}
async function deleteRow(db, r, after) {
  const has = Object.values(r.cells).some(v => !isBlank(v)) || (r.blocks || []).some(b => b.text || !TEXT.has(b.type));
  if (has && !await dialog({ title: 'Supprimer la fiche ?', text: `« ${rowTitle(db, r) || 'Sans titre'} » et son contenu seront supprimés (⌘Z pour annuler).`, ok: 'Supprimer', danger: true })) return;
  db.rows = db.rows.filter(x => x !== r);
  save(); after && after();
}
function duplicateRow(db, r) {
  const c = { ...clone(r), id: uid(), created: new Date().toISOString(), blocks: freshBlocks(r.blocks || []) };
  const tc = titleCol(db); c.cells[tc.id] = (r.cells[tc.id] || 'Sans titre') + ' (copie)';
  db.rows.splice(db.rows.indexOf(r) + 1, 0, c);
  save();
  return c;
}
function rowMenu(anchor, db, r, rerender) {
  menu(anchor, [
    { icon: '⤢', label: 'Ouvrir la fiche', action: () => openRow(r.id) },
    { icon: '⧉', label: 'Dupliquer', action: () => { duplicateRow(db, r); rerender(); } },
    '-',
    { icon: '🗑', label: 'Supprimer', danger: true, action: () => deleteRow(db, r, rerender) },
  ]);
}

// ---------- Rendu d'une base ----------
const dbSearch = {}; // recherche rapide en cours, par base
function renderDb(p, b) {
  const db = b.db;
  migrateDb(db);
  const host = page(docHost(p));
  const full = host?.isDb && host.blocks[0] === b;
  const rerender = () => { const nb = renderDb(p, b); $(`#main .db[data-b="${b.id}"]`)?.replaceWith(nb); return nb; };
  const view = curView(db);
  const body = h('div', { class: 'db-body' });
  const drawBody = () => {
    const rows = visibleRows(db, view, dbSearch[db.id] || '');
    const fn = { table: renderTable, board: renderBoard, calendar: renderCalendar, gallery: renderGallery, list: renderList, chart: renderChart, timeline: renderTimeline }[view.type] || renderTable;
    body.replaceChildren(fn(db, view, rows, rerender));
  };
  const search = h('input', { class: 'mini db-search', placeholder: '🔍 Rechercher…', value: dbSearch[db.id] || '', oninput: e => { dbSearch[db.id] = e.target.value; drawBody(); } });
  const nf = (view.filters || []).length, ns = (view.sorts || []).length;
  const box = h('div', { class: 'db' + (full ? ' db-full' : ''), 'data-b': b.id },
    full ? null : h('div', { class: 'db-titlebar' },
      h('input', { class: 'db-title', value: db.title, placeholder: 'Sans titre', 'aria-label': 'Titre de la base', oninput: e => { db.title = e.target.value; save(); } }),
      full ? null : h('button', { class: 'tool', title: 'Ouvrir en pleine page', onclick: () => openDbFullPage(p, b) }, ico('maximize-2'))),
    h('div', { class: 'db-bar' },
      h('div', { class: 'db-tabs' },
        db.views.map(v => h('button', {
          class: 'tab' + (v === view ? ' on' : ''), title: 'Cliquer de nouveau pour les options de la vue',
          onclick: e => { if (v === view) return viewMenu(e.currentTarget, db, v, rerender); db.view = v.id; save(); rerender(); },
        }, glyph(VIEWTYPES[v.type][1]), v.name)),
        h('button', { class: 'tab add', title: 'Ajouter une vue', onclick: e => addViewMenu(e.currentTarget, db, rerender) }, ico('plus'))),
      h('span', { class: 'grow' }),
      search,
      h('button', { class: 'tool' + (nf ? ' on' : ''), onclick: e => filterMenu(e.currentTarget, db, view, rerender) }, ico('filter'), nf ? `Filtres (${nf})` : 'Filtrer'),
      h('button', { class: 'tool' + (ns ? ' on' : ''), onclick: e => sortMenu(e.currentTarget, db, view, rerender) }, ico('arrow-up-down'), ns ? `Tris (${ns})` : 'Trier'),
      h('button', { class: 'tool', onclick: e => propsMenu(e.currentTarget, db, view, rerender) }, ico('sliders-horizontal'), 'Propriétés'),
      h('button', { class: 'tool', title: 'Plus d’options', onclick: e => dbMoreMenu(e.currentTarget, p, b, db, view, rerender) }, ico('ellipsis')),
      h('div', { class: 'new-split' },
        h('button', { class: 'btn primary sm', onclick: () => createFromView(db, view, rerender) }, 'Nouveau'),
        h('button', { class: 'btn primary sm caret', title: 'Choisir un modèle', onclick: e => templatesMenu(e.currentTarget, db, view, rerender) }, '▾'))),
    body);
  drawBody();
  return box;
}
function createFromView(db, view, rerender, tplId, cells = {}) {
  const r = newRow(db, cells, tplId);
  save();
  if (view.type === 'table') { const nb = rerender(); $(`.dbt tr[data-r="${r.id}"] .cell-title`, nb)?.focus(); }
  else openRow(r.id);
}
function migrateDb(db) {
  db.id ||= uid();
  db.templates ||= [];
  if (!db.columns.some(c => c.type === 'title')) { const c = db.columns.find(x => x.type === 'text') || db.columns[0]; if (c) { if (c.type !== 'text') convertCol(db, c, 'text'); c.type = 'title'; } }
  db.rows.forEach(r => { r.created ||= new Date().toISOString(); r.blocks ||= []; });
  if (!db.views?.length) {
    // Ancien format (une seule vue) → liste de vues.
    const v = newView(db.view === 'board' ? 'board' : 'table', db);
    if (db.sort) v.sorts = [{ col: db.sort.col, dir: db.sort.dir }];
    if (db.filter?.value) v.filters = [{ col: db.filter.col, op: 'contains', value: db.filter.value }];
    if (db.groupBy) v.groupBy = db.groupBy;
    db.views = [v]; db.view = v.id;
    delete db.sort; delete db.filter; delete db.groupBy;
  }
}
function openDbFullPage(p, b) {
  // Transforme le bloc en lien vers une nouvelle page qui contient la base.
  const pg = createPage(docHost(p), b.db.title || 'Base de données', { icon: b.db.icon || '🗂️', blocks: [b] });
  pg.isDb = true;
  const i = p.blocks.indexOf(b);
  p.blocks.splice(i, 1, { id: uid(), type: 'page', pageId: pg.id });
  save(); openPage(pg.id);
}

// ---------- Menus de la barre ----------
function viewMenu(anchor, db, v, rerender) {
  const name = h('input', { class: 'mini wide', value: v.name, oninput: e => { v.name = e.target.value || 'Vue'; save(); }, onkeydown: e => { if (e.key === 'Enter') closePopup(); } });
  const selCols = db.columns.filter(c => c.type === 'select' || c.type === 'status');
  const dateCols = db.columns.filter(c => c.type === 'date' || c.type === 'created');
  popup(anchor, [
    h('div', { class: 'pad' }, name),
    h('div', { class: 'mh' }, 'Disposition'),
    Object.entries(VIEWTYPES).map(([t, [l, ic]]) => h('button', { class: 'mi', onclick: () => { v.type = t; if ((t === 'calendar' || t === 'timeline') && !v.dateCol) ensureDateCol(db, v); if ((t === 'board' || t === 'chart') && !v.groupBy) ensureGroupCol(db, v); save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, ic), l, v.type === t ? h('span', { class: 'chk' }, '✓') : null)),
    v.type === 'board' && selCols.length ? [h('div', { class: 'mh' }, 'Grouper par'), selCols.map(c => h('button', { class: 'mi', onclick: () => { v.groupBy = c.id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, COLTYPES[c.type][1]), c.name, v.groupBy === c.id ? h('span', { class: 'chk' }, '✓') : null))] : null,
    v.type === 'calendar' && dateCols.length ? [h('div', { class: 'mh' }, 'Calendrier selon'), dateCols.map(c => h('button', { class: 'mi', onclick: () => { v.dateCol = c.id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, '📅'), c.name, v.dateCol === c.id ? h('span', { class: 'chk' }, '✓') : null))] : null,
    v.type === 'chart' ? [h('div', { class: 'mh' }, 'Catégories'), db.columns.filter(c => isChoice(c.type)).map(c => h('button', { class: 'mi', onclick: () => { v.groupBy = c.id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, COLTYPES[c.type][1]), c.name, v.groupBy === c.id ? h('span', { class: 'chk' }, '✓') : null)),
      h('div', { class: 'mh' }, 'Valeur'), [null, ...db.columns.filter(c => c.type === 'number')].map(c => h('button', { class: 'mi', onclick: () => { v.sumCol = c?.id || null; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, c ? 'Σ' : '#'), c ? 'Somme de « ' + c.name + ' »' : 'Nombre de fiches', (v.sumCol || null) === (c?.id || null) ? h('span', { class: 'chk' }, '✓') : null))] : null,
    v.type === 'timeline' ? [h('div', { class: 'mh' }, 'Début'), dateCols.map(c => h('button', { class: 'mi', onclick: () => { v.dateCol = c.id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, '📅'), c.name, v.dateCol === c.id ? h('span', { class: 'chk' }, '✓') : null)),
      h('div', { class: 'mh' }, 'Fin (facultatif)'), [null, ...db.columns.filter(c => c.type === 'date')].map(c => h('button', { class: 'mi', onclick: () => { v.endCol = c?.id || null; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, c ? '📅' : '—'), c ? c.name : 'Un seul jour', (v.endCol || null) === (c?.id || null) ? h('span', { class: 'chk' }, '✓') : null)),
      selCols.length ? [h('div', { class: 'mh' }, 'Couleur selon'), selCols.map(c => h('button', { class: 'mi', onclick: () => { v.groupBy = c.id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, COLTYPES[c.type][1]), c.name, v.groupBy === c.id ? h('span', { class: 'chk' }, '✓') : null))] : null] : null,
    v.type === 'gallery' ? h('button', { class: 'mi', onclick: () => { v.noCover = !v.noCover; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, '🖼'), 'Afficher l’aperçu des fiches', !v.noCover ? h('span', { class: 'chk' }, '✓') : null) : null,
    h('div', { class: 'sep' }),
    h('button', { class: 'mi', onclick: () => { const c = { ...clone(v), id: uid(), name: v.name + ' (copie)' }; db.views.splice(db.views.indexOf(v) + 1, 0, c); db.view = c.id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, '⧉'), 'Dupliquer la vue'),
    db.views.length > 1 ? h('button', { class: 'mi danger', onclick: () => { db.views = db.views.filter(x => x !== v); db.view = db.views[0].id; save(); closePopup(); rerender(); } }, h('span', { class: 'mi-ic' }, '🗑'), 'Supprimer la vue') : null,
  ], () => rerender());
  name.select();
}
function ensureDateCol(db, v) {
  let c = db.columns.find(x => x.type === 'date');
  if (!c) { c = { id: uid(), name: 'Date', type: 'date' }; db.columns.push(c); }
  v.dateCol = c.id;
}
function ensureGroupCol(db, v) {
  let c = db.columns.find(x => x.type === 'status' || x.type === 'select');
  if (!c) { c = { id: uid(), name: 'Statut', type: 'status', options: [opt('À faire', 'gray'), opt('En cours', 'blue'), opt('Terminé', 'green')] }; db.columns.push(c); }
  v.groupBy = c.id;
}
function addViewMenu(anchor, db, rerender) {
  menu(anchor, [{ header: 'Nouvelle vue' }, ...Object.entries(VIEWTYPES).map(([t, [l, ic]]) => ({
    icon: ic, label: l, action: () => {
      const v = newView(t, db);
      if ((t === 'calendar' || t === 'timeline') && !v.dateCol) ensureDateCol(db, v);
      if ((t === 'board' || t === 'chart') && !v.groupBy) ensureGroupCol(db, v);
      db.views.push(v); db.view = v.id; save(); rerender();
    },
  }))]);
}
function filterMenu(anchor, db, view, rerender) {
  view.filters ||= [];
  const box = h('div', { class: 'fbox' });
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'mh' }, 'Filtres — afficher les fiches où…'),
      view.filters.length ? null : h('div', { class: 'pad muted small' }, 'Aucun filtre. Toutes les fiches sont affichées.'),
      view.filters.map((f, i) => {
        const c = colById(db, f.col) || db.columns[0];
        const ops = OPS[opGroup(c.type)];
        if (!ops.some(o => o[0] === f.op)) f.op = ops[0][0];
        let val = null;
        if (!NOVALUE.has(f.op)) {
          if (isChoice(c.type)) val = h('select', { class: 'mini', onchange: e => { f.value = e.target.value; save(); rerender(); } }, h('option', { value: '' }, '— choisir —'), (c.options || []).map(o => h('option', { value: o.id, selected: f.value === o.id }, o.name)));
          else if (c.type === 'relation') { const t = findDb(c.relation)?.db; val = h('select', { class: 'mini', onchange: e => { f.value = e.target.value; save(); rerender(); } }, h('option', { value: '' }, '— choisir —'), (t?.rows || []).map(r => h('option', { value: r.id, selected: f.value === r.id }, rowTitle(t, r) || 'Sans titre'))); }
          else val = h('input', { class: 'mini', type: c.type === 'date' || c.type === 'created' ? 'date' : c.type === 'number' ? 'number' : 'text', value: f.value ?? '', placeholder: 'valeur…', oninput: e => { f.value = e.target.value; save(); rerenderSoft(); } });
        }
        return h('div', { class: 'frule' },
          h('span', { class: 'muted small' }, i ? 'et' : 'Où'),
          h('select', { class: 'mini', onchange: e => { f.col = e.target.value; f.value = ''; save(); draw(); rerender(); } }, db.columns.map(x => h('option', { value: x.id, selected: x.id === c.id }, x.name))),
          h('select', { class: 'mini', onchange: e => { f.op = e.target.value; save(); draw(); rerender(); } }, ops.map(([k, l]) => h('option', { value: k, selected: f.op === k }, l))),
          val,
          h('button', { class: 'x', title: 'Retirer ce filtre', onclick: () => { view.filters.splice(i, 1); save(); draw(); rerender(); } }, '✕'));
      }),
      h('button', { class: 'mi', onclick: () => { const c = db.columns[0]; view.filters.push({ col: c.id, op: OPS[opGroup(c.type)][0][0], value: '' }); save(); draw(); } }, h('span', { class: 'mi-ic' }, '+'), 'Ajouter un filtre'));
  };
  // Pendant la frappe, on ne redessine que les lignes (le menu garde le focus).
  let softT; const rerenderSoft = () => { clearTimeout(softT); softT = setTimeout(() => { const keep = popupEl; popupEl = null; rerender(); popupEl = keep; }, 250); };
  draw();
  popup(anchor, box, null, 'wide-pop');
}
function sortMenu(anchor, db, view, rerender) {
  view.sorts ||= [];
  const box = h('div', {});
  const draw = () => box.replaceChildren(
    h('div', { class: 'mh' }, 'Trier par'),
    view.sorts.length ? null : h('div', { class: 'pad muted small' }, 'Aucun tri : les fiches sont dans l’ordre de création.'),
    view.sorts.map((s, i) => h('div', { class: 'frule' },
      h('select', { class: 'mini', onchange: e => { s.col = e.target.value; save(); rerender(); } }, db.columns.map(c => h('option', { value: c.id, selected: c.id === s.col }, c.name))),
      h('select', { class: 'mini', onchange: e => { s.dir = e.target.value; save(); rerender(); } }, h('option', { value: 'asc', selected: s.dir !== 'desc' }, 'Croissant ↑'), h('option', { value: 'desc', selected: s.dir === 'desc' }, 'Décroissant ↓')),
      h('button', { class: 'x', title: 'Retirer', onclick: () => { view.sorts.splice(i, 1); save(); draw(); rerender(); } }, '✕'))),
    h('button', { class: 'mi', onclick: () => { const used = new Set(view.sorts.map(s => s.col)); const c = db.columns.find(x => !used.has(x.id)) || db.columns[0]; view.sorts.push({ col: c.id, dir: 'asc' }); save(); draw(); rerender(); } }, h('span', { class: 'mi-ic' }, '+'), 'Ajouter un tri'));
  draw();
  const keep = () => { const k = popupEl; popupEl = null; return k; };
  const orig = rerender; rerender = () => { const k = keep(); orig(); popupEl = k; };
  popup(anchor, box, null, 'wide-pop');
}
function propsMenu(anchor, db, view, rerender) {
  view.hidden ||= [];
  const box = h('div', {});
  const draw = () => box.replaceChildren(
    h('div', { class: 'mh' }, 'Propriétés de cette vue'),
    db.columns.map((c, i) => {
      const hidden = view.hidden.includes(c.id);
      return h('div', { class: 'prow' },
        h('span', { class: 'mi-ic' }, COLTYPES[c.type][1]),
        h('button', { class: 'pname', title: 'Modifier la propriété', onclick: e => colMenu(e.currentTarget, db, c, rerender, view) }, c.name),
        h('button', { class: 'x', title: 'Monter', disabled: i === 0, onclick: () => { db.columns.splice(i, 1); db.columns.splice(i - 1, 0, c); save(); draw(); rerender(); } }, '↑'),
        h('button', { class: 'x', title: 'Descendre', disabled: i === db.columns.length - 1, onclick: () => { db.columns.splice(i, 1); db.columns.splice(i + 1, 0, c); save(); draw(); rerender(); } }, '↓'),
        c.type === 'title' ? h('span', { class: 'x muted' }, '👁') : h('button', { class: 'x' + (hidden ? ' off' : ''), title: hidden ? 'Afficher' : 'Masquer', onclick: () => { view.hidden = hidden ? view.hidden.filter(x => x !== c.id) : [...view.hidden, c.id]; save(); draw(); rerender(); } }, hidden ? '◌' : '👁'));
    }),
    h('div', { class: 'sep' }),
    h('button', { class: 'mi', onclick: () => newColumnMenu(anchor, db, rerender) }, h('span', { class: 'mi-ic' }, '+'), 'Nouvelle propriété'));
  draw();
  const orig = rerender; rerender = () => { const k = popupEl; popupEl = null; orig(); popupEl = k; };
  popup(anchor, box, null, 'wide-pop');
}
function newColumnMenu(anchor, db, rerender, at) {
  const name = h('input', { class: 'mini wide', placeholder: 'Nom de la propriété' });
  const add = async t => {
    const c = { id: uid(), name: name.value.trim() || COLTYPES[t][0], type: t };
    if (isChoice(t)) c.options = t === 'status' ? [opt('À faire', 'gray'), opt('En cours', 'blue'), opt('Terminé', 'green')] : [];
    if (t === 'relation') { closePopup(); const target = await chooseDb('Relier à quelle base ?', db.id); if (!target) return; c.relation = target; }
    if (at == null) db.columns.push(c); else db.columns.splice(at, 0, c);
    closePopup(); save(); rerender();
  };
  popup(anchor, [h('div', { class: 'pad' }, name), h('div', { class: 'mh' }, 'Type'),
    Object.entries(COLTYPES).filter(([t]) => t !== 'title').map(([t, [l, ic]]) => h('button', { class: 'mi', onclick: () => add(t) }, h('span', { class: 'mi-ic' }, ic), l))], null, 'wide-pop');
  name.focus();
}
function chooseDb(title, exceptId) {
  const list = []; eachDb((db, b, host) => { if (!list.some(x => x.db.id === db.id)) list.push({ db, host }); });
  return new Promise(res => {
    let done = false, close;
    const finish = v => { if (done) return; done = true; close(); res(v); };
    close = modal(title, h('div', { class: 'results' }, list.map(({ db, host }) => h('button', { class: 'res', onclick: () => finish(db.id) },
      h('span', {}, '🗂️'), h('span', { class: 'res-main' }, h('span', { class: 'res-t' }, (db.title || 'Sans titre') + (db.id === exceptId ? ' (cette base)' : '')), h('span', { class: 'res-s' }, 'Dans ' + (host.title || 'Sans titre')))))), () => finish(null));
  });
}
function dbMoreMenu(anchor, p, b, db, view, rerender) {
  menu(anchor, [
    { icon: '⬆', label: 'Importer un fichier CSV / Excel (.csv)', action: () => importCsv(db, rerender) },
    { icon: '⬇', label: 'Exporter en CSV (Excel)', action: () => exportCsv(db, view) },
    '-',
    { icon: '🧩', label: 'Modèles de fiche…', action: () => manageTemplates(db, rerender) },
    { icon: '🗂️', label: 'Changer l’icône de la base', action: () => iconPicker(anchor, db.icon, v => { db.icon = v; save(); rerender(); }) },
    page(docHost(p))?.isDb ? null : { icon: '⤢', label: 'Ouvrir en pleine page', action: () => openDbFullPage(p, b) },
  ]);
}

// ---------- Modèles de fiche ----------
function templatesMenu(anchor, db, view, rerender) {
  menu(anchor, [
    { header: 'Nouvelle fiche' },
    { icon: '📄', label: 'Fiche vide', check: !db.defaultTpl, action: () => createFromView(db, view, rerender, null) },
    ...db.templates.map(t => ({ icon: t.icon || '🧩', label: t.name, check: db.defaultTpl === t.id, action: () => createFromView(db, view, rerender, t.id) })),
    '-',
    { icon: '⚙', label: 'Gérer les modèles…', action: () => manageTemplates(db, rerender) },
  ]);
}
function manageTemplates(db, rerender) {
  let close;
  const draw = () => h('div', {},
    h('p', { class: 'muted small' }, 'Un modèle pré-remplit une nouvelle fiche (propriétés et contenu). Pour en créer un : ouvrez une fiche, « ⋯ » puis « Enregistrer comme modèle ».'),
    h('label', { class: 'tpl' }, h('input', { type: 'radio', name: 'deftpl', checked: !db.defaultTpl, onchange: () => { db.defaultTpl = null; save(); } }), h('div', { class: 'tpl-main' }, h('b', {}, 'Fiche vide'), h('div', { class: 'muted small' }, 'par défaut si coché'))),
    db.templates.map(t => h('div', { class: 'tpl' },
      h('input', { type: 'radio', name: 'deftpl', title: 'Modèle par défaut', checked: db.defaultTpl === t.id, onchange: () => { db.defaultTpl = t.id; save(); } }),
      h('div', { class: 'tpl-ic' }, t.icon || '🧩'),
      h('div', { class: 'tpl-main' }, h('input', { class: 'mini wide', value: t.name, oninput: e => { t.name = e.target.value || 'Modèle'; save(); } }), h('div', { class: 'muted small' }, `${(t.blocks || []).length} bloc(s)`)),
      h('button', { class: 'btn danger', onclick: () => { db.templates = db.templates.filter(x => x !== t); if (db.defaultTpl === t.id) db.defaultTpl = null; save(); close(); manageTemplates(db, rerender); } }, 'Supprimer'))));
  close = modal('Modèles de fiche — ' + (db.title || 'Sans titre'), draw(), rerender);
}

// ---------- Colonnes ----------
function colMenu(anchor, db, c, rerender, view) {
  view ||= curView(db);
  const name = h('input', { class: 'mini wide', value: c.name, 'aria-label': 'Nom de la propriété', oninput: e => { c.name = e.target.value || 'Sans nom'; save(); }, onkeydown: e => { if (e.key === 'Enter') closePopup(); } });
  const act = (icon, label, fn, cls = '') => h('button', { class: 'mi ' + cls, onclick: () => { closePopup(); fn(); save(); rerender(); } }, h('span', { class: 'mi-ic' }, icon), label);
  const i = db.columns.indexOf(c);
  popup(anchor, [
    h('div', { class: 'pad' }, name),
    c.type === 'title' ? h('div', { class: 'pad muted small' }, 'Colonne principale : donne son nom à chaque fiche.') : [
      h('button', { class: 'mi', onclick: () => typeMenu(anchor, db, c, rerender) }, h('span', { class: 'mi-ic' }, COLTYPES[c.type][1]), 'Type : ' + COLTYPES[c.type][0], h('span', { class: 'mi-hint' }, '›')),
    ],
    c.type === 'number' ? h('div', { class: 'pad row' }, h('span', { class: 'muted small' }, 'Format'), h('select', { class: 'mini', onchange: e => { c.format = e.target.value; save(); rerender(); } },
      [['', 'Nombre'], ['euro', 'Euros (€)'], ['percent', 'Pourcentage (%)']].map(([k, l]) => h('option', { value: k, selected: (c.format || '') === k }, l)))) : null,
    c.type === 'relation' ? h('div', { class: 'pad muted small' }, 'Reliée à : ' + (findDb(c.relation)?.db.title || 'base introuvable')) : null,
    isChoice(c.type) ? h('button', { class: 'mi', onclick: () => editOptions(anchor, db, c, rerender) }, h('span', { class: 'mi-ic' }, '🏷'), 'Modifier les options', h('span', { class: 'mi-hint' }, '›')) : null,
    h('div', { class: 'sep' }),
    act('↑', 'Trier croissant', () => { view.sorts = [{ col: c.id, dir: 'asc' }]; }),
    act('↓', 'Trier décroissant', () => { view.sorts = [{ col: c.id, dir: 'desc' }]; }),
    act('⚲', 'Filtrer sur cette propriété', () => { view.filters ||= []; view.filters.push({ col: c.id, op: OPS[opGroup(c.type)][0][0], value: '' }); setTimeout(() => $(`#main .db .tool.on`)?.click(), 50); }),
    c.type !== 'title' ? act('◌', 'Masquer dans cette vue', () => { view.hidden = [...(view.hidden || []), c.id]; }) : null,
    i > 0 ? act('←', 'Déplacer à gauche', () => { db.columns.splice(i, 1); db.columns.splice(i - 1, 0, c); }) : null,
    i < db.columns.length - 1 ? act('→', 'Déplacer à droite', () => { db.columns.splice(i, 1); db.columns.splice(i + 1, 0, c); }) : null,
    h('button', { class: 'mi', onclick: () => newColumnMenu(anchor, db, rerender, i + 1) }, h('span', { class: 'mi-ic' }, '+'), 'Insérer une propriété à droite'),
    c.type !== 'title' ? act('⧉', 'Dupliquer la propriété', () => { const n = { ...clone(c), id: uid(), name: c.name + ' (copie)' }; db.columns.splice(i + 1, 0, n); db.rows.forEach(r => { r.cells[n.id] = clone(r.cells[c.id] ?? null); }); }) : null,
    c.type !== 'title' ? [h('div', { class: 'sep' }), h('button', {
      class: 'mi danger', onclick: async () => {
        closePopup();
        if (!await dialog({ title: 'Supprimer la propriété ?', text: `« ${c.name} » et toutes ses valeurs seront supprimées (⌘Z pour annuler).`, ok: 'Supprimer', danger: true })) return;
        db.columns = db.columns.filter(x => x !== c);
        db.rows.forEach(r => delete r.cells[c.id]);
        db.views.forEach(v => { v.sorts = (v.sorts || []).filter(s => s.col !== c.id); v.filters = (v.filters || []).filter(f => f.col !== c.id); if (v.groupBy === c.id) v.groupBy = null; if (v.dateCol === c.id) v.dateCol = null; });
        save(); rerender();
      },
    }, h('span', { class: 'mi-ic' }, '🗑'), 'Supprimer la propriété')] : null,
  ], null, 'wide-pop');
  name.select();
}
function typeMenu(anchor, db, c, rerender) {
  menu(anchor, [{ header: 'Changer le type' }, ...Object.entries(COLTYPES).filter(([t]) => t !== 'title').map(([t, [l, ic]]) => ({
    icon: ic, label: l, check: c.type === t, action: async () => {
      if (t === 'relation') { const target = await chooseDb('Relier à quelle base ?', db.id); if (!target) return; c.relation = target; c.type = 'relation'; db.rows.forEach(r => { r.cells[c.id] = []; }); }
      else convertCol(db, c, t);
      save(); rerender();
    },
  }))]);
}
function ensureOpt(c, name) {
  c.options ||= [];
  return c.options.find(o => fold(o.name) === fold(name)) || (c.options.push(opt(name, COLORS[c.options.length % COLORS.length])), c.options.at(-1));
}
// Changement de type d'une colonne : on convertit les valeurs existantes au mieux.
function convertCol(db, c, type) {
  if (c.type === type) return;
  const old = { ...c, options: c.options || [] };
  if (isChoice(type)) c.options = isChoice(old.type) ? old.options : [];
  for (const r of db.rows) {
    const v = old.type === 'created' ? r.created : r.cells[c.id];
    if (v == null || v === '') continue;
    let nv = null;
    if (isChoice(type)) {
      const names = isChoice(old.type) ? [].concat(v).map(id => optOf(old, id)?.name) : type === 'multi' ? cellText(old, v, r).split(',') : [cellText(old, v, r)];
      const ids = names.filter(Boolean).map(n => n.trim()).filter(Boolean).map(n => ensureOpt(c, n).id);
      nv = type === 'multi' ? ids : ids[0] ?? null;
    } else {
      const s = old.type === 'date' ? v : cellText(old, v, r), num = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
      nv = type === 'number' ? (isNaN(num) ? null : num)
        : type === 'checkbox' ? /^(oui|vrai|true|1|x|✓)$/i.test(String(s).trim())
        : type === 'date' ? parseDate(s)
        : s;
    }
    r.cells[c.id] = nv;
  }
  c.type = type;
}
function parseDate(s) {
  s = String(s || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  return null;
}
function editOptions(anchor, db, c, rerender) {
  const box = h('div', {});
  const draw = () => box.replaceChildren(h('div', { class: 'mh' }, 'Options de « ' + c.name + ' »'),
    (c.options || []).map((o, i) => h('div', { class: 'prow' },
      h('button', { class: 'sw bg-' + o.color, title: 'Changer la couleur', onclick: () => { o.color = COLORS[(COLORS.indexOf(o.color) + 1) % COLORS.length]; save(); draw(); rerender(); } }, ' '),
      h('input', { class: 'mini grow', value: o.name, oninput: e => { o.name = e.target.value || 'Sans nom'; save(); }, onchange: () => rerender() }),
      h('button', { class: 'x', title: 'Monter', disabled: !i, onclick: () => { c.options.splice(i, 1); c.options.splice(i - 1, 0, o); save(); draw(); rerender(); } }, '↑'),
      h('button', { class: 'x', title: 'Supprimer l’option', onclick: () => { c.options.splice(i, 1); db.rows.forEach(r => { const v = r.cells[c.id]; if (v === o.id) r.cells[c.id] = null; else if (Array.isArray(v)) r.cells[c.id] = v.filter(x => x !== o.id); }); save(); draw(); rerender(); } }, '✕'))),
    h('button', { class: 'mi', onclick: () => { ensureOpt(c, 'Option ' + ((c.options || []).length + 1)); save(); draw(); rerender(); } }, h('span', { class: 'mi-ic' }, '+'), 'Ajouter une option'));
  draw();
  const orig = rerender; rerender = () => { const k = popupEl; popupEl = null; orig(); popupEl = k; };
  popup(anchor, box, null, 'wide-pop');
}

// ---------- Éditeurs de cellule ----------
function cellEditor(db, c, r, onChange, opts = {}) {
  const v = r.cells[c.id];
  const set = nv => { r.cells[c.id] = nv; save(); };
  const label = c.name;
  switch (c.type) {
    case 'title': {
      const ed = h('div', { class: 'cell cell-title', contenteditable: 'plaintext-only', 'data-ph': opts.big ? 'Sans titre' : '', text: v ?? '', 'aria-label': label });
      ed.oninput = () => { set(ed.textContent.replace(/\n/g, ' ')); opts.onTitle && opts.onTitle(); };
      ed.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ed.blur(); opts.onEnter && opts.onEnter(); } };
      ed.onblur = onChange;
      return ed;
    }
    case 'text': case 'person': {
      const ed = h('div', { class: 'cell cell-text', contenteditable: 'plaintext-only', text: v ?? '', 'aria-label': label, 'data-ph': opts.big ? 'Vide' : '' });
      ed.oninput = () => set(ed.textContent);
      ed.onblur = onChange;
      return ed;
    }
    case 'number':
      return h('input', { class: 'cell num', type: 'text', inputMode: 'decimal', value: v == null ? '' : opts.big ? v : fmtNumberEdit(v), placeholder: opts.big ? 'Vide' : '', 'aria-label': label,
        onfocus: e => { e.target.value = v ?? ''; },
        oninput: e => { const t = e.target.value.replace(/\s/g, '').replace(',', '.'); set(t === '' || isNaN(t) ? (t === '' ? null : r.cells[c.id]) : Number(t)); },
        onblur: e => { e.target.value = fmtNumber(c, r.cells[c.id]); onChange(); } , onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
    case 'date':
      return h('input', { class: 'cell', type: 'date', value: v || '', 'aria-label': label, onchange: e => { set(e.target.value || null); onChange(); } });
    case 'checkbox':
      return h('input', { class: 'cell', type: 'checkbox', checked: !!v, 'aria-label': label, onchange: e => { set(e.target.checked); onChange(); } });
    case 'created':
      return h('div', { class: 'cell muted' }, fmtDateTime(r.created));
    case 'url': case 'email': case 'phone': {
      const a = h('a', { target: '_blank', rel: 'noopener', title: 'Ouvrir' }, '↗');
      const paint = val => { a.style.visibility = val ? 'visible' : 'hidden'; a.href = c.type === 'email' ? 'mailto:' + val : c.type === 'phone' ? 'tel:' + val : /^(https?:|mailto:)/i.test(val) ? val : 'https://' + val; };
      paint(v || '');
      return h('div', { class: 'cell-url' }, h('input', { class: 'cell', type: c.type === 'email' ? 'email' : 'text', placeholder: opts.big ? 'Vide' : '', value: v || '', 'aria-label': label, oninput: e => { set(e.target.value); paint(e.target.value); }, onchange: onChange }), a);
    }
    case 'select': case 'status': case 'multi': case 'relation': {
      const box = h('div', { class: 'cell pills', tabindex: 0, role: 'button', 'aria-label': label });
      const paint = () => {
        const val = [].concat(r.cells[c.id] ?? []);
        if (c.type === 'relation') { const t = findDb(c.relation)?.db; box.replaceChildren(...(t ? val.map(id => t.rows.find(x => x.id === id)).filter(Boolean).map(x => h('span', { class: 'rel-pill', title: 'Ouvrir', onclick: e => { e.stopPropagation(); openRow(x.id); } }, (x.icon || '📄') + ' ' + (rowTitle(t, x) || 'Sans titre'))) : [])); }
        else box.replaceChildren(...val.map(id => optOf(c, id)).filter(Boolean).map(pill));
        if (opts.big && !box.childNodes.length) box.append(h('span', { class: 'muted' }, 'Vide'));
      };
      paint();
      box.onclick = () => (c.type === 'relation' ? relationPicker : optionPicker)(box, db, c, r, () => { paint(); onChange(); });
      box.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); box.onclick(); } };
      return box;
    }
  }
  return h('div', { class: 'cell' }, String(v ?? ''));
}
const fmtNumberEdit = v => String(v).replace('.', ',');

function optionPicker(anchor, db, c, r, onChange) {
  const multi = c.type === 'multi';
  c.options ||= [];
  const cur = () => [].concat(r.cells[c.id] ?? []);
  const inp = h('input', { class: 'mini wide', placeholder: 'Chercher ou créer une option…' });
  const list = h('div');
  const pick = o => {
    const s = cur();
    r.cells[c.id] = multi ? (s.includes(o.id) ? s.filter(x => x !== o.id) : [...s, o.id]) : (s[0] === o.id && c.type !== 'status' ? null : o.id);
    save(); onChange();
    if (multi) { inp.value = ''; draw(); inp.focus(); } else closePopup();
  };
  const create = () => { const name = inp.value.trim(); if (name) pick(ensureOpt(c, name)); };
  const draw = () => {
    const q = fold(inp.value.trim());
    const opts = c.options.filter(o => fold(o.name).includes(q));
    list.replaceChildren(...[
      ...opts.map(o => h('div', { class: 'opt' },
        h('button', { class: 'mi', onclick: () => pick(o) }, pill(o), cur().includes(o.id) ? h('span', { class: 'chk' }, '✓') : null))),
      q && !c.options.some(o => fold(o.name) === q) ? h('button', { class: 'mi', onclick: create }, 'Créer', pill({ name: inp.value.trim(), color: COLORS[c.options.length % COLORS.length] })) : null,
      !c.options.length && !q ? h('div', { class: 'pad muted small' }, 'Tapez un nom puis Entrée pour créer une option.') : null,
      h('div', { class: 'sep' }),
      h('button', { class: 'mi', onclick: () => editOptions(anchor, db, c, onChange) }, h('span', { class: 'mi-ic' }, '🏷'), 'Modifier les options…')].filter(Boolean));
  };
  inp.oninput = draw;
  inp.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = fold(inp.value.trim());
    if (!q) return closePopup();
    const m = c.options.find(o => fold(o.name) === q) || c.options.find(o => fold(o.name).includes(q));
    m ? pick(m) : create();
  };
  popup(anchor, [h('div', { class: 'pad' }, inp), list]);
  draw();
  inp.focus();
}
function relationPicker(anchor, db, c, r, onChange) {
  const t = findDb(c.relation)?.db;
  if (!t) return toast('La base reliée est introuvable.');
  const cur = () => [].concat(r.cells[c.id] ?? []);
  const inp = h('input', { class: 'mini wide', placeholder: 'Chercher une fiche dans « ' + (t.title || 'Sans titre') + ' »…' });
  const list = h('div');
  const toggle = x => { const s = cur(); r.cells[c.id] = s.includes(x.id) ? s.filter(i => i !== x.id) : [...s, x.id]; save(); onChange(); draw(); };
  const draw = () => {
    const q = fold(inp.value.trim());
    const rows = t.rows.filter(x => fold(rowTitle(t, x)).includes(q)).slice(0, 50);
    list.replaceChildren(...rows.map(x => h('button', { class: 'mi', onclick: () => toggle(x) }, h('span', { class: 'mi-ic' }, x.icon || '📄'), rowTitle(t, x) || 'Sans titre', cur().includes(x.id) ? h('span', { class: 'chk' }, '✓') : null)),
      q && !rows.some(x => fold(rowTitle(t, x)) === q) ? h('button', { class: 'mi', onclick: () => { const nr = newRow(t, { [titleCol(t).id]: inp.value.trim() }); toggle(nr); inp.value = ''; draw(); } }, h('span', { class: 'mi-ic' }, '+'), `Créer « ${inp.value.trim()} »`) : null);
  };
  inp.oninput = draw;
  popup(anchor, [h('div', { class: 'pad' }, inp), list]);
  draw(); inp.focus();
}

// ---------- Vue Tableau ----------
function renderTable(db, view, rows, rerender) {
  const cols = db.columns.filter(c => c.type === 'title' || !(view.hidden || []).includes(c.id));
  cols.sort((a, b) => (a.type === 'title' ? -1 : 0) - (b.type === 'title' ? -1 : 0));
  view.widths ||= {}; view.calc ||= {};
  const affects = c => (view.sorts || []).some(s => s.col === c.id) || (view.filters || []).some(f => f.col === c.id);
  const th = c => {
    const cell = h('th', { style: `width:${view.widths[c.id] || (c.type === 'title' ? 260 : 170)}px`, title: 'Cliquer pour renommer, changer le type, trier…', onclick: e => { if (!e.target.classList.contains('grip')) colMenu(e.currentTarget, db, c, rerender, view); } },
      h('span', { class: 'ct' }, COLTYPES[c.type][1]), c.name,
      (view.sorts || []).find(s => s.col === c.id) ? ((view.sorts.find(s => s.col === c.id).dir === 'desc') ? ' ↓' : ' ↑') : '',
      h('span', { class: 'grip', title: 'Glisser pour élargir', onmousedown: e => {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = cell.offsetWidth;
        const move = ev => { const w = Math.max(70, w0 + ev.clientX - x0); cell.style.width = w + 'px'; view.widths[c.id] = w; };
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); save(); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
      } }));
    return cell;
  };
  const tr = r => h('tr', { 'data-r': r.id }, cols.map(c => h('td', { class: c.type === 'title' ? 'td-title' : '' },
    c.type === 'title' ? h('div', { class: 'title-cell' },
      r.icon ? h('span', { class: 'r-ic' }, r.icon) : null,
      cellEditor(db, c, r, () => affects(c) && rerender(), { onEnter: () => { const nr = newRow(db); save(); const nb = rerender(); $(`tr[data-r="${nr.id}"] .cell-title`, nb)?.focus(); } }),
      h('button', { class: 'open-btn', title: 'Ouvrir la fiche', onclick: () => openRow(r.id) }, '⤢ OUVRIR'))
      : cellEditor(db, c, r, () => affects(c) && rerender()))),
  h('td', { class: 'td-act' }, h('button', { class: 'rowbtn', title: 'Options de la fiche', onclick: e => rowMenu(e.currentTarget, db, r, rerender) }, ico('ellipsis'))));
  const foot = h('tr', { class: 'calc-row' }, cols.map(c => {
    const fn = view.calc[c.id];
    return h('td', { title: 'Calcul', onclick: e => menu(e.currentTarget, [{ header: 'Calculer' }, { icon: '∅', label: 'Aucun', check: !fn, action: () => { delete view.calc[c.id]; save(); rerender(); } },
      ...calcChoices(c).map(k => ({ icon: '∑', label: CALCS[k], check: fn === k, action: () => { view.calc[c.id] = k; save(); rerender(); } }))]) },
    fn ? [h('span', { class: 'muted small' }, CALCS[fn] + ' '), h('b', {}, String(calcValue(c, fn, rows)))] : h('span', { class: 'calc-ph' }, 'Calculer ▾'));
  }), h('td'));
  const total = cols.reduce((a, c) => a + (view.widths[c.id] || (c.type === 'title' ? 260 : 170)), 0) + 80;
  return h('div', {},
    h('div', { class: 'tablewrap' }, h('table', { class: 'dbt', style: `width:${total}px` },
      h('thead', {}, h('tr', {}, cols.map(th), h('th', { class: 'th-add', title: 'Ajouter une propriété', onclick: e => newColumnMenu(e.currentTarget, db, rerender) }, ico('plus')))),
      h('tbody', {}, rows.map(tr)),
      h('tfoot', {}, foot))),
    h('button', { class: 'badd', onclick: () => createFromView(db, view, rerender) }, '+ Nouvelle fiche'),
    footNote(db, rows));
}
const footNote = (db, rows) => h('div', { class: 'muted small pad' }, `${rows.length} fiche${rows.length > 1 ? 's' : ''}` + (rows.length < db.rows.length ? ` affichée${rows.length > 1 ? 's' : ''} sur ${db.rows.length} (filtres ou recherche)` : ''));

// Propriétés affichées sur les cartes (Kanban, galerie, liste, calendrier).
function cardProps(db, view, r, except = []) {
  return db.columns.filter(c => c.type !== 'title' && !except.includes(c.id) && !(view.hidden || []).includes(c.id) && (c.type === 'created' || !isBlank(r.cells[c.id]))).map(c => {
    const v = r.cells[c.id];
    if (c.type === 'select' || c.type === 'status' || c.type === 'multi') return h('div', { class: 'card-p' }, [].concat(v).map(id => optOf(c, id)).filter(Boolean).map(pill));
    if (c.type === 'checkbox') return h('div', { class: 'card-p' }, '☑ ' + c.name);
    return h('div', { class: 'card-p', title: c.name }, h('span', { class: 'cp-ic' }, COLTYPES[c.type][1]), cellText(c, v, r));
  });
}
const rowCardTitle = (db, r) => h('div', { class: 'card-t' }, r.icon ? r.icon + ' ' : '', rowTitle(db, r) || 'Sans titre');

// ---------- Vue Kanban ----------
let cardDrag = null;
function renderBoard(db, view, rows, rerender) {
  let g = colById(db, view.groupBy);
  if (!g || !(g.type === 'select' || g.type === 'status')) g = db.columns.find(c => c.type === 'status' || c.type === 'select');
  if (!g) return h('div', { class: 'db-empty' }, 'Le Kanban range les fiches en colonnes selon une propriété « Statut » ou « Sélection ». ',
    h('button', { class: 'btn', onclick: () => { ensureGroupCol(db, view); save(); rerender(); } }, 'Ajouter une propriété « Statut »'));
  view.groupBy = g.id;
  const groups = [{ id: null, name: 'Sans ' + g.name.toLowerCase(), color: 'none' }, ...(g.options || [])];
  return h('div', {}, h('div', { class: 'board' }, groups.map(o => {
    const items = rows.filter(r => o.id === null ? !(g.options || []).some(x => x.id === r.cells[g.id]) : r.cells[g.id] === o.id);
    if (o.id === null && !items.length) return null;
    const col = h('div', {
      class: 'bcol bc-' + (o.color || 'none'),
      ondragover: e => { if (!cardDrag) return; e.preventDefault(); col.classList.add('over'); },
      ondragleave: e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); },
      ondrop: e => { if (!cardDrag) return; e.preventDefault(); e.stopPropagation(); const r = db.rows.find(x => x.id === cardDrag); cardDrag = null; if (r) { r.cells[g.id] = o.id; save(); rerender(); } },
    },
      h('div', { class: 'bhead' }, h('span', { class: `pill dot c-${o.color || 'gray'}` }, o.name), h('span', { class: 'muted' }, items.length)),
      items.map(r => h('div', {
        class: 'card', draggable: true, title: 'Cliquer pour ouvrir · glisser vers une autre colonne',
        ondragstart: e => { cardDrag = r.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); },
        ondragend: () => { cardDrag = null; },
        onclick: () => openRow(r.id),
      }, rowCardTitle(db, r), cardProps(db, view, r, [g.id]))),
      h('button', { class: 'badd', onclick: () => createFromView(db, view, rerender, undefined, o.id ? { [g.id]: o.id } : {}) }, '+ Nouveau'));
    return col;
  }), h('button', { class: 'bcol add', title: 'Ajouter un groupe', onclick: async () => { const n = await dialog({ title: 'Nouveau groupe', text: 'Nom de la nouvelle colonne :', input: '', ok: 'Ajouter' }); if (n) { ensureOpt(g, n); save(); rerender(); } } }, '+ Groupe')), footNote(db, rows));
}

// ---------- Vue Calendrier ----------
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function renderCalendar(db, view, rows, rerender) {
  let dc = colById(db, view.dateCol);
  if (!dc || !(dc.type === 'date' || dc.type === 'created')) dc = db.columns.find(c => c.type === 'date');
  if (!dc) return h('div', { class: 'db-empty' }, 'Le calendrier place les fiches selon une propriété « Date ». ', h('button', { class: 'btn', onclick: () => { ensureDateCol(db, view); save(); rerender(); } }, 'Ajouter une propriété « Date »'));
  view.dateCol = dc.id;
  const dateOf = r => dc.type === 'created' ? r.created?.slice(0, 10) : (r.cells[dc.id] || '').slice(0, 10);
  view.month ||= today().slice(0, 7);
  const [Y, M] = view.month.split('-').map(Number);
  const first = new Date(Y, M - 1, 1), start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const go = d => { const n = new Date(Y, M - 1 + d, 1); view.month = isoDay(n).slice(0, 7); save(); rerender(); };
  const byDay = {};
  rows.forEach(r => { const d = dateOf(r); if (d) (byDay[d] ||= []).push(r); });
  const noDate = rows.filter(r => !dateOf(r));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = isoDay(d), other = d.getMonth() !== M - 1;
    if (i === 35 && other) break;
    const cell = h('div', {
      class: 'cal-day' + (other ? ' other' : '') + (key === today() ? ' today' : '') + ([5, 6].includes((d.getDay() + 6) % 7) ? ' we' : ''),
      ondragover: e => { if (cardDrag && dc.type === 'date') { e.preventDefault(); cell.classList.add('over'); } },
      ondragleave: () => cell.classList.remove('over'),
      ondrop: e => { if (!cardDrag) return; e.preventDefault(); const r = db.rows.find(x => x.id === cardDrag); cardDrag = null; if (r) { r.cells[dc.id] = key; save(); rerender(); } },
    },
      h('div', { class: 'cal-num' }, h('span', { class: 'cal-n' }, d.getDate() === 1 ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 4)}.` : d.getDate()),
        dc.type === 'date' ? h('button', { class: 'cal-add', title: 'Nouvelle fiche ce jour-là', onclick: () => createFromView(db, { type: 'calendar' }, rerender, undefined, { [dc.id]: key }) }, '+') : null),
      (byDay[key] || []).map(r => h('div', {
        class: 'cal-item', draggable: true, title: rowTitle(db, r),
        ondragstart: e => { cardDrag = r.id; e.dataTransfer.setData('text/plain', ''); }, ondragend: () => { cardDrag = null; },
        onclick: () => openRow(r.id),
      }, (r.icon || '') + ' ' + (rowTitle(db, r) || 'Sans titre'))));
    cells.push(cell);
  }
  return h('div', { class: 'cal' },
    h('div', { class: 'cal-head' },
      h('b', { class: 'cal-title' }, MONTHS[M - 1] + ' ' + Y),
      h('span', { class: 'grow' }),
      noDate.length ? h('button', { class: 'tool', onclick: e => menu(e.currentTarget, [{ header: 'Fiches sans date' }, ...noDate.slice(0, 30).map(r => ({ icon: r.icon || '📄', label: rowTitle(db, r) || 'Sans titre', action: () => openRow(r.id) }))]) }, `${noDate.length} sans date`) : null,
      h('button', { class: 'tool', onclick: () => go(-1), title: 'Mois précédent' }, '‹'),
      h('button', { class: 'tool', onclick: () => { view.month = today().slice(0, 7); save(); rerender(); } }, 'Aujourd’hui'),
      h('button', { class: 'tool', onclick: () => go(1), title: 'Mois suivant' }, '›')),
    h('div', { class: 'cal-grid' }, ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(d => h('div', { class: 'cal-wd' }, d)), cells));
}

// ---------- Vue Galerie ----------
function rowCover(r) { return r.cover?.url || (r.blocks || []).find(b => b.type === 'image' && b.url)?.url || null; }
function renderGallery(db, view, rows, rerender) {
  return h('div', {}, h('div', { class: 'gallery' }, rows.map(r => {
    const img = !view.noCover && rowCover(r);
    const preview = !view.noCover && !img ? (r.blocks || []).filter(b => b.text).slice(0, 4).map(b => b.text).join('\n') : '';
    return h('div', { class: 'gcard', onclick: () => openRow(r.id) },
      view.noCover ? null : h('div', { class: 'gcover' }, img ? h('img', { src: img, alt: '' }) : preview ? h('div', { class: 'gprev' }, preview) : h('div', { class: 'gicon' }, r.icon || '📄')),
      h('div', { class: 'gbody' }, rowCardTitle(db, r), cardProps(db, view, r)));
  }), h('button', { class: 'gcard add', onclick: () => createFromView(db, view, rerender) }, '+ Nouvelle fiche')), footNote(db, rows));
}

// ---------- Vue Liste ----------
function renderList(db, view, rows, rerender) {
  return h('div', {}, h('div', { class: 'dblist' }, rows.map(r => h('div', { class: 'li', onclick: () => openRow(r.id) },
    h('span', { class: 'li-ic' }, r.icon || '📄'), h('span', { class: 'li-t' }, rowTitle(db, r) || 'Sans titre'),
    h('span', { class: 'li-props' }, cardProps(db, view, r))))),
  h('button', { class: 'badd', onclick: () => createFromView(db, view, rerender) }, '+ Nouvelle fiche'), footNote(db, rows));
}

// ---------- Vue Graphique : barres par catégorie (nombre de fiches ou somme d'un nombre) ----------
function renderChart(db, view, rows) {
  let g = colById(db, view.groupBy);
  if (!g || !isChoice(g.type)) g = db.columns.find(c => isChoice(c.type));
  if (!g) return h('div', { class: 'db-empty' }, 'Le graphique compte les fiches selon une propriété « Statut » ou « Sélection ». Ajoutez-en une.');
  view.groupBy = g.id;
  const num = colById(db, view.sumCol);
  const val = r => num ? Number(r.cells[num.id]) || 0 : 1;
  const bars = [...(g.options || []), { id: null, name: 'Vide', color: 'none' }].map(o => {
    const items = rows.filter(r => { const v = r.cells[g.id]; return o.id === null ? isBlank(v) || ![].concat(v).some(id => optOf(g, id)) : [].concat(v ?? []).includes(o.id); });
    return { o, n: items.reduce((s, r) => s + val(r), 0), count: items.length };
  }).filter(b => b.o.id !== null || b.count);
  const max = Math.max(1, ...bars.map(b => Math.abs(b.n)));
  const total = bars.reduce((s, b) => s + b.n, 0);
  const fmt = n => num ? fmtNumber(num, n) : String(n);
  return h('div', { class: 'chart' },
    h('div', { class: 'chart-head' }, h('span', { class: 'muted small' }, num ? `Somme de « ${num.name} » par « ${g.name} »` : `Nombre de fiches par « ${g.name} »`),
      h('span', { class: 'chart-total' }, 'Total : ', h('b', {}, fmt(total)))),
    bars.map(b => h('div', { class: 'chart-row' },
      h('div', { class: 'chart-l' }, h('span', { class: `pill c-${b.o.color || 'gray'}` }, b.o.name)),
      h('div', { class: 'chart-track' }, h('div', { class: `chart-bar c-${b.o.color || 'gray'}`, style: `width:${Math.max(1.5, Math.abs(b.n) / max * 100)}%` })),
      h('div', { class: 'chart-v' }, fmt(b.n), total && !num ? h('span', { class: 'muted' }, ` · ${Math.round(b.n / total * 100)} %`) : null))),
    footNote(db, rows));
}

// ---------- Vue Chronologie : une barre par fiche entre sa date de début et sa date de fin ----------
function renderTimeline(db, view, rows, rerender) {
  let dc = colById(db, view.dateCol);
  if (!dc || !(dc.type === 'date' || dc.type === 'created')) dc = db.columns.find(c => c.type === 'date');
  if (!dc) return h('div', { class: 'db-empty' }, 'La chronologie place les fiches selon une propriété « Date ». ', h('button', { class: 'btn', onclick: () => { ensureDateCol(db, view); save(); rerender(); } }, 'Ajouter une propriété « Date »'));
  view.dateCol = dc.id;
  const ec = colById(db, view.endCol);
  const g = colById(db, view.groupBy);
  const day = s => s ? new Date(String(s).slice(0, 10) + 'T00:00') : null;
  const items = rows.map(r => {
    const a = day(dc.type === 'created' ? r.created : r.cells[dc.id]);
    let b = ec ? day(r.cells[ec.id]) : null;
    if (a && (!b || b < a)) b = a;
    return { r, a, b };
  });
  const dated = items.filter(x => x.a);
  const DAY = 864e5, W = 34;
  const t0 = new Date(today() + 'T00:00');
  view.tlStart ||= isoDay(new Date(Math.min(t0 - 7 * DAY, ...dated.map(x => +x.a - 3 * DAY))));
  const start = new Date(view.tlStart + 'T00:00');
  const n = Math.max(42, Math.min(180, Math.ceil((Math.max(+t0, ...dated.map(x => +x.b)) - start) / DAY) + 10));
  const shift = d => { const s = new Date(start); s.setDate(s.getDate() + d); view.tlStart = isoDay(s); save(); rerender(); };
  const days = Array.from({ length: n }, (_, i) => new Date(+start + i * DAY));
  const colorOf = r => { const o = g && isChoice(g.type) && optOf(g, [].concat(r.cells[g.id] ?? [])[0]); return o ? o.color : 'blue'; };
  return h('div', { class: 'tl' },
    h('div', { class: 'cal-head' },
      h('b', { class: 'cal-title' }, MONTHS[start.getMonth()] + ' ' + start.getFullYear()), h('span', { class: 'grow' }),
      dated.length < items.length ? h('span', { class: 'muted small' }, `${items.length - dated.length} sans date`) : null,
      h('button', { class: 'tool', onclick: () => shift(-14), title: 'Reculer de 2 semaines' }, '‹'),
      h('button', { class: 'tool', onclick: () => { view.tlStart = isoDay(new Date(+t0 - 7 * DAY)); save(); rerender(); } }, 'Aujourd’hui'),
      h('button', { class: 'tool', onclick: () => shift(14), title: 'Avancer de 2 semaines' }, '›')),
    h('div', { class: 'tl-scroll' }, h('div', { class: 'tl-grid', style: `width:${220 + n * W}px` },
      h('div', { class: 'tl-row tl-days' }, h('div', { class: 'tl-name' }),
        days.map(d => h('div', { class: 'tl-day' + ([0, 6].includes(d.getDay()) ? ' we' : '') + (isoDay(d) === today() ? ' today' : ''), style: `width:${W}px` },
          d.getDate() === 1 || +d === +start ? h('span', { class: 'tl-m' }, MONTHS[d.getMonth()].slice(0, 4) + '.') : null, d.getDate()))),
      dated.map(({ r, a, b }) => {
        const x = Math.round((a - start) / DAY), w = Math.round((b - a) / DAY) + 1;
        return h('div', { class: 'tl-row' },
          h('button', { class: 'tl-name', onclick: () => openRow(r.id), title: rowTitle(db, r) }, (r.icon ? r.icon + ' ' : '') + (rowTitle(db, r) || 'Sans titre')),
          h('div', { class: 'tl-lane', style: `width:${n * W}px` },
            x + w > 0 && x < n ? h('button', { class: `tl-bar c-${colorOf(r)}`, style: `left:${Math.max(0, x) * W + 2}px;width:${Math.max(1, Math.min(w, n - Math.max(0, x), w + x)) * W - 4}px`, onclick: () => openRow(r.id) },
              rowTitle(db, r) || 'Sans titre') : null));
      }))),
    h('button', { class: 'badd', onclick: () => createFromView(db, view, rerender, undefined, dc.type === 'date' ? { [dc.id]: today() } : {}) }, '+ Nouvelle fiche'), footNote(db, rows));
}

// ---------- CSV (Excel) ----------
function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : (text.split('\n')[0].includes('\t') ? '\t' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
async function importCsv(db, rerender) {
  const f = await pickFile('.csv,.tsv,.txt,text/csv');
  if (!f) return;
  const data = parseCsv((await f.text()).replace(/^﻿/, ''));
  if (data.length < 2) return toast('Le fichier semble vide.');
  const [head, ...lines] = data;
  const map = head.map((name, j) => {
    name = name.trim() || 'Colonne ' + (j + 1);
    let c = db.columns.find(x => fold(x.name) === fold(name));
    if (!c) {
      const vals = lines.map(l => (l[j] || '').trim()).filter(Boolean);
      const type = vals.length && vals.every(v => !isNaN(v.replace(/\s/g, '').replace(',', '.'))) ? 'number' : vals.length && vals.every(v => parseDate(v)) ? 'date' : 'text';
      c = { id: uid(), name, type };
      db.columns.push(c);
    }
    return c;
  });
  // Si aucune colonne n'a été reconnue comme titre, la première colonne du fichier remplit le titre.
  if (!map.some(c => c.type === 'title')) map[0] = titleCol(db);
  for (const l of lines) {
    const cells = {};
    map.forEach((c, j) => {
      const s = (l[j] || '').trim();
      if (!s) return;
      if (c.type === 'number') { const n = parseFloat(s.replace(/\s/g, '').replace(',', '.')); if (!isNaN(n)) cells[c.id] = n; }
      else if (c.type === 'date') cells[c.id] = parseDate(s);
      else if (c.type === 'checkbox') cells[c.id] = /^(oui|vrai|true|1|x|✓)$/i.test(s);
      else if (isChoice(c.type)) { const ids = (c.type === 'multi' ? s.split(/[,;]/) : [s]).map(x => x.trim()).filter(Boolean).map(x => ensureOpt(c, x).id); cells[c.id] = c.type === 'multi' ? ids : ids[0]; }
      else cells[c.id] = s;
    });
    db.rows.push(newRowObj(db, cells));
  }
  save(); rerender();
  toast(`${lines.length} fiche(s) importée(s)`);
}
function exportCsv(db, view) {
  const rows = visibleRows(db, view);
  const q = s => /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const lines = [db.columns.map(c => q(c.name)).join(';'), ...rows.map(r => db.columns.map(c => q(c.type === 'date' ? (r.cells[c.id] || '') : c.type === 'number' ? fmtNumberEdit(r.cells[c.id] ?? '') : cellText(c, r.cells[c.id], r))).join(';'))];
  // Le BOM et le point-virgule font qu'Excel (version française) ouvre le fichier correctement.
  download((db.title || 'base') + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
}
function dbToMd(db) {
  const cols = db.columns;
  return [`**${db.title || 'Base de données'}**`, '', '| ' + cols.map(c => c.name).join(' | ') + ' |', '|' + cols.map(() => ' --- |').join(''),
    ...db.rows.map(r => '| ' + cols.map(c => cellText(c, r.cells[c.id], r).replace(/\|/g, '\\|')).join(' | ') + ' |')].join('\n');
}
