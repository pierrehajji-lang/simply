'use strict';
/* Simply — l'application : navigation, barre latérale, pages, fiches, modèles, recherche, corbeille, réglages, import. */

// ---------- Pages ----------
const page = id => S.pages.find(p => p.id === id);
const livePages = () => S.pages.filter(p => !p.trashed);
function createPage(parentId, title = '', { icon = '📄', blocks } = {}) {
  const pg = { id: uid(), parentId: parentId || null, title, icon, blocks: blocks || [newBlock()], open: false, created: new Date().toISOString() };
  S.pages.push(pg);
  if (parentId && page(parentId)) page(parentId).open = true;
  return pg;
}
// Copie de blocs avec de nouveaux identifiants (les liens vers sous-pages ne sont pas copiés).
function freshBlocks(blocks) {
  return clone(blocks || []).filter(b => b.type !== 'page').map(b => {
    b.id = uid();
    if (b.db) { b.db = refreshDbIds(b.db); b.db.rows.forEach(r => { r.blocks = freshBlocks(r.blocks); r.created = new Date().toISOString(); }); }
    if (b.diagram) { const map = {}; b.diagram.nodes.forEach(n => { map[n.id] = uid(); n.id = map[n.id]; }); b.diagram.edges.forEach(e => { e.id = uid(); e.from = map[e.from]; e.to = map[e.to]; }); }
    return b;
  });
}
// Page « hôte » d'un document : la page elle-même, ou la page qui contient la base d'une fiche.
function docHost(p) { return S.pages.includes(p) ? p.id : findRow(p.id)?.host.id || null; }
function currentDoc() { return nav.row ? findRow(nav.row)?.row : page(nav.page); }
function descendants(id) { const ids = [id]; for (let i = 0; i < ids.length; i++) S.pages.forEach(x => { if (x.parentId === ids[i]) ids.push(x.id); }); return ids; }
function pathOf(pg) {
  const parts = [];
  for (let a = pg.parentId && page(pg.parentId); a; a = a.parentId && page(a.parentId)) parts.unshift(a.title || 'Sans titre');
  return parts.length ? 'Dans ' + parts.join(' / ') : 'Page principale';
}

// ---------- Navigation (avec boutons précédent / suivant du navigateur) ----------
function go(target, push = true) {
  nav = target;
  S.lastPage = target.page || S.lastPage;
  if (push) history.pushState(target, '', target.row ? '#/fiche/' + target.row : '#/page/' + target.page);
  closePopup(); hideFmt();
  renderAll();
  $('#main').scrollTop = 0;
}
function openPage(id, focusTitle) {
  const pg = page(id);
  if (!pg || pg.trashed) id = livePages().find(p => !p.parentId)?.id || livePages()[0]?.id || null;
  for (let a = page(id); a && a.parentId; a = page(a.parentId)) if (page(a.parentId)) page(a.parentId).open = true;
  go({ page: id, row: null });
  if (focusTitle) setCaret($('.page-title'), 0);
}
function openRow(rowId) {
  const ctx = findRow(rowId);
  if (!ctx) return toast('Fiche introuvable');
  go({ page: ctx.host.id, row: rowId });
}
addEventListener('popstate', e => { if (e.state && (e.state.page || e.state.row)) go(e.state, false); });

function renderAll() { renderSidebar(); renderMain(); }
function renderMain() {
  const main = $('#main'), sc = main.scrollTop;
  main.innerHTML = '';
  hideFmt();
  if (nav.row) {
    const ctx = findRow(nav.row);
    if (ctx) { renderRowView(ctx); main.scrollTop = sc; return; }
    nav.row = null;
  }
  const p = page(nav.page);
  if (!p || p.trashed) {
    document.title = 'Simply';
    main.append(h('div', { class: 'empty' }, h('p', {}, 'Aucune page ouverte.'), h('button', { class: 'btn primary', onclick: () => newPage() }, 'Créer une page')));
    return;
  }
  renderPageView(p);
  main.scrollTop = sc;
}

// ---------- Actions sur les pages ----------
function newPage(parentId = null, opts = {}) {
  const pg = createPage(parentId, opts.title || '', opts);
  if (parentId && !page(parentId).isDb) page(parentId).blocks.push({ id: uid(), type: 'page', pageId: pg.id });
  save();
  openPage(pg.id, !opts.title);
  return pg;
}
function newDbPage(parentId = null, view = 'table') {
  const b = { id: uid(), type: 'db', db: newDb('Nouvelle base', view) };
  const pg = newPage(parentId, { title: 'Nouvelle base', icon: '🗂️', blocks: [b] });
  pg.isDb = true; save(); renderAll();
  setCaret($('.page-title'), 'end');
  document.execCommand('selectAll');
}
function newPageMenu(anchor, parentId = null) {
  menu(anchor, [
    { icon: '📄', label: 'Page vide', action: () => newPage(parentId) },
    { icon: '🗂️', label: 'Base de données (tableau)', action: () => newDbPage(parentId, 'table') },
    { icon: '▤', label: 'Base de données (Kanban)', action: () => newDbPage(parentId, 'board') },
    { icon: '📅', label: 'Base de données (calendrier)', action: () => newDbPage(parentId, 'calendar') },
    '-',
    { icon: '🧩', label: 'Depuis un modèle…', action: () => openTemplates(parentId) },
  ]);
}
async function renamePage(pg) {
  const v = await dialog({ title: 'Renommer la page', input: pg.title, ok: 'Renommer' });
  if (v == null) return;
  setPageTitle(pg, v); save(); renderAll();
}
function setPageTitle(pg, v) { pg.title = v; if (pg.isDb && pg.blocks[0]?.db) pg.blocks[0].db.title = v; }
function duplicatePage(pg) {
  const copy = { ...clone(pg), id: uid(), title: (pg.title || 'Sans titre') + ' (copie)', blocks: freshBlocks(pg.blocks), open: false };
  S.pages.splice(S.pages.indexOf(pg) + 1, 0, copy);
  save(); openPage(copy.id);
}
function trashPage(pg) {
  const ids = descendants(pg.id), now = new Date().toISOString();
  ids.forEach(id => { const x = page(id); if (!x.trashed) { x.trashed = now; x.trashRoot = pg.id; } });
  S.favorites = (S.favorites || []).filter(id => !ids.includes(id));
  save();
  if (ids.includes(nav.page)) openPage(pg.parentId); else renderAll();
  toast(`« ${pg.title || 'Sans titre'} » est dans la corbeille`, { label: 'Annuler', fn: () => restorePage(pg) });
}
function restorePage(pg) {
  S.pages.forEach(x => { if (x.trashRoot === pg.id) { delete x.trashed; delete x.trashRoot; } });
  if (pg.parentId && (!page(pg.parentId) || page(pg.parentId).trashed)) pg.parentId = null;
  save(); renderAll();
}
async function saveAsTemplate(pg) {
  const name = await dialog({ title: 'Enregistrer comme modèle', text: 'Donnez un nom à ce modèle. Vous le retrouverez dans « Modèles › Mes modèles ».', input: pg.draftTpl ? '' : pg.title || 'Mon modèle', placeholder: 'Ex. : Compte rendu client', ok: 'Enregistrer' });
  if (!name) return;
  const t = { id: uid(), name, icon: pg.icon, title: pg.draftTpl ? '' : pg.title, cover: pg.cover ? clone(pg.cover) : undefined, blocks: freshBlocks(pg.blocks), isDb: !!pg.isDb };
  S.templates.push(t);
  delete pg.draftTpl;
  save(); renderAll(); toast(`Modèle « ${name} » enregistré`, { label: 'Voir', fn: () => openTemplates(null, null, t.id) });
  return t;
}
async function movePage(pg) {
  const pid = await choosePage('Déplacer « ' + (pg.title || 'Sans titre') + ' » dans…', new Set(descendants(pg.id)));
  if (pid) reparent(pg, pid);
}
function reparent(pg, parentId, beforeId) {
  if (parentId && descendants(pg.id).includes(parentId)) return;
  const old = pg.parentId && page(pg.parentId);
  if (old) old.blocks = old.blocks.filter(b => !(b.type === 'page' && b.pageId === pg.id));
  pg.parentId = parentId || null;
  const np = parentId && page(parentId);
  if (np && !np.isDb && !np.blocks.some(b => b.type === 'page' && b.pageId === pg.id)) np.blocks.push({ id: uid(), type: 'page', pageId: pg.id });
  if (np) np.open = true;
  // Ordre : l'ordre des pages sœurs suit l'ordre du tableau S.pages.
  S.pages.splice(S.pages.indexOf(pg), 1);
  const bi = beforeId ? S.pages.findIndex(x => x.id === beforeId) : -1;
  if (bi >= 0) S.pages.splice(bi, 0, pg); else S.pages.push(pg);
  save(); renderAll();
}
function toggleFavorite(pg) {
  S.favorites ||= [];
  S.favorites = S.favorites.includes(pg.id) ? S.favorites.filter(x => x !== pg.id) : [...S.favorites, pg.id];
  save(); renderAll();
}
function pageMenu(anchor, pg) {
  const fav = (S.favorites || []).includes(pg.id);
  menu(anchor, [
    { icon: fav ? '☆' : '⭐', label: fav ? 'Retirer des favoris' : 'Ajouter aux favoris', action: () => toggleFavorite(pg) },
    { icon: '✎', label: 'Renommer', action: () => renamePage(pg) },
    { icon: '+', label: 'Ajouter une sous-page', action: () => newPage(pg.id) },
    { icon: '⧉', label: 'Dupliquer', action: () => duplicatePage(pg) },
    { icon: '↪', label: 'Déplacer vers…', action: () => movePage(pg) },
    pg.parentId ? { icon: '⇤', label: 'Mettre au premier niveau', action: () => reparent(pg, null) } : null,
    { icon: '🧩', label: 'Enregistrer comme modèle', action: () => saveAsTemplate(pg) },
    '-',
    { icon: '↔', label: pg.full ? 'Largeur normale' : 'Pleine largeur', action: () => { pg.full = !pg.full; save(); renderMain(); } },
    { icon: 'A', label: pg.small ? 'Texte normal' : 'Petit texte', action: () => { pg.small = !pg.small; save(); renderMain(); } },
    { icon: '⬇', label: 'Exporter en Markdown (.md)', action: () => download((pg.title || 'page') + '.md', `# ${pg.title || 'Sans titre'}\n\n` + blocksToMd(pg.blocks)) },
    { icon: '🖨', label: 'Imprimer / PDF', action: () => { if (nav.page !== pg.id) openPage(pg.id); setTimeout(() => print(), 100); } },
    '-',
    { icon: '🗑', label: 'Mettre à la corbeille', danger: true, action: () => trashPage(pg) },
  ]);
}

// ---------- Barre latérale ----------
let treeDrag = null;
function renderSidebar() {
  const side = $('#side');
  side.classList.toggle('collapsed', !!S.sideCollapsed);
  $('#btn-expand').hidden = !S.sideCollapsed;
  const tree = $('#tree'); tree.innerHTML = '';
  const kids = pid => livePages().filter(x => x.parentId === pid);
  const item = (pg, depth, inFav) => {
    const ch = kids(pg.id);
    const el = h('div', {
      class: 'ti' + (pg.id === nav.page && !nav.row ? ' active' : ''), style: `padding-left:${6 + depth * 14}px`, draggable: !inFav,
      onclick: () => openPage(pg.id), ondblclick: () => renamePage(pg),
      ondragstart: e => { treeDrag = pg.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); },
      ondragend: () => { treeDrag = null; $$('.ti.drop-in,.ti.drop-before,.ti.drop-after').forEach(x => x.classList.remove('drop-in', 'drop-before', 'drop-after')); },
      ondragover: e => {
        if (!treeDrag || treeDrag === pg.id) return;
        e.preventDefault();
        const r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
        el.classList.remove('drop-in', 'drop-before', 'drop-after');
        el.classList.add(y < .28 ? 'drop-before' : y > .72 ? 'drop-after' : 'drop-in');
      },
      ondragleave: () => el.classList.remove('drop-in', 'drop-before', 'drop-after'),
      ondrop: e => {
        e.preventDefault();
        const moving = page(treeDrag); treeDrag = null;
        const zone = el.classList.contains('drop-in') ? 'in' : el.classList.contains('drop-before') ? 'before' : 'after';
        el.classList.remove('drop-in', 'drop-before', 'drop-after');
        if (!moving || descendants(moving.id).includes(pg.id)) return;
        if (zone === 'in') return reparent(moving, pg.id);
        const sibs = kids(pg.parentId);
        const next = zone === 'before' ? pg : sibs[sibs.indexOf(pg) + 1];
        reparent(moving, pg.parentId, next && next.id !== moving.id ? next.id : null);
      },
    },
      h('span', { class: 'tw' + (ch.length && !inFav ? '' : ' none'), title: ch.length ? 'Afficher / masquer les sous-pages' : null, onclick: e => { e.stopPropagation(); if (!ch.length || inFav) return; pg.open = !pg.open; save(); renderSidebar(); } }, ico(pg.open && ch.length && !inFav ? 'chevron-down' : 'chevron-right')),
      h('span', { class: 'ti-ic' }, pg.icon || '📄'),
      h('span', { class: 'ti-t' }, pg.title || 'Sans titre'),
      h('span', { class: 'ti-act' },
        h('button', { title: 'Options', onclick: e => { e.stopPropagation(); pageMenu(e.currentTarget, pg); } }, ico('ellipsis')),
        pg.isDb ? null : h('button', { title: 'Ajouter dans cette page', onclick: e => { e.stopPropagation(); newPageMenu(e.currentTarget, pg.id); } }, ico('plus'))));
    return el;
  };
  const walk = (pid, depth) => kids(pid).forEach(pg => {
    tree.append(item(pg, depth));
    if (pg.open) walk(pg.id, depth + 1);
  });
  walk(null, 0);
  if (!livePages().length) tree.append(h('div', { class: 'muted small pad' }, 'Aucune page pour l’instant.'));
  // Pages orphelines (parent disparu) : on les remet au premier niveau.
  livePages().forEach(x => { if (x.parentId && !page(x.parentId)) x.parentId = null; });
  const favs = (S.favorites || []).map(page).filter(x => x && !x.trashed);
  const fav = $('#favs'); fav.innerHTML = '';
  $('#fav-sec').hidden = !favs.length;
  favs.forEach(pg => fav.append(item(pg, 0, true)));
  const n = S.pages.filter(x => x.trashed && x.trashRoot === x.id).length;
  $('#btn-trash .lbl').textContent = 'Corbeille' + (n ? ` (${n})` : '');
}

// ---------- Rendu d'une page ----------
function crumbs(chain, actions) {
  return h('div', { class: 'topbar' },
    h('div', { class: 'crumbs' }, chain.map((a, i) => [i ? h('span', { class: 'sl' }, '/') : null, h('button', { onclick: a.go }, a.label)])),
    h('div', { class: 'top-acts' }, h('span', { class: 'muted small saved', id: 'status-top' }), actions));
}
const GRADIENTS = ['linear-gradient(120deg,#f6d365,#fda085)', 'linear-gradient(120deg,#a1c4fd,#c2e9fb)', 'linear-gradient(120deg,#d4fc79,#96e6a1)', 'linear-gradient(120deg,#fbc2eb,#a6c1ee)', 'linear-gradient(120deg,#84fab0,#8fd3f4)', 'linear-gradient(120deg,#ff9a9e,#fecfef)', 'linear-gradient(120deg,#30cfd0,#330867)', 'linear-gradient(120deg,#434343,#000000)', 'linear-gradient(120deg,#e0c3fc,#8ec5fc)', 'linear-gradient(120deg,#ffecd2,#fcb69f)'];
function coverEl(doc) {
  if (!doc.cover) return null;
  const style = doc.cover.url ? `background-image:url("${doc.cover.url}");background-position:center ${doc.cover.y ?? 50}%` : `background:${doc.cover.grad}`;
  const el = h('div', { class: 'cover', style },
    h('div', { class: 'cover-acts' },
      h('button', { onclick: e => coverPicker(e.currentTarget, doc) }, 'Changer'),
      doc.cover.url ? h('button', { title: 'Glisser l’image vers le haut ou le bas', onmousedown: e => repositionCover(e, doc, el) }, 'Repositionner') : null,
      h('button', { onclick: () => { delete doc.cover; save(); renderMain(); } }, 'Retirer')));
  return el;
}
function repositionCover(e, doc, el) {
  e.preventDefault();
  const y0 = e.clientY, p0 = doc.cover.y ?? 50;
  const move = ev => { doc.cover.y = Math.max(0, Math.min(100, p0 - (ev.clientY - y0) / 3)); el.style.backgroundPosition = `center ${doc.cover.y}%`; };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); save(); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}
function coverPicker(anchor, doc) {
  popup(anchor, [
    h('div', { class: 'mh' }, 'Dégradés'),
    h('div', { class: 'grads' }, GRADIENTS.map(g => h('button', { style: 'background:' + g, onclick: () => { closePopup(); doc.cover = { grad: g }; save(); renderMain(); } }))),
    h('div', { class: 'sep' }),
    h('button', { class: 'mi', onclick: async () => { closePopup(); const f = await pickImage(); if (f) try { doc.cover = { url: await uploadImage(f), y: 50 }; save(); renderMain(); } catch (err) { toast(err.message); } } }, h('span', { class: 'mi-ic' }, '⬆'), 'Envoyer une image'),
    h('button', { class: 'mi', onclick: async () => { closePopup(); const u = await dialog({ title: 'Couverture depuis un lien', input: '', placeholder: 'https://…', ok: 'OK' }); if (u) { doc.cover = { url: u, y: 50 }; save(); renderMain(); } } }, h('span', { class: 'mi-ic' }, '🔗'), 'Lien vers une image'),
  ], null, 'wide-pop');
}
function headControls(doc) {
  return h('div', { class: 'head-ctrl' },
    !doc.icon ? h('button', { onclick: e => iconPicker(e.currentTarget, null, v => { doc.icon = v; save(); renderAll(); }) }, ico('smile'), 'Ajouter une icône') : null,
    !doc.cover ? h('button', { onclick: () => { doc.cover = { grad: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)] }; save(); renderMain(); } }, ico('image'), 'Ajouter une couverture') : null);
}
function bigIcon(doc) {
  return doc.icon ? h('button', { class: 'page-icon', title: 'Changer l’icône', onclick: e => iconPicker(e.currentTarget, doc.icon, v => { doc.icon = v; save(); renderAll(); }) }, doc.icon) : null;
}
function titleEditor(get, set, onEnter) {
  return h('h1', {
    class: 'page-title', contenteditable: 'plaintext-only', 'data-ph': 'Sans titre', text: get(), spellcheck: true,
    oninput: e => { set(e.target.textContent.replace(/\n/g, ' ')); if (!e.target.textContent) e.target.innerHTML = ''; save(); renderSidebar(); $('.topbar .crumbs button:last-child') && ($('.topbar .crumbs button:last-child').textContent = get() || 'Sans titre'); },
    onkeydown: e => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEdge(e.target, false))) { e.preventDefault(); onEnter(e.key); } },
  });
}
function docTail(doc, p) {
  return h('div', { class: 'page-tail', title: 'Cliquer pour ajouter un bloc', onclick: () => appendEmpty(doc) });
}
function appendEmpty(p) {
  const last = p.blocks.at(-1);
  if (last && TEXT.has(last.type) && last.type !== 'code' && !last.text && !indentOf(last)) return focusBlock(last.id, 'end');
  const nb = newBlock(); p.blocks.push(nb); save(); renderMain(); focusBlock(nb.id);
}
function enterFromTitle(doc, key) {
  const first = doc.blocks.find(b => TEXT.has(b.type));
  if (first && (key === 'ArrowDown' || (doc.blocks[0] === first && !first.text))) return focusBlock(first.id, 'start');
  const nb = newBlock(); doc.blocks.unshift(nb); save(); renderMain(); focusBlock(nb.id, 'start');
}

function renderPageView(p) {
  document.title = (p.title || 'Sans titre') + ' — Simply';
  const chain = [];
  for (let a = p; a; a = a.parentId ? page(a.parentId) : null) chain.unshift({ label: `${a.icon || ''} ${a.title || 'Sans titre'}`, go: (id => () => openPage(id))(a.id) });
  const fav = (S.favorites || []).includes(p.id);
  const wrap = h('div', { class: 'page' + (p.full ? ' full' : '') + (p.small ? ' small' : '') + (p.isDb ? ' dbpage' : '') });
  wrap.append(headControls(p), bigIcon(p), titleEditor(() => p.title, v => setPageTitle(p, v), k => p.isDb ? null : enterFromTitle(p, k)));
  if (p.isDb && p.blocks[0]?.type === 'db') {
    wrap.append(renderDb(p, p.blocks[0]));
  } else {
    if (!p.blocks.length) p.blocks.push(newBlock());
    wrap.append(renderBlocks(p));
    if (p.draftTpl) wrap.prepend(h('div', { class: 'tpl-banner' }, h('span', {}, '🧩'), h('span', { class: 'grow' }, h('b', {}, 'Brouillon de modèle. '), 'Écrivez, ajoutez des tableaux, des bases, des titres… puis enregistrez.'),
      h('button', { class: 'btn primary sm', onclick: () => saveAsTemplate(p) }, 'Enregistrer comme modèle')));
    if (isEmptyDoc(p) && !p.draftTpl) wrap.append(h('div', { class: 'tpl-strip' }, h('span', { class: 'muted small' }, 'Commencer avec un modèle :'),
      [...builtins().filter(t => ['tpl-job-candidatures', 'tpl-projet', 'tpl-taches', 'tpl-reunion', 'tpl-planning', 'tpl-cours'].includes(t.id)), ...S.templates].map(t => h('button', { class: 'chip', onclick: () => applyTemplate(p, t) }, `${t.icon} ${t.name}`)),
      h('button', { class: 'chip', onclick: () => openTemplates(null, p) }, 'Tous les modèles…')));
    wrap.append(docTail(p));
  }
  $('#main').append(
    crumbs(chain, [
      h('button', { class: 'top-btn', title: fav ? 'Retirer des favoris' : 'Ajouter aux favoris', onclick: () => toggleFavorite(p) }, h('span', { class: fav ? 'fav-on' : '' }, ico('star'))),
      h('button', { class: 'top-btn', title: 'Options de la page', onclick: e => pageMenu(e.currentTarget, p) }, ico('ellipsis'))]),
    coverEl(p) || '', wrap);
}

// ---------- Rendu d'une fiche (ligne de base de données) ----------
function renderRowView({ db, b, host, row }) {
  const tc = titleCol(db);
  document.title = (rowTitle(db, row) || 'Sans titre') + ' — Simply';
  const chain = [];
  for (let a = host; a; a = a.parentId ? page(a.parentId) : null) chain.unshift({ label: `${a.icon || ''} ${a.title || 'Sans titre'}`, go: (id => () => openPage(id))(a.id) });
  if (!host.isDb) chain.push({ label: '🗂️ ' + (db.title || 'Base'), go: () => openPage(host.id) });
  chain.push({ label: `${row.icon || '📄'} ${rowTitle(db, row) || 'Sans titre'}`, go: () => {} });
  row.blocks ||= [];
  if (!row.blocks.length) row.blocks.push(newBlock());
  const props = h('div', { class: 'props' },
    db.columns.filter(c => c.type !== 'title').map(c => h('div', { class: 'prop' },
      h('button', { class: 'prop-l', title: 'Modifier la propriété', onclick: e => colMenu(e.currentTarget, db, c, renderMain) }, h('span', { class: 'ct' }, COLTYPES[c.type][1]), c.name),
      h('div', { class: 'prop-v' }, cellEditor(db, c, row, () => {}, { big: true })))),
    h('button', { class: 'prop-add', onclick: e => newColumnMenu(e.currentTarget, db, renderMain) }, '+ Ajouter une propriété'));
  const wrap = h('div', { class: 'page row-page' + (host.full ? ' full' : '') },
    headControls(row), bigIcon(row),
    titleEditor(() => rowTitle(db, row), v => { row.cells[tc.id] = v; }, k => enterFromTitle(row, k)),
    props,
    h('div', { class: 'sep big' }),
    isEmptyDoc(row) && db.templates.length ? h('div', { class: 'tpl-strip' }, h('span', { class: 'muted small' }, 'Utiliser un modèle :'),
      db.templates.map(t => h('button', { class: 'chip', onclick: () => { row.blocks = freshBlocks(t.blocks); Object.entries(t.cells || {}).forEach(([k, v]) => { if (isBlank(row.cells[k])) row.cells[k] = clone(v); }); if (t.icon && !row.icon) row.icon = t.icon; save(); renderMain(); } }, `${t.icon || '🧩'} ${t.name}`))) : null,
    renderBlocks(row), docTail(row));
  $('#main').append(
    crumbs(chain, [
      h('button', { class: 'top-btn', title: 'Retour à la base', onclick: () => openPage(host.id) }, ico('arrow-left'), 'Base'),
      h('button', { class: 'top-btn', title: 'Options de la fiche', onclick: e => menu(e.currentTarget, [
        { icon: '🧩', label: 'Enregistrer comme modèle de fiche', action: async () => { const n = await dialog({ title: 'Modèle de fiche', text: 'Nom du modèle :', input: rowTitle(db, row) || 'Modèle', ok: 'Enregistrer' }); if (!n) return; const cells = clone(row.cells); delete cells[tc.id]; db.templates.push({ id: uid(), name: n, icon: row.icon, blocks: freshBlocks(row.blocks), cells }); save(); toast(`Modèle « ${n} » ajouté à la base`); } },
        { icon: '⧉', label: 'Dupliquer la fiche', action: () => openRow(duplicateRow(db, row).id) },
        { icon: '⬇', label: 'Exporter en Markdown (.md)', action: () => download((rowTitle(db, row) || 'fiche') + '.md', `# ${rowTitle(db, row)}\n\n` + db.columns.filter(c => c.type !== 'title').map(c => `- **${c.name}** : ${cellText(c, row.cells[c.id], row)}`).join('\n') + '\n\n' + blocksToMd(row.blocks)) },
        '-',
        { icon: '🗑', label: 'Supprimer la fiche', danger: true, action: () => deleteRow(db, row, () => openPage(host.id)) },
      ]) }, ico('ellipsis'))]),
    coverEl(row) || '', wrap);
}

// ---------- Modèles ----------
function applyTemplate(p, t) {
  p.blocks = isEmptyDoc(p) ? freshBlocks(t.blocks) : [...p.blocks, ...freshBlocks(t.blocks)];
  if (!p.title) p.title = t.title;
  if (!p.icon || p.icon === '📄') p.icon = t.icon;
  if (t.cover && !p.cover) p.cover = clone(t.cover);
  if (t.isDb && p.blocks.length === 1 && p.blocks[0].type === 'db') { p.isDb = true; p.blocks[0].db.title = p.title; }
  save(); renderAll();
}
function useTemplate(t, parentId) {
  const pg = createPage(parentId, t.title, { icon: t.icon, blocks: freshBlocks(t.blocks) });
  if (t.isDb) pg.isDb = true;
  if (t.cover) pg.cover = clone(t.cover);
  if (parentId && !page(parentId).isDb) page(parentId).blocks.push({ id: uid(), type: 'page', pageId: pg.id });
  save(); openPage(pg.id);
}
const TPL_MINE = 'Mes modèles';
const tplKind = t => t.isDb ? 'Base de données' : t.blocks.some(b => b.type === 'db') ? 'Page + base' : 'Page';
// Aperçu réel d'un modèle : ses blocs avec le rendu habituel, mais impossibles à modifier (inert).
function tplPreview(t) {
  const doc = { id: uid(), title: t.title, icon: t.icon, blocks: clone(t.blocks) };
  const cov = t.cover ? h('div', { class: 'pv-cover', style: t.cover.url ? `background-image:url("${t.cover.url}")` : `background:${t.cover.grad}` }) : null;
  return h('div', { class: 'pv' + (t.isDb ? ' isdb' : ''), inert: true, 'aria-hidden': 'true' }, cov,
    h('div', { class: 'pv-page' + (cov ? ' with-cover' : '') },
      t.icon ? h('div', { class: 'pv-icon' }, t.icon) : null,
      h('div', { class: 'pv-title' }, t.title || t.name),
      renderBlocks(doc)));
}
// L'aperçu est dessiné à 820 px de large puis réduit pour tenir dans sa boîte.
const fitPreviews = root => requestAnimationFrame(() => $$('.tg-thumb, .tg-live', root).forEach(b => b.firstChild && (b.firstChild.style.zoom = b.clientWidth / 820)));

// Galerie : catégories à gauche, vignettes vivantes à droite, aperçu en grand au clic.
function openTemplates(parentId = null, intoPage = null, focusId = null) {
  let close, q = '', cat = focusId ? TPL_MINE : 'Tous';
  const list = [...builtins(), ...S.templates.map(t => ({ ...t, cat: TPL_MINE, mine: t, desc: t.desc || 'Votre modèle, créé à partir de « ' + (t.title || t.name) + ' ».' }))];
  const cats = ['Tous', ...new Set(list.filter(t => !t.mine).map(t => t.cat)), TPL_MINE];
  const side = h('div', { class: 'tg-side' }), main = h('div', { class: 'tg-main' });
  const use = t => { close(); intoPage ? applyTemplate(intoPage, t) : useTemplate(t, parentId); toast(`Modèle « ${t.name} » utilisé`); };
  const createBtn = cls => h('button', { class: 'btn primary ' + cls, onclick: e => createTemplateMenu(e.currentTarget, () => close()) }, '＋ Créer un modèle');
  const search = h('input', { class: 'mini wide', placeholder: 'Rechercher un modèle…', oninput: e => { q = e.target.value; drawGrid(); } });
  const catBox = h('div', { class: 'tg-cats' });
  const drawCats = () => catBox.replaceChildren(...cats.map(c => h('button', {
    class: 'tg-cat' + (c === cat && !q ? ' on' : ''), onclick: () => { cat = c; q = ''; search.value = ''; drawCats(); drawGrid(); },
  }, h('span', { class: 'grow' }, c), h('span', { class: 'muted small' }, c === 'Tous' ? list.length : list.filter(t => t.cat === c).length))));
  const card = t => h('div', { class: 'tg-card', tabindex: 0, onclick: () => detail(t), onkeydown: e => { if (e.key === 'Enter') detail(t); } },
    h('div', { class: 'tg-thumb' }, tplPreview(t)),
    h('div', { class: 'tg-info' },
      h('div', { class: 'tg-name' }, h('span', { class: 'tg-ic' }, t.icon || '📄'), t.name),
      h('div', { class: 'tg-desc' }, t.desc),
      h('div', { class: 'tg-tags' }, h('span', { class: 'pill c-gray' }, tplKind(t)))),
    h('div', { class: 'tg-hover' },
      h('button', { class: 'btn sm', onclick: e => { e.stopPropagation(); detail(t); } }, 'Aperçu'),
      h('button', { class: 'btn primary sm', onclick: e => { e.stopPropagation(); use(t); } }, 'Utiliser')));
  const drawGrid = () => {
    drawCats();
    const f = fold(q.trim());
    const items = list.filter(t => f ? fold(`${t.name} ${t.desc} ${t.cat}`).includes(f) : cat === 'Tous' || t.cat === cat);
    main.replaceChildren(
      h('div', { class: 'tg-top' },
        h('h2', {}, f ? `Résultats pour « ${q.trim()} »` : cat === 'Tous' ? 'Tous les modèles' : cat),
        h('p', { class: 'muted' }, cat === TPL_MINE && !f
          ? 'Vos propres modèles. Créez-en un à partir de n’importe quelle page : il sera prêt à resservir en un clic.'
          : intoPage ? 'Choisissez un modèle à appliquer à la page vide en cours.' : 'Cliquez sur un modèle pour le voir en grand avant de l’utiliser.')),
      items.length ? h('div', { class: 'tg-grid' }, items.map(card))
        : h('div', { class: 'tg-empty' }, h('div', { class: 'tg-empty-ic' }, '🧩'),
          h('p', {}, cat === TPL_MINE && !f ? 'Vous n’avez pas encore de modèle personnel.' : 'Aucun modèle ne correspond à votre recherche.'),
          cat === TPL_MINE && !f ? createBtn('') : null));
    main.scrollTop = 0;
    fitPreviews(main);
  };
  const detail = t => {
    const mine = t.mine;
    main.replaceChildren(
      h('div', { class: 'tg-dbar' },
        h('button', { class: 'tool', onclick: drawGrid }, ico('back'), 'Tous les modèles'),
        h('span', { class: 'grow' }),
        mine ? h('button', { class: 'btn', onclick: async () => { const n = await dialog({ title: 'Renommer le modèle', input: mine.name, ok: 'Renommer' }); if (n) { mine.name = n; save(); close(); openTemplates(parentId, intoPage, mine.id); } } }, 'Renommer') : null,
        mine ? h('button', { class: 'btn danger', onclick: async () => {
          if (!await dialog({ title: 'Supprimer ce modèle ?', text: `« ${mine.name} » sera supprimé. Les pages déjà créées avec ce modèle restent.`, ok: 'Supprimer', danger: true })) return;
          S.templates = S.templates.filter(x => x !== mine); save(); close(); openTemplates(parentId, intoPage);
        } }, 'Supprimer') : null,
        h('button', { class: 'btn primary', onclick: () => use(t) }, intoPage ? 'Appliquer à cette page' : 'Utiliser ce modèle')),
      h('div', { class: 'tg-dhead' },
        h('div', { class: 'tg-dic' }, t.icon || '📄'),
        h('div', { class: 'grow' }, h('h2', {}, t.name), h('p', { class: 'muted' }, t.desc),
          h('div', { class: 'tg-tags' }, h('span', { class: 'pill c-gray' }, tplKind(t)), h('span', { class: 'pill c-blue' }, t.cat)))),
      h('div', { class: 'tg-live' }, tplPreview(t)));
    main.scrollTop = 0;
    fitPreviews(main);
  };
  side.append(h('div', { class: 'tg-title' }, ico('grid'), 'Modèles'), search, catBox, h('span', { class: 'grow' }), createBtn('wide'),
    h('p', { class: 'muted small tg-tip' }, 'Astuce : sur n’importe quelle page, « ⋯ › Enregistrer comme modèle ».'));
  close = modal(null, h('div', { class: 'tg' }, side, main, h('button', { class: 'x tg-close', title: 'Fermer (Échap)', onclick: () => close() }, '✕')), null, 'tg-modal');
  const focused = focusId && list.find(t => t.mine?.id === focusId);
  focused ? (drawCats(), detail(focused)) : drawGrid();
  search.focus();
}
// « Créer un modèle » : depuis la page ouverte, depuis une autre page, ou en partant d'un brouillon vide.
function createTemplateMenu(anchor, closeGallery) {
  const cur = !nav.row && page(nav.page);
  const after = t => t && openTemplates(null, null, t.id);
  menu(anchor, [
    { header: 'Créer un modèle…' },
    { icon: '✨', label: 'Avec l’assistant IA…', hint: 'décrivez-le', action: () => { closeGallery(); aiCreateTemplate(); } },
    cur ? { icon: cur.icon || '📄', label: `À partir de « ${cur.title || 'Sans titre'} »`, hint: 'page ouverte', action: async () => { closeGallery(); after(await saveAsTemplate(cur)); } } : null,
    { icon: '↪', label: 'À partir d’une autre page…', action: async () => { closeGallery(); const id = await choosePage('Quelle page transformer en modèle ?'); if (id) after(await saveAsTemplate(page(id))); } },
    { icon: '✏️', label: 'Partir d’une page vide', hint: 'brouillon', action: () => {
      closeGallery();
      const pg = newPage(null, { title: 'Nouveau modèle', icon: '🧩' });
      pg.draftTpl = true; save(); renderAll();
    } },
  ]);
}

// Petit outil pour fabriquer les bases des modèles.
function mkDb(title, spec, rows = [], views = ['table'], extra = {}) {
  const db = { id: uid(), title, columns: [], rows: [], views: [], templates: [] };
  const byName = {};
  spec.forEach(([name, type, opts]) => {
    const c = { id: uid(), name, type };
    if (isChoice(type)) c.options = (opts || []).map(o => Array.isArray(o) ? opt(o[0], o[1]) : opt(o, COLORS[(c.options?.length || 0) % COLORS.length]));
    if (isChoice(type)) c.options.forEach((o, i) => { if (!Array.isArray((opts || [])[i])) o.color = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'brown'][i % 9]; });
    if (type === 'number' && opts) c.format = opts;
    db.columns.push(c); byName[name] = c;
  });
  rows.forEach(vals => {
    const r = newRowObj(db);
    Object.entries(vals).forEach(([k, v]) => {
      if (k === '_icon') return void (r.icon = v);
      if (k === '_blocks') return void (r.blocks = v);
      const c = byName[k]; if (!c) return;
      if (isChoice(c.type)) { const ids = [].concat(v).map(n => ensureOpt(c, n).id); r.cells[c.id] = c.type === 'multi' ? ids : ids[0]; }
      else r.cells[c.id] = v;
    });
    db.rows.push(r);
  });
  views.forEach(vt => {
    const [type, opts = {}] = Array.isArray(vt) ? vt : [vt];
    const v = newView(type, db);
    if (opts.name) v.name = opts.name;
    if (opts.group) v.groupBy = byName[opts.group].id;
    if (opts.date) v.dateCol = byName[opts.date].id;
    if (opts.end) v.endCol = byName[opts.end].id;
    if (opts.sum) v.sumCol = byName[opts.sum].id;
    if (opts.sort) v.sorts = [{ col: byName[opts.sort[0]].id, dir: opts.sort[1] }];
    if (opts.calc) v.calc = Object.fromEntries(Object.entries(opts.calc).map(([k, f]) => [byName[k].id, f]));
    if (opts.hide) v.hidden = opts.hide.map(n => byName[n].id);
    db.views.push(v);
  });
  db.view = db.views[0].id;
  if (extra.templates) { db.templates = extra.templates.map(t => ({ id: uid(), name: t.name, icon: t.icon, blocks: t.blocks, cells: {} })); db.defaultTpl = db.templates[0].id; }
  return db;
}
const dbBlock = db => ({ id: uid(), type: 'db', db });
function builtins() {
  const b = (type, html = '', extra) => Object.assign(newBlock(type, html), extra || {});
  const PLATF = [['Instagram', 'pink'], ['TikTok', 'gray'], ['LinkedIn', 'blue'], ['YouTube', 'red'], ['Facebook', 'purple'], ['X', 'brown']];
  return [
    // — Recherche d'emploi (stage, alternance, CDD, CDI) —
    ...(() => {
      const JOB = 'Recherche d’emploi';
      const CONTRATS = [['Stage', 'purple'], ['Alternance', 'pink'], ['CDD', 'yellow'], ['CDI', 'green'], ['Intérim', 'orange'], ['Freelance', 'blue']];
      const SOURCES = [['LinkedIn', 'blue'], ['Indeed', 'purple'], ['Welcome to the Jungle', 'yellow'], ['France Travail', 'red'], ['Site de l’entreprise', 'gray'], ['Réseau / bouche-à-oreille', 'green']];
      const n = (x, y, text, color, shape = 'round', w = 150, hh = 60) => ({ id: uid(), x, y, w, h: hh, shape, text, color });
      const flow = (nodes, links, height) => b('diagram', '', { diagram: { h: height, nodes, edges: links.map(([a, z, label = '']) => ({ id: uid(), from: a.id, to: z.id, label })) } });
      // Schéma : le parcours d'une candidature
      const s1 = n(20, 40, '🎯 Cibler une offre', 'blue'), s2 = n(200, 40, '✍️ Adapter CV + lettre', 'purple'), s3 = n(380, 40, '📨 Postuler', 'orange'),
        s4 = n(560, 25, 'Réponse sous 10 jours ?', 'yellow', 'diamond', 160, 90), s5 = n(560, 170, '🔁 Relancer', 'pink'), s6 = n(760, 40, '🤝 Entretien', 'green'), s7 = n(760, 170, '🎉 Offre', 'green', 'ellipse');
      const parcours = () => flow([s1, s2, s3, s4, s5, s6, s7], [[s1, s2], [s2, s3], [s3, s4], [s4, s6, 'oui'], [s4, s5, 'non'], [s5, s6], [s6, s7]], 280);
      // Schéma : carte de mes compétences
      const c0 = n(330, 150, 'Moi', 'blue', 'ellipse', 140, 70), c1 = n(40, 30, 'Savoir-faire\n(outils, logiciels)', 'green', 'round', 170, 64), c2 = n(620, 30, 'Savoir-être\n(qualités)', 'orange', 'round', 170, 64),
        c3 = n(40, 270, 'Expériences\n(stages, jobs, projets)', 'purple', 'round', 170, 64), c4 = n(620, 270, 'Langues\n& certifications', 'pink', 'round', 170, 64);
      const competences = () => flow([c0, c1, c2, c3, c4], [[c0, c1], [c0, c2], [c0, c3], [c0, c4]], 360);
      return [
        {
          id: 'tpl-job-dashboard', cat: JOB, name: 'Tableau de bord de recherche', icon: '🧭', title: 'Ma recherche d’emploi', cover: { grad: GRADIENTS[1] },
          desc: 'Le point de départ : objectifs, parcours d’une candidature en schéma, bilan chiffré par semaine avec graphique.',
          blocks: [b('callout', '<b>Mon objectif :</b> décrocher un stage / CDD / CDI de … dans … avant le ' + fmtDate(today(60)) + '.', { icon: '🎯', color: 'bg-blue' }),
            b('h2', '🗺️ Le parcours d’une candidature'), parcours(),
            b('h2', '✅ Cette semaine'), b('todo', 'Envoyer 5 candidatures ciblées'), b('todo', 'Relancer les candidatures de plus de 10 jours'), b('todo', 'Contacter 2 personnes de mon réseau'), b('todo', 'Mettre à jour mon profil LinkedIn'),
            b('h2', '📊 Bilan par semaine'),
            dbBlock(mkDb('Bilan par semaine', [['Semaine', 'title'], ['Candidatures', 'number'], ['Relances', 'number'], ['Entretiens', 'number'], ['Ressenti', 'select', [['💪 Motivé', 'green'], ['😐 Moyen', 'yellow'], ['😩 Difficile', 'red']]]],
              [{ 'Semaine': 'Semaine 1', 'Candidatures': 6, 'Relances': 0, 'Entretiens': 0, 'Ressenti': '💪 Motivé' }, { 'Semaine': 'Semaine 2', 'Candidatures': 8, 'Relances': 4, 'Entretiens': 1, 'Ressenti': '😐 Moyen' }, { 'Semaine': 'Semaine 3', 'Candidatures': 5, 'Relances': 3, 'Entretiens': 2, 'Ressenti': '💪 Motivé' }],
              [['table', { name: 'Tableau', calc: { 'Candidatures': 'sum', 'Relances': 'sum', 'Entretiens': 'sum' } }], ['chart', { name: 'Graphique', group: 'Ressenti', sum: 'Candidatures' }]])),
            b('quote', 'Chaque « non » rapproche du « oui ». Régularité > quantité.')],
        },
        {
          id: 'tpl-job-candidatures', cat: JOB, name: 'Suivi des candidatures', icon: '📨', title: 'Mes candidatures', isDb: true, cover: { grad: GRADIENTS[4] },
          desc: 'Le tableau indispensable : Kanban par étape, graphique, calendrier des relances, modèle de fiche avec checklist.',
          blocks: [dbBlock(mkDb('Mes candidatures', [['Poste', 'title'], ['Entreprise', 'text'], ['Contrat', 'select', CONTRATS], ['Étape', 'status', [['À postuler', 'gray'], ['Postulé', 'blue'], ['Relancé', 'purple'], ['Entretien', 'yellow'], ['Offre reçue', 'green'], ['Refus', 'red']]], ['Postulé le', 'date'], ['Prochaine relance', 'date'], ['Source', 'select', SOURCES], ['Salaire annuel brut', 'number', 'euro'], ['Lien de l’offre', 'url'], ['Contact', 'text']],
            [{ 'Poste': 'Assistant·e marketing', 'Entreprise': 'Studio Lumière', 'Contrat': 'Stage', 'Étape': 'Entretien', 'Postulé le': today(-12), 'Prochaine relance': today(2), 'Source': 'Welcome to the Jungle', _icon: '💡' },
              { 'Poste': 'Chargé·e de communication', 'Entreprise': 'Maison Verte', 'Contrat': 'CDI', 'Étape': 'Postulé', 'Postulé le': today(-4), 'Prochaine relance': today(6), 'Source': 'LinkedIn', 'Salaire annuel brut': 32000, _icon: '🌿' },
              { 'Poste': 'Community manager', 'Entreprise': 'Les Petits Pois', 'Contrat': 'Alternance', 'Étape': 'Relancé', 'Postulé le': today(-15), 'Prochaine relance': today(1), 'Source': 'Indeed', _icon: '🫛' },
              { 'Poste': 'Assistant·e commercial·e', 'Entreprise': 'Atelier Nord', 'Contrat': 'CDD', 'Étape': 'Refus', 'Postulé le': today(-20), 'Source': 'France Travail', _icon: '🏭' },
              { 'Poste': 'Chef·fe de projet junior', 'Entreprise': 'Agence Bleue', 'Contrat': 'CDI', 'Étape': 'À postuler', 'Source': 'Réseau / bouche-à-oreille', 'Salaire annuel brut': 35000, _icon: '🔵' }],
            [['board', { name: 'Par étape', group: 'Étape' }], ['table', { name: 'Toutes', sort: ['Postulé le', 'desc'] }], ['chart', { name: 'Où j’en suis', group: 'Étape' }], ['chart', { name: 'Par source', group: 'Source' }], ['calendar', { name: 'Relances', date: 'Prochaine relance' }]],
            { templates: [{ name: 'Nouvelle candidature', icon: '📨', blocks: [b('h3', 'Pourquoi ce poste ?'), b('p', '2–3 raisons qui me motivent.'), b('h3', 'Checklist'), b('todo', 'CV adapté à l’offre'), b('todo', 'Lettre / message personnalisé'), b('todo', 'Candidature envoyée'), b('todo', 'Relance prévue (J+10)'), b('h3', 'Notes'), b('bullet', 'Ce que je sais de l’entreprise…')] }] }))],
        },
        {
          id: 'tpl-job-cv', cat: JOB, name: 'CV', icon: '📄', title: 'Prénom NOM — CV', cover: { grad: GRADIENTS[8] },
          desc: 'Un CV clair et structuré à remplir : profil, expériences, formation, compétences en tableau.',
          blocks: [b('p', '📍 Ville · 📞 06 … · ✉️ prenom.nom@… · 🔗 linkedin.com/in/…'),
            b('callout', '<b>Profil :</b> en 2 phrases, qui vous êtes et ce que vous cherchez (ex. « Étudiant·e en communication, je recherche un stage de 6 mois à partir de mars. »)', { icon: '👤', color: 'bg-gray' }),
            b('h2', 'Expériences'), b('h3', 'Intitulé du poste — Entreprise (mois année – mois année)'), b('bullet', 'Mission avec un verbe d’action + un résultat chiffré'), b('bullet', 'Deuxième mission'),
            b('h3', 'Job étudiant / projet — Lieu (année)'), b('bullet', 'Ce que vous y avez appris'),
            b('h2', 'Formation'), b('bullet', '<b>Diplôme</b> — École, ville (année)'), b('bullet', '<b>Baccalauréat</b> — mention, lycée (année)'),
            b('h2', 'Compétences'), b('table', '', { header: true, rows: [['Domaine', 'Compétences', 'Niveau'], ['Logiciels', 'Excel, Canva, Word', '★★★★☆'], ['Langues', 'Anglais (B2), Espagnol (A2)', '★★★☆☆'], ['Qualités', 'Organisé·e, curieux·se, à l’écoute', '']] }),
            b('h2', 'Centres d’intérêt'), b('p', 'Sport, bénévolat, voyages… (ce qui dit quelque chose de vous)'),
            b('toggle', '💡 Conseils pour un bon CV', { open: false }), b('bullet', '1 page maximum pour un premier emploi', { indent: 1 }), b('bullet', 'Adapter le profil et les mots-clés à chaque offre', { indent: 1 }), b('bullet', 'Exporter en PDF (⋯ › Imprimer / PDF)', { indent: 1 })],
        },
        {
          id: 'tpl-job-lettre', cat: JOB, name: 'Lettre de motivation', icon: '✉️', title: 'Lettre — Entreprise — Poste',
          desc: 'La méthode « Vous / Moi / Nous » avec des phrases d’exemple et une checklist de relecture.',
          blocks: [b('callout', 'Sélectionnez un paragraphe puis « ✨ IA » pour le corriger ou le rendre plus professionnel.', { icon: '✨', color: 'bg-purple' }),
            b('p', 'Prénom NOM<br>Adresse · Téléphone · E-mail'), b('p', 'À l’attention de Madame / Monsieur …<br>Objet : candidature au poste de … (référence …)'),
            b('h3', '1. Vous — l’entreprise'), b('p', 'Ce qui m’attire chez vous : votre projet, vos valeurs, une actualité récente…'),
            b('h3', '2. Moi — ce que j’apporte'), b('p', 'Mes compétences et une expérience concrète qui prouve que je peux réussir dans ce poste.'),
            b('h3', '3. Nous — ce que nous ferons ensemble'), b('p', 'Comment je contribuerai à vos objectifs, et ma disponibilité pour un entretien.'),
            b('p', 'Je vous prie d’agréer, Madame, Monsieur, mes salutations distinguées.'),
            b('h3', '✅ Avant d’envoyer'), b('todo', 'Nom de l’entreprise et du poste corrects partout'), b('todo', 'Pas de faute (✨ IA › Corriger)'), b('todo', 'Moins d’une page'), b('todo', 'Envoyée en PDF')],
        },
        {
          id: 'tpl-job-entretien', cat: JOB, name: 'Préparer un entretien', icon: '🤝', title: 'Entretien — Entreprise', cover: { grad: GRADIENTS[2] },
          desc: 'Fiche entreprise, questions classiques avec la méthode STAR, questions à poser et checklist du jour J.',
          blocks: [b('callout', '<b>Date :</b> ' + fmtDate(today(5)) + ' · <b>Heure :</b> … · <b>Lieu / lien visio :</b> … · <b>Avec :</b> …', { icon: '📅', color: 'bg-green' }),
            b('h2', '🏢 L’entreprise en 5 points'), b('bullet', 'Activité, clients, concurrents'), b('bullet', 'Chiffres clés (taille, CA, implantation)'), b('bullet', 'Actualité récente'),
            b('h2', '❓ Questions classiques'),
            b('toggle', 'Présentez-vous', { open: true }), b('p', 'Pitch de 1 minute : qui je suis, mon parcours, pourquoi ce poste.', { indent: 1 }),
            b('toggle', 'Pourquoi notre entreprise ?', { open: false }), b('p', '…', { indent: 1 }),
            b('toggle', 'Vos qualités et vos défauts ?', { open: false }), b('p', 'Un défaut réel + ce que je fais pour progresser.', { indent: 1 }),
            b('toggle', 'Parlez-moi d’une difficulté que vous avez surmontée', { open: false }), b('p', 'Méthode STAR (voir tableau).', { indent: 1 }),
            b('h2', '⭐ Mes exemples (méthode STAR)'), b('table', '', { header: true, rows: [['Situation', 'Tâche', 'Action', 'Résultat'], ['Stage chez …', 'Lancer un compte Instagram', 'Calendrier éditorial + 3 posts / semaine', '+800 abonnés en 2 mois'], ['', '', '', '']] }),
            b('h2', '🙋 Mes questions à poser'), b('number', 'À quoi ressemble une journée type ?'), b('number', 'Comment sera évaluée ma réussite à 3 mois ?'), b('number', 'Quelles sont les prochaines étapes ?'),
            b('h2', '🎒 Jour J'), b('todo', 'CV imprimé + carnet'), b('todo', 'Trajet vérifié (arriver 10 min avant)'), b('todo', 'Tenue prête'), b('todo', 'E-mail de remerciement le soir même')],
        },
        {
          id: 'tpl-job-entreprises', cat: JOB, name: 'Entreprises cibles', icon: '🏢', title: 'Entreprises cibles', isDb: true,
          desc: 'La liste des entreprises qui vous font envie, par secteur et par intérêt, avec graphique.',
          blocks: [dbBlock(mkDb('Entreprises cibles', [['Entreprise', 'title'], ['Secteur', 'select', [['Communication', 'pink'], ['Commerce', 'orange'], ['Tech', 'blue'], ['Industrie', 'brown'], ['Associatif', 'green'], ['Public', 'gray']]], ['Taille', 'select', [['Start-up', 'purple'], ['PME', 'blue'], ['Grand groupe', 'gray']]], ['Ville', 'text'], ['Intérêt', 'select', [['⭐⭐⭐', 'green'], ['⭐⭐', 'yellow'], ['⭐', 'gray']]], ['Étape', 'status', [['À explorer', 'gray'], ['Contact pris', 'blue'], ['Candidature envoyée', 'green']]], ['Site', 'url']],
            [{ 'Entreprise': 'Studio Lumière', 'Secteur': 'Communication', 'Taille': 'PME', 'Ville': 'Lyon', 'Intérêt': '⭐⭐⭐', 'Étape': 'Candidature envoyée', _icon: '💡' }, { 'Entreprise': 'Maison Verte', 'Secteur': 'Associatif', 'Taille': 'PME', 'Ville': 'Nantes', 'Intérêt': '⭐⭐', 'Étape': 'Contact pris', _icon: '🌿' },
              { 'Entreprise': 'Agence Bleue', 'Secteur': 'Tech', 'Taille': 'Start-up', 'Ville': 'Paris', 'Intérêt': '⭐⭐⭐', 'Étape': 'À explorer', _icon: '🔵' }, { 'Entreprise': 'Atelier Nord', 'Secteur': 'Industrie', 'Taille': 'Grand groupe', 'Ville': 'Lille', 'Intérêt': '⭐', 'Étape': 'À explorer', _icon: '🏭' }],
            [['gallery', { name: 'Galerie' }], ['table', { name: 'Tableau' }], ['board', { name: 'Par étape', group: 'Étape' }], ['chart', { name: 'Par secteur', group: 'Secteur' }]]))],
        },
        {
          id: 'tpl-job-reseau', cat: JOB, name: 'Réseau & contacts', icon: '👥', title: 'Mon réseau', isDb: true,
          desc: 'Les personnes rencontrées, quand les relancer, et un calendrier des prochains échanges.',
          blocks: [dbBlock(mkDb('Mon réseau', [['Nom', 'title'], ['Entreprise', 'text'], ['Rôle', 'text'], ['Rencontré via', 'select', [['LinkedIn', 'blue'], ['Salon / forum', 'orange'], ['École', 'purple'], ['Ami·e / famille', 'green'], ['Ancien stage', 'yellow']]], ['Dernier échange', 'date'], ['Prochaine relance', 'date'], ['E-mail', 'email'], ['Statut', 'status', [['À contacter', 'gray'], ['En contact', 'blue'], ['M’a recommandé·e', 'green']]]],
            [{ 'Nom': 'Camille Martin', 'Entreprise': 'Studio Lumière', 'Rôle': 'Responsable RH', 'Rencontré via': 'Salon / forum', 'Dernier échange': today(-8), 'Prochaine relance': today(3), 'Statut': 'En contact' },
              { 'Nom': 'Léo Bernard', 'Entreprise': 'Agence Bleue', 'Rôle': 'Chef de projet', 'Rencontré via': 'École', 'Prochaine relance': today(1), 'Statut': 'À contacter' }],
            [['table', { name: 'Tous' }], ['calendar', { name: 'Relances', date: 'Prochaine relance' }], ['board', { name: 'Par statut', group: 'Statut' }]]))],
        },
        {
          id: 'tpl-job-entretiens', cat: JOB, name: 'Suivi des entretiens', icon: '🗓️', title: 'Mes entretiens', isDb: true,
          desc: 'Chaque entretien passé ou à venir : date, type, interlocuteur, ressenti et résultat.',
          blocks: [dbBlock(mkDb('Mes entretiens', [['Entreprise', 'title'], ['Date', 'date'], ['Type', 'select', [['Téléphone', 'gray'], ['Visio', 'blue'], ['Sur place', 'green'], ['Test / cas pratique', 'orange']]], ['Interlocuteur', 'text'], ['Ressenti', 'select', [['😄 Très bien', 'green'], ['🙂 Bien', 'blue'], ['😬 Moyen', 'yellow']]], ['Résultat', 'status', [['En attente', 'gray'], ['Tour suivant', 'blue'], ['Offre', 'green'], ['Refus', 'red']]]],
            [{ 'Entreprise': 'Studio Lumière', 'Date': today(2), 'Type': 'Visio', 'Interlocuteur': 'Camille Martin (RH)', 'Résultat': 'En attente', _icon: '💡' }, { 'Entreprise': 'Les Petits Pois', 'Date': today(-3), 'Type': 'Téléphone', 'Ressenti': '🙂 Bien', 'Résultat': 'Tour suivant', _icon: '🫛' }],
            [['calendar', { name: 'Calendrier', date: 'Date' }], ['table', { name: 'Tableau', sort: ['Date', 'desc'] }], ['chart', { name: 'Résultats', group: 'Résultat' }]],
            { templates: [{ name: 'Compte rendu d’entretien', icon: '📝', blocks: [b('h3', 'Questions posées'), b('bullet'), b('h3', 'Ce qui s’est bien passé'), b('bullet'), b('h3', 'À améliorer'), b('bullet'), b('h3', 'Suite'), b('todo', 'Envoyer un e-mail de remerciement')] }] }))],
        },
        {
          id: 'tpl-job-offres', cat: JOB, name: 'Comparer des offres', icon: '⚖️', title: 'Comparatif des offres', isDb: true,
          desc: 'Tableau façon Excel pour comparer salaire, télétravail, trajet et avantages, avec moyennes.',
          blocks: [dbBlock(mkDb('Comparatif des offres', [['Offre', 'title'], ['Contrat', 'select', CONTRATS], ['Salaire annuel brut', 'number', 'euro'], ['Salaire net mensuel (≈)', 'number', 'euro'], ['Télétravail (j/sem.)', 'number'], ['Trajet (min)', 'number'], ['Tickets resto', 'checkbox'], ['Mutuelle prise en charge', 'checkbox'], ['Note /10', 'number']],
            [{ 'Offre': 'Maison Verte — Chargé·e de com', 'Contrat': 'CDI', 'Salaire annuel brut': 32000, 'Salaire net mensuel (≈)': 2080, 'Télétravail (j/sem.)': 2, 'Trajet (min)': 25, 'Tickets resto': true, 'Mutuelle prise en charge': true, 'Note /10': 8 },
              { 'Offre': 'Agence Bleue — Chef·fe de projet', 'Contrat': 'CDI', 'Salaire annuel brut': 35000, 'Salaire net mensuel (≈)': 2275, 'Télétravail (j/sem.)': 1, 'Trajet (min)': 50, 'Tickets resto': false, 'Mutuelle prise en charge': true, 'Note /10': 7 }],
            [['table', { name: 'Comparatif', calc: { 'Salaire annuel brut': 'avg', 'Salaire net mensuel (≈)': 'avg', 'Note /10': 'max' }, sort: ['Note /10', 'desc'] }]]))],
        },
        {
          id: 'tpl-job-planning', cat: JOB, name: 'Planning de recherche', icon: '⏱️', title: 'Planning de ma recherche', isDb: true,
          desc: 'Les grandes étapes sur une chronologie (début → fin), du CV aux entretiens.',
          blocks: [dbBlock(mkDb('Planning de ma recherche', [['Étape', 'title'], ['Début', 'date'], ['Fin', 'date'], ['Statut', 'status', [['À faire', 'gray'], ['En cours', 'blue'], ['Terminé', 'green']]]],
            [{ 'Étape': 'Faire le point sur mon projet', 'Début': today(-3), 'Fin': today(0), 'Statut': 'Terminé' }, { 'Étape': 'Refaire CV et LinkedIn', 'Début': today(1), 'Fin': today(5), 'Statut': 'En cours' },
              { 'Étape': 'Lister 20 entreprises cibles', 'Début': today(3), 'Fin': today(8), 'Statut': 'À faire' }, { 'Étape': 'Vague de candidatures n°1', 'Début': today(8), 'Fin': today(18), 'Statut': 'À faire' },
              { 'Étape': 'Relances + réseau', 'Début': today(15), 'Fin': today(25), 'Statut': 'À faire' }, { 'Étape': 'Entretiens', 'Début': today(20), 'Fin': today(35), 'Statut': 'À faire' }],
            [['timeline', { name: 'Chronologie', date: 'Début', end: 'Fin', group: 'Statut' }], ['board', { name: 'Par statut', group: 'Statut' }], ['table', { name: 'Tableau', sort: ['Début', 'asc'] }]]))],
        },
        {
          id: 'tpl-job-pitch', cat: JOB, name: 'Pitch & compétences', icon: '🎤', title: 'Mon pitch',
          desc: 'Carte mentale de vos compétences et pitch de 60 secondes pour se présenter.',
          blocks: [b('callout', 'Commencez par remplir la carte, puis écrivez votre pitch à partir d’elle.', { icon: '🧠', color: 'bg-yellow' }),
            b('h2', '🗺️ Carte de mes compétences'), competences(),
            b('h2', '🎤 Mon pitch en 60 secondes'), b('number', '<b>Qui je suis</b> : « Je m’appelle …, je suis … »'), b('number', '<b>Mon parcours</b> : 1 ou 2 expériences marquantes'), b('number', '<b>Ce que j’apporte</b> : 2 compétences + 1 qualité, avec un exemple'), b('number', '<b>Ce que je cherche</b> : type de poste, contrat, date'),
            b('h2', '🔑 Mots-clés à placer'), b('table', '', { header: true, rows: [['Compétence', 'Preuve concrète'], ['Organisation', 'Gestion du planning de …'], ['Créativité', 'Création de …'], ['', '']] })],
        },
        {
          id: 'tpl-job-stage', cat: JOB, name: 'Checklist stage / alternance', icon: '🎓', title: 'Mon stage / alternance',
          desc: 'Toutes les démarches : école, convention, contrat, aides, premier jour.',
          blocks: [b('callout', 'Cochez au fur et à mesure : rien ne sera oublié.', { icon: '✅', color: 'bg-green' }),
            b('h2', '📚 Côté école'), b('todo', 'Dates de stage / rythme d’alternance validés'), b('todo', 'Tuteur·rice école identifié·e'),
            b('h2', '📝 Contrat'), b('todo', 'Convention de stage signée par les 3 parties'), b('todo', 'Contrat d’alternance (apprentissage ou professionnalisation) signé'), b('todo', 'Gratification / salaire vérifié'),
            b('h2', '💶 Aides possibles'), b('bullet', 'Aide au logement (CAF)'), b('bullet', 'Aides au permis ou au transport pour les alternants'),
            b('h2', '🚀 Premier jour'), b('todo', 'Horaires et adresse confirmés'), b('todo', 'Pièce d’identité + RIB + carte Vitale'), b('todo', 'Questions préparées pour le tuteur·rice'),
            b('table', '', { header: true, rows: [['Date clé', 'Quoi'], [fmtDate(today(14)), 'Début'], [fmtDate(today(60)), 'Point mi-parcours'], [fmtDate(today(120)), 'Rapport / soutenance']] })],
        },
      ];
    })(),
    // — Réseaux sociaux (inspirés de votre organisation Notion) —
    {
      id: 'tpl-planning', cat: 'Réseaux sociaux & contenu', name: 'Planning éditorial', icon: '🗓️', title: 'Planning éditorial', isDb: true, cover: { grad: GRADIENTS[3] },
      desc: 'Calendrier des publications, vue par état (Kanban) et modèle de fiche « article ».',
      blocks: [dbBlock(mkDb('Planning éditorial', [['Nom de l’article', 'title'], ['État', 'status', [['Idée', 'gray'], ['Brouillon', 'yellow'], ['À relire', 'purple'], ['Programmé', 'blue'], ['Publié', 'green'], ['Annulé', 'red']]], ['Date de publication', 'date'], ['Plateforme', 'multi', PLATF], ['Type de contenu', 'multi', [['Réel', 'red'], ['Carrousel', 'orange'], ['Story', 'gray'], ['Photo', 'yellow'], ['Texte', 'brown'], ['Vidéo', 'blue']]], ['Lien de la publication', 'url']],
        [{ 'Nom de l’article': 'Lancement de la collection', 'État': 'Programmé', 'Date de publication': today(2), 'Plateforme': ['Instagram', 'LinkedIn'], 'Type de contenu': ['Carrousel'], _icon: '🚀' },
          { 'Nom de l’article': 'Coulisses de l’atelier', 'État': 'Brouillon', 'Date de publication': today(5), 'Plateforme': ['Instagram', 'TikTok'], 'Type de contenu': ['Réel'], _icon: '🎬' },
          { 'Nom de l’article': 'Témoignage client', 'État': 'Idée', 'Date de publication': today(9), 'Plateforme': ['LinkedIn'], 'Type de contenu': ['Texte'], _icon: '💬' }],
        [['calendar', { name: 'Calendrier', date: 'Date de publication' }], ['table', { name: 'Tous les articles', sort: ['Date de publication', 'desc'] }], ['board', { name: 'Par état', group: 'État' }]],
        { templates: [{ name: 'Créer un article', icon: '📸', blocks: [b('h1', 'Aperçu de la demande'), b('p', 'Qui demande la publication et quel est l’objectif ?'), b('h1', 'Description du contenu'), b('p', 'Message, format, visuels, accroche…'), b('h1', 'Ressources nécessaires'), b('todo', 'Photos / vidéos'), b('todo', 'Validation du texte'), b('h1', 'État de la demande'), b('p', 'Prochaines étapes et échéance.')] }] }))],
    },
    {
      id: 'tpl-idees', cat: 'Réseaux sociaux & contenu', name: 'Banque d’idées', icon: '💡', title: 'Banque d’idées', isDb: true,
      desc: 'Toutes les idées de contenu, avec priorité, effort, pilier et plateforme.',
      blocks: [dbBlock(mkDb('Banque d’idées', [['Idée', 'title'], ['Accroche / description', 'text'], ['Statut', 'select', [['Pas commencé', 'gray'], ['En cours', 'yellow'], ['Prête à planifier', 'blue'], ['Planifiée', 'purple'], ['Réalisée', 'green'], ['Abandonnée', 'red']]], ['Priorité', 'select', [['Haute', 'red'], ['Moyenne', 'yellow'], ['Basse', 'gray']]], ['Effort', 'select', [['Rapide', 'green'], ['Moyen', 'yellow'], ['Long', 'red']]], ['Type', 'select', [['Réel', 'red'], ['Story', 'orange'], ['Publication', 'yellow'], ['Carrousel', 'green'], ['Série récurrente', 'blue']]], ['Pilier de contenu', 'select', [['Process', 'green'], ['Coulisses', 'orange'], ['Projets & rendus', 'blue'], ['Réflexion', 'purple'], ['Client / collab', 'pink']]], ['Plateforme', 'multi', PLATF], ['Inspiration', 'url']],
        [{ 'Idée': 'Visite de l’atelier en un plan-séquence', 'Accroche / description': 'Un seul plan de 30 s qui traverse l’atelier.', 'Statut': 'En cours', 'Priorité': 'Moyenne', 'Effort': 'Rapide', 'Type': 'Réel', 'Pilier de contenu': 'Coulisses', 'Plateforme': ['Instagram'] },
          { 'Idée': 'Avant / après d’un projet client', 'Statut': 'Pas commencé', 'Priorité': 'Haute', 'Effort': 'Moyen', 'Type': 'Carrousel', 'Pilier de contenu': 'Projets & rendus', 'Plateforme': ['Instagram', 'LinkedIn'] }],
        [['table', { name: 'Toutes les idées' }], ['board', { name: 'Par statut', group: 'Statut' }], ['gallery', { name: 'Galerie' }]]))],
    },
    {
      id: 'tpl-scripts', cat: 'Réseaux sociaux & contenu', name: 'Scripts vidéo', icon: '🎬', title: 'Scripts vidéo', isDb: true,
      desc: 'Scripts face caméra : hook, cible, durée, découpage plan par plan.',
      blocks: [dbBlock(mkDb('Scripts vidéo', [['Titre', 'title'], ['Statut', 'status', [['À valider', 'gray'], ['Prêt à tourner', 'blue'], ['Tourné', 'purple'], ['Publié', 'green']]], ['Cible', 'select'], ['Hook', 'text'], ['Type de hook', 'select', [['Promesse', 'green'], ['Problème', 'red'], ['Question', 'yellow'], ['Argent', 'brown'], ['Calendrier', 'pink']]], ['Durée (s)', 'number'], ['À vérifier', 'text'], ['Créé le', 'created']], [],
        [['table', { name: 'Tous les scripts' }], ['board', { name: 'Par statut', group: 'Statut' }]],
        { templates: [{ name: 'Script face caméra', icon: '🎬', blocks: [b('p', 'Format : face caméra + plans de coupe. Sous-titres animés.'), b('table', '', { header: true, rows: [['Temps', 'Image', 'Parole', 'Sous-titre'], ['0–4 s', 'Face caméra', 'Le hook…', ''], ['4–10 s', 'Plans de coupe', '', ''], ['10–20 s', '', '', ''], ['20–30 s', 'Face caméra', 'Appel à l’action', '']] }), b('h2', 'À vérifier avant de tourner'), b('todo', '')] }] }))],
    },
    // — Organisation —
    {
      id: 'tpl-projet', cat: 'Organisation', name: 'Suivi de projet', icon: '🚀', title: 'Nouveau projet', cover: { grad: GRADIENTS[1] }, desc: 'Objectif, tâches en Kanban avec priorités et échéances, notes.',
      blocks: [b('callout', 'Décrivez en une phrase ce que le projet doit accomplir.', { icon: '🎯', color: 'bg-blue' }), b('h2', '✅ Tâches'),
        dbBlock(mkDb('Tâches', [['Tâche', 'title'], ['Statut', 'status', [['À faire', 'gray'], ['En cours', 'blue'], ['Terminé', 'green']]], ['Priorité', 'select', [['Haute', 'red'], ['Moyenne', 'yellow'], ['Basse', 'gray']]], ['Responsable', 'person'], ['Échéance', 'date']],
          [{ 'Tâche': 'Définir le périmètre', 'Statut': 'Terminé', 'Priorité': 'Haute', 'Échéance': today(-3) }, { 'Tâche': 'Préparer le planning', 'Statut': 'En cours', 'Priorité': 'Moyenne', 'Échéance': today(2) }, { 'Tâche': 'Lancer la première version', 'Statut': 'À faire', 'Priorité': 'Haute', 'Échéance': today(10) }],
          [['board', { name: 'Kanban', group: 'Statut' }], ['table', { name: 'Tableau', sort: ['Échéance', 'asc'] }], ['calendar', { name: 'Calendrier', date: 'Échéance' }]])),
        b('h2', '📝 Notes'), b('bullet', 'Décisions prises, liens utiles…')],
    },
    {
      id: 'tpl-taches', cat: 'Organisation', name: 'Liste de tâches', icon: '✅', title: 'Mes tâches', desc: 'Cases à cocher pour aujourd’hui, la semaine et plus tard.',
      blocks: [b('h2', '☀️ Aujourd’hui'), b('todo', 'Répondre aux messages importants'), b('todo', 'Faire 30 minutes de sport'), b('todo'),
        b('h2', '📅 Cette semaine'), b('todo', 'Préparer la réunion de lundi'), b('todo', 'Faire les courses'),
        b('toggle', '💭 Un jour peut-être', { open: false }), b('bullet', 'Apprendre une nouvelle langue', { indent: 1 })],
    },
    {
      id: 'tpl-reunion', cat: 'Organisation', name: 'Compte rendu de réunion', icon: '🤝', title: 'Réunion du ' + fmtDate(today()), desc: 'Participants, ordre du jour, décisions et actions.',
      blocks: [b('p', '<b>Date :</b> ' + fmtDate(today())), b('p', '<b>Participants :</b> '), b('h2', 'Ordre du jour'), b('number', 'Point 1'), b('number', 'Point 2'), b('h2', 'Décisions'), b('bullet'), b('h2', 'Actions'), b('todo', 'Qui fait quoi, pour quand')],
    },
    {
      id: 'tpl-crm', cat: 'Organisation', name: 'Clients & contacts', icon: '👥', title: 'Clients', isDb: true, desc: 'Mini-CRM : contacts, statut commercial, montant, prochaine relance.',
      blocks: [dbBlock(mkDb('Clients', [['Nom', 'title'], ['Entreprise', 'text'], ['Étape', 'status', [['Prospect', 'gray'], ['Devis envoyé', 'yellow'], ['Signé', 'green'], ['Perdu', 'red']]], ['E-mail', 'email'], ['Téléphone', 'phone'], ['Montant', 'number', 'euro'], ['Prochaine relance', 'date']],
        [{ 'Nom': 'Camille Martin', 'Entreprise': 'Studio Lumière', 'Étape': 'Devis envoyé', 'Montant': 1200, 'Prochaine relance': today(3) }, { 'Nom': 'Léo Bernard', 'Entreprise': 'Les Petits Pois', 'Étape': 'Signé', 'Montant': 3400 }],
        [['table', { name: 'Tous', calc: { 'Montant': 'sum' } }], ['board', { name: 'Pipeline', group: 'Étape' }]]))],
    },
    {
      id: 'tpl-budget', cat: 'Organisation', name: 'Budget', icon: '💰', title: 'Budget', isDb: true, desc: 'Dépenses et revenus façon Excel, avec totaux automatiques.',
      blocks: [dbBlock(mkDb('Budget', [['Libellé', 'title'], ['Montant', 'number', 'euro'], ['Catégorie', 'select', [['Logement', 'blue'], ['Courses', 'green'], ['Transport', 'yellow'], ['Loisirs', 'pink'], ['Revenus', 'purple']]], ['Date', 'date'], ['Payé', 'checkbox']],
        [{ 'Libellé': 'Loyer', 'Montant': -650, 'Catégorie': 'Logement', 'Date': today(-5), 'Payé': true }, { 'Libellé': 'Courses', 'Montant': -84.5, 'Catégorie': 'Courses', 'Date': today(-2), 'Payé': true }, { 'Libellé': 'Salaire', 'Montant': 1800, 'Catégorie': 'Revenus', 'Date': today(-7), 'Payé': true }],
        [['table', { name: 'Tableau', calc: { 'Montant': 'sum', 'Libellé': 'count' }, sort: ['Date', 'desc'] }], ['board', { name: 'Par catégorie', group: 'Catégorie' }]]))],
    },
    // — Apprendre & créer —
    {
      id: 'tpl-cours', cat: 'Apprendre & créer', name: 'Notes de cours', icon: '🎓', title: 'Cours : ', cover: { grad: GRADIENTS[9] }, desc: 'Points clés, définitions, questions et révisions.',
      blocks: [b('p', '<b>Matière :</b> '), b('p', '<b>Date :</b> ' + fmtDate(today())), b('divider'),
        b('h2', 'Points clés'), b('bullet'), b('h2', 'Définitions'), b('callout', '<b>Terme</b> : définition…', { icon: '📌', color: 'bg-yellow' }),
        b('h2', 'Questions à poser'), b('todo'), b('toggle', 'À réviser', { open: true }), b('todo', 'Relire mes notes avant le prochain cours', { indent: 1 })],
    },
    {
      id: 'tpl-lecture', cat: 'Apprendre & créer', name: 'Liste de lecture', icon: '📚', title: 'Ma liste de lecture', isDb: true, desc: 'Livres avec statut, genres, note et lien, en galerie.',
      blocks: [dbBlock(mkDb('Ma liste de lecture', [['Titre', 'title'], ['Auteur', 'text'], ['Statut', 'status', [['À lire', 'gray'], ['En cours', 'blue'], ['Lu', 'green']]], ['Genres', 'multi', [['Roman', 'purple'], ['Essai', 'orange'], ['Science', 'blue'], ['Classique', 'brown']]], ['Note /5', 'number'], ['Lien', 'url']],
        [{ 'Titre': 'Le Petit Prince', 'Auteur': 'Antoine de Saint-Exupéry', 'Statut': 'Lu', 'Genres': ['Roman', 'Classique'], 'Note /5': 5, _icon: '🌹' }, { 'Titre': 'Sapiens', 'Auteur': 'Yuval Noah Harari', 'Statut': 'En cours', 'Genres': ['Essai', 'Science'], _icon: '🧠' }, { 'Titre': 'L’Étranger', 'Auteur': 'Albert Camus', 'Statut': 'À lire', 'Genres': ['Roman', 'Classique'], _icon: '☀️' }],
        [['gallery', { name: 'Galerie' }], ['table', { name: 'Tableau', calc: { 'Note /5': 'avg' } }], ['board', { name: 'Par statut', group: 'Statut' }]]))],
    },
    {
      id: 'tpl-journal', cat: 'Apprendre & créer', name: 'Journal', icon: '📔', title: 'Journal', isDb: true, cover: { grad: GRADIENTS[0] }, desc: 'Une fiche par jour, humeur et calendrier.',
      blocks: [dbBlock(mkDb('Journal', [['Jour', 'title'], ['Date', 'date'], ['Humeur', 'select', [['😄 Super', 'green'], ['🙂 Bien', 'blue'], ['😐 Moyen', 'yellow'], ['😞 Difficile', 'red']]]],
        [{ 'Jour': 'Aujourd’hui', 'Date': today(), 'Humeur': '🙂 Bien', _blocks: [b('h3', 'Ce qui s’est passé'), b('p'), b('h3', 'Gratitude'), b('bullet')] }],
        [['calendar', { name: 'Calendrier', date: 'Date' }], ['list', { name: 'Liste' }]],
        { templates: [{ name: 'Nouvelle journée', icon: '📔', blocks: [b('h3', 'Ce qui s’est passé'), b('p'), b('h3', 'Gratitude'), b('bullet'), b('h3', 'Demain'), b('todo')] }] }))],
    },
    {
      id: 'tpl-carte', cat: 'Apprendre & créer', name: 'Carte mentale', icon: '🧠', title: 'Carte mentale', desc: 'Un schéma libre pour organiser des idées.',
      blocks: [b('p', 'Double-cliquez dans le schéma pour ajouter une idée, glissez la flèche → pour relier.'), (() => {
        const n = (x, y, text, color, shape = 'round') => ({ id: uid(), x, y, w: 150, h: 56, shape, text, color });
        const c = n(300, 150, 'Sujet principal', 'blue', 'ellipse'), a = n(60, 40, 'Idée 1', 'green'), d = n(560, 40, 'Idée 2', 'orange'), e = n(60, 270, 'Idée 3', 'purple'), f = n(560, 270, 'Idée 4', 'pink');
        return b('diagram', '', { diagram: { h: 400, nodes: [c, a, d, e, f], edges: [a, d, e, f].map(x => ({ id: uid(), from: c.id, to: x.id, label: '' })) } });
      })()],
    },
    {
      id: 'tpl-strategie', cat: 'Réseaux sociaux & contenu', name: 'Stratégie de contenu', icon: '🧭', title: 'Stratégie de contenu', cover: { grad: GRADIENTS[5] },
      desc: 'Objectif, audience, piliers et rythme de publication sur une seule page.',
      blocks: [b('callout', '<b>Objectif du trimestre :</b> passer de 2 000 à 5 000 abonnés en publiant 3 fois par semaine.', { icon: '🎯', color: 'bg-pink' }),
        b('h2', '👥 Audience'), b('bullet', 'Qui sont-ils ? Âge, métier, centres d’intérêt'), b('bullet', 'Quel problème veulent-ils résoudre ?'),
        b('h2', '🧱 Piliers de contenu'), b('table', '', { header: true, rows: [['Pilier', 'Pourquoi', 'Exemple'], ['Coulisses', 'Créer du lien', 'Une journée à l’atelier'], ['Conseils', 'Apporter de la valeur', '3 erreurs à éviter'], ['Projets', 'Montrer le savoir-faire', 'Avant / après']] }),
        b('h2', '📆 Rythme'), b('todo', 'Lundi : carrousel conseil'), b('todo', 'Mercredi : réel coulisses'), b('todo', 'Vendredi : projet client'),
        b('quote', 'La régularité bat l’intensité.')],
    },
    {
      id: 'tpl-tournage', cat: 'Réseaux sociaux & contenu', name: 'Brief de tournage', icon: '🎥', title: 'Brief de tournage', cover: { grad: GRADIENTS[7] },
      desc: 'Lieu, matériel, liste des plans et checklist du jour J.',
      blocks: [b('p', '<b>Date :</b> ' + fmtDate(today(3)) + ' · <b>Lieu :</b> atelier · <b>Durée :</b> 2 h'),
        b('callout', 'Message principal : montrer le geste, pas le produit.', { icon: '💡', color: 'bg-yellow' }),
        b('h2', '🎬 Liste des plans'), b('table', '', { header: true, rows: [['#', 'Plan', 'Cadrage', 'Durée'], ['1', 'Mains qui préparent', 'Gros plan', '3 s'], ['2', 'Vue d’ensemble', 'Plan large', '4 s'], ['3', 'Face caméra', 'Plan poitrine', '15 s']] }),
        b('h2', '🎒 Matériel'), b('todo', 'Téléphone chargé + stockage libre', { checked: true }), b('todo', 'Micro-cravate'), b('todo', 'Lumière d’appoint'),
        b('toggle', 'Notes de montage', { open: false }), b('bullet', 'Sous-titres animés, musique douce', { indent: 1 })],
    },
    // — Travail & projets —
    {
      id: 'tpl-roadmap', cat: 'Travail & projets', name: 'Feuille de route', icon: '🗺️', title: 'Feuille de route', isDb: true, cover: { grad: GRADIENTS[1] },
      desc: 'Les grandes étapes par trimestre, en Kanban, tableau et calendrier.',
      blocks: [dbBlock(mkDb('Feuille de route', [['Étape', 'title'], ['Statut', 'status', [['Prévu', 'gray'], ['En cours', 'blue'], ['Livré', 'green']]], ['Trimestre', 'select', [['T1', 'purple'], ['T2', 'blue'], ['T3', 'green'], ['T4', 'orange']]], ['Priorité', 'select', [['Haute', 'red'], ['Moyenne', 'yellow'], ['Basse', 'gray']]], ['Échéance', 'date']],
        [{ 'Étape': 'Nouveau site web', 'Statut': 'En cours', 'Trimestre': 'T1', 'Priorité': 'Haute', 'Échéance': today(12), _icon: '🌐' }, { 'Étape': 'Boutique en ligne', 'Statut': 'Prévu', 'Trimestre': 'T2', 'Priorité': 'Haute', 'Échéance': today(60), _icon: '🛒' },
          { 'Étape': 'Newsletter mensuelle', 'Statut': 'Livré', 'Trimestre': 'T1', 'Priorité': 'Moyenne', 'Échéance': today(-4), _icon: '✉️' }, { 'Étape': 'Atelier découverte', 'Statut': 'Prévu', 'Trimestre': 'T3', 'Priorité': 'Basse', _icon: '🎨' }],
        [['board', { name: 'Par trimestre', group: 'Trimestre' }], ['table', { name: 'Tableau', sort: ['Échéance', 'asc'] }], ['calendar', { name: 'Calendrier', date: 'Échéance' }]]))],
    },
    {
      id: 'tpl-factures', cat: 'Travail & projets', name: 'Factures', icon: '🧾', title: 'Factures', isDb: true,
      desc: 'Suivi des factures : montant, échéance, payée ou en retard, total automatique.',
      blocks: [dbBlock(mkDb('Factures', [['Facture', 'title'], ['Client', 'text'], ['Montant', 'number', 'euro'], ['Statut', 'status', [['Brouillon', 'gray'], ['Envoyée', 'blue'], ['Payée', 'green'], ['En retard', 'red']]], ['Émise le', 'date'], ['Échéance', 'date']],
        [{ 'Facture': 'F-2026-014', 'Client': 'Studio Lumière', 'Montant': 1200, 'Statut': 'Payée', 'Émise le': today(-20), 'Échéance': today(10) }, { 'Facture': 'F-2026-015', 'Client': 'Les Petits Pois', 'Montant': 850, 'Statut': 'Envoyée', 'Émise le': today(-6), 'Échéance': today(24) },
          { 'Facture': 'F-2026-016', 'Client': 'Maison Verte', 'Montant': 430, 'Statut': 'En retard', 'Émise le': today(-40), 'Échéance': today(-10) }],
        [['table', { name: 'Toutes', calc: { 'Montant': 'sum' }, sort: ['Émise le', 'desc'] }], ['board', { name: 'Par statut', group: 'Statut' }]]))],
    },
    {
      id: 'tpl-objectifs', cat: 'Travail & projets', name: 'Objectifs du trimestre', icon: '🏆', title: 'Objectifs du trimestre', cover: { grad: GRADIENTS[4] },
      desc: '3 objectifs, des résultats mesurables et un point d’étape chaque mois.',
      blocks: [b('callout', 'Peu d’objectifs, mais clairs et mesurables.', { icon: '🏆', color: 'bg-green' }),
        b('h2', '1. Faire connaître la marque'), b('todo', '5 000 abonnés Instagram'), b('todo', '2 collaborations'),
        b('h2', '2. Augmenter les ventes'), b('todo', '30 commandes par mois'), b('todo', 'Panier moyen à 60 €'),
        b('h2', '3. Gagner du temps'), b('todo', 'Automatiser les devis', { checked: true }),
        b('h2', '📊 Points d’étape'), b('table', '', { header: true, rows: [['Mois', 'Avancement', 'Commentaire'], ['Mois 1', '30 %', ''], ['Mois 2', '', ''], ['Mois 3', '', '']] })],
    },
    {
      id: 'tpl-wiki', cat: 'Travail & projets', name: 'Wiki & procédures', icon: '📘', title: 'Wiki', cover: { grad: GRADIENTS[8] },
      desc: 'Toutes les infos utiles au même endroit : accès, procédures, contacts.',
      blocks: [b('callout', 'Bienvenue ! Cette page rassemble tout ce qu’il faut savoir pour travailler sereinement.', { icon: '👋', color: 'bg-blue' }),
        b('h2', '🔑 Accès et outils'), b('bullet', 'Messagerie : …'), b('bullet', 'Dossier partagé : …'),
        b('h2', '📋 Procédures'), b('toggle', 'Envoyer un devis', { open: true }), b('number', 'Dupliquer le modèle de devis', { indent: 1 }), b('number', 'Remplir et vérifier', { indent: 1 }), b('number', 'Envoyer en PDF', { indent: 1 }),
        b('toggle', 'Préparer une commande', { open: false }), b('p', 'Étapes…', { indent: 1 }),
        b('h2', '📞 Contacts utiles'), b('table', '', { header: true, rows: [['Qui', 'Rôle', 'Contact'], ['Camille', 'Comptabilité', 'camille@…'], ['Léo', 'Fournisseur', '06 …']] })],
    },
    {
      id: 'tpl-1on1', cat: 'Travail & projets', name: 'Point hebdo', icon: '🗒️', title: 'Point hebdo du ' + fmtDate(today()),
      desc: 'Ce qui a avancé, ce qui bloque, les priorités de la semaine.',
      blocks: [b('h3', '✅ Ce qui a avancé'), b('bullet'), b('h3', '🚧 Ce qui bloque'), b('bullet'), b('h3', '🎯 Priorités de la semaine'), b('todo'), b('todo'),
        b('callout', 'Prochain point : ' + fmtDate(today(7)), { icon: '📅', color: 'bg-gray' })],
    },
    // — Vie perso —
    {
      id: 'tpl-semaine', cat: 'Vie perso', name: 'Planning de la semaine', icon: '🗓️', title: 'Ma semaine', cover: { grad: GRADIENTS[0] },
      desc: 'Les 3 priorités de la semaine puis une liste par jour.',
      blocks: [b('callout', '<b>Mes 3 priorités :</b> 1. … 2. … 3. …', { icon: '⭐', color: 'bg-yellow' }),
        ...['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'].flatMap(d => [b('h3', d), b('todo')]), b('h3', 'Week-end 🌿'), b('bullet', 'Se reposer')],
    },
    {
      id: 'tpl-habitudes', cat: 'Vie perso', name: 'Suivi d’habitudes', icon: '🌱', title: 'Mes habitudes', isDb: true,
      desc: 'Cochez chaque jour vos habitudes ; le % de réussite se calcule tout seul.',
      blocks: [dbBlock(mkDb('Mes habitudes', [['Jour', 'title'], ['Date', 'date'], ['Sport', 'checkbox'], ['Lecture', 'checkbox'], ['Méditation', 'checkbox'], ['Verres d’eau', 'number']],
        [0, -1, -2, -3].map((d, i) => ({ 'Jour': new Date(today(d) + 'T00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' }), 'Date': today(d), 'Sport': i % 2 === 0, 'Lecture': i !== 2, 'Méditation': i < 2, 'Verres d’eau': 6 + i })),
        [['table', { name: 'Tableau', calc: { 'Sport': 'pct', 'Lecture': 'pct', 'Méditation': 'pct', 'Verres d’eau': 'avg' }, sort: ['Date', 'desc'] }], ['calendar', { name: 'Calendrier', date: 'Date' }]]))],
    },
    {
      id: 'tpl-recettes', cat: 'Vie perso', name: 'Recettes', icon: '🍳', title: 'Mes recettes', isDb: true,
      desc: 'Une galerie de recettes avec temps, difficulté, ingrédients et étapes.',
      blocks: [dbBlock(mkDb('Mes recettes', [['Recette', 'title'], ['Catégorie', 'select', [['Entrée', 'green'], ['Plat', 'orange'], ['Dessert', 'pink']]], ['Temps (min)', 'number'], ['Difficulté', 'select', [['Facile', 'green'], ['Moyen', 'yellow'], ['Difficile', 'red']]], ['Note /5', 'number']],
        [{ 'Recette': 'Tarte aux pommes', 'Catégorie': 'Dessert', 'Temps (min)': 60, 'Difficulté': 'Facile', 'Note /5': 5, _icon: '🥧', _blocks: [b('h3', 'Ingrédients'), b('bullet', '1 pâte brisée'), b('bullet', '4 pommes'), b('h3', 'Étapes'), b('number', 'Préchauffer le four à 180 °C')] },
          { 'Recette': 'Risotto aux champignons', 'Catégorie': 'Plat', 'Temps (min)': 40, 'Difficulté': 'Moyen', 'Note /5': 4, _icon: '🍄' },
          { 'Recette': 'Salade grecque', 'Catégorie': 'Entrée', 'Temps (min)': 15, 'Difficulté': 'Facile', _icon: '🥗' }],
        [['gallery', { name: 'Galerie' }], ['board', { name: 'Par catégorie', group: 'Catégorie' }], ['table', { name: 'Tableau' }]],
        { templates: [{ name: 'Nouvelle recette', icon: '🍽️', blocks: [b('h3', 'Ingrédients'), b('bullet'), b('h3', 'Étapes'), b('number'), b('callout', 'Astuce du chef…', { icon: '👩‍🍳', color: 'bg-orange' })] }] }))],
    },
    {
      id: 'tpl-voyage', cat: 'Vie perso', name: 'Préparer un voyage', icon: '✈️', title: 'Voyage à Lisbonne', cover: { grad: GRADIENTS[4] },
      desc: 'Infos pratiques, itinéraire jour par jour, valise et budget.',
      blocks: [b('callout', '<b>Dates :</b> ' + fmtDate(today(30)) + ' → ' + fmtDate(today(35)) + '<br><b>Logement :</b> adresse, code d’accès…', { icon: '🧳', color: 'bg-blue' }),
        b('h2', '🗺️ Itinéraire'), b('table', '', { header: true, rows: [['Jour', 'Programme', 'À réserver'], ['J1', 'Arrivée, quartier de l’Alfama', ''], ['J2', 'Belém et pâtisseries', 'Musée'], ['J3', 'Sintra', 'Train']] }),
        b('h2', '🎒 Valise'), b('toggle', 'Vêtements', { open: true }), b('todo', 'Chaussures confortables', { indent: 1 }), b('todo', 'Veste légère', { indent: 1 }),
        b('toggle', 'Papiers', { open: true }), b('todo', 'Carte d’identité', { indent: 1 }), b('todo', 'Billets', { indent: 1 }),
        b('h2', '💶 Budget'), b('bullet', 'Transport : …'), b('bullet', 'Logement : …')],
    },
    {
      id: 'tpl-courses', cat: 'Vie perso', name: 'Liste de courses', icon: '🛒', title: 'Courses',
      desc: 'Une liste rangée par rayon, à cocher au magasin.',
      blocks: [b('h3', '🥦 Fruits & légumes'), b('todo', 'Pommes'), b('todo', 'Salade'), b('h3', '🧀 Frais'), b('todo', 'Yaourts'), b('todo', 'Beurre'),
        b('h3', '🥫 Épicerie'), b('todo', 'Pâtes'), b('todo', 'Café'), b('h3', '🧴 Maison'), b('todo', 'Liquide vaisselle')],
    },
    {
      id: 'tpl-films', cat: 'Vie perso', name: 'Films & séries', icon: '🍿', title: 'Films & séries', isDb: true,
      desc: 'Ce que vous voulez voir, ce que vous regardez et vos notes.',
      blocks: [dbBlock(mkDb('Films & séries', [['Titre', 'title'], ['Type', 'select', [['Film', 'blue'], ['Série', 'purple'], ['Documentaire', 'green']]], ['Statut', 'status', [['À voir', 'gray'], ['En cours', 'yellow'], ['Vu', 'green']]], ['Note /5', 'number'], ['Où le voir', 'text']],
        [{ 'Titre': 'Le Fabuleux Destin d’Amélie Poulain', 'Type': 'Film', 'Statut': 'Vu', 'Note /5': 5, _icon: '🎞️' }, { 'Titre': 'Une série à découvrir', 'Type': 'Série', 'Statut': 'En cours', _icon: '📺' }, { 'Titre': 'Un documentaire nature', 'Type': 'Documentaire', 'Statut': 'À voir', _icon: '🌍' }],
        [['board', { name: 'Par statut', group: 'Statut' }], ['gallery', { name: 'Galerie' }], ['table', { name: 'Tableau', calc: { 'Note /5': 'avg' } }]]))],
    },
    {
      id: 'tpl-sport', cat: 'Vie perso', name: 'Journal sportif', icon: '🏃', title: 'Journal sportif', isDb: true,
      desc: 'Chaque séance avec durée et ressenti ; total des minutes automatique.',
      blocks: [dbBlock(mkDb('Journal sportif', [['Séance', 'title'], ['Date', 'date'], ['Activité', 'select', [['Course', 'orange'], ['Vélo', 'blue'], ['Yoga', 'purple'], ['Muscu', 'red']]], ['Durée (min)', 'number'], ['Ressenti', 'select', [['😄 Top', 'green'], ['🙂 Bien', 'blue'], ['😓 Dur', 'red']]]],
        [{ 'Séance': 'Footing au parc', 'Date': today(-1), 'Activité': 'Course', 'Durée (min)': 35, 'Ressenti': '🙂 Bien' }, { 'Séance': 'Yoga du matin', 'Date': today(-3), 'Activité': 'Yoga', 'Durée (min)': 25, 'Ressenti': '😄 Top' }, { 'Séance': 'Sortie vélo', 'Date': today(-5), 'Activité': 'Vélo', 'Durée (min)': 70, 'Ressenti': '😓 Dur' }],
        [['calendar', { name: 'Calendrier', date: 'Date' }], ['table', { name: 'Tableau', calc: { 'Durée (min)': 'sum' }, sort: ['Date', 'desc'] }]]))],
    },
    // — Apprendre & créer (suite) —
    {
      id: 'tpl-revision', cat: 'Apprendre & créer', name: 'Fiches de révision', icon: '🃏', title: 'Révisions', cover: { grad: GRADIENTS[3] },
      desc: 'Questions dépliables pour vous tester : cliquez pour voir la réponse.',
      blocks: [b('callout', 'Lisez la question, répondez dans votre tête, puis dépliez pour vérifier.', { icon: '🧠', color: 'bg-purple' }),
        b('toggle', 'Qu’est-ce qu’une base de données ?', { open: true }), b('p', 'Un tableau où chaque ligne est une fiche avec des propriétés.', { indent: 1 }),
        b('toggle', 'Quelle est la capitale du Portugal ?', { open: false }), b('p', 'Lisbonne.', { indent: 1 }),
        b('toggle', 'Combien de côtés a un hexagone ?', { open: false }), b('p', 'Six.', { indent: 1 }),
        b('h3', 'À revoir'), b('todo')],
    },
    {
      id: 'tpl-portfolio', cat: 'Apprendre & créer', name: 'Portfolio', icon: '🎨', title: 'Portfolio', cover: { grad: GRADIENTS[6] },
      desc: 'Présentation, projets en galerie et coordonnées.',
      blocks: [b('quote', 'Designer graphique — je crée des identités visuelles simples et chaleureuses.'),
        b('h2', 'Projets'),
        dbBlock(mkDb('Projets', [['Projet', 'title'], ['Année', 'number'], ['Type', 'multi', [['Logo', 'orange'], ['Affiche', 'blue'], ['Web', 'green']]], ['Lien', 'url']],
          [{ 'Projet': 'Identité Studio Lumière', 'Année': 2026, 'Type': ['Logo'], _icon: '💡' }, { 'Projet': 'Affiche festival', 'Année': 2025, 'Type': ['Affiche'], _icon: '🎪' }, { 'Projet': 'Site Maison Verte', 'Année': 2025, 'Type': ['Web'], _icon: '🌿' }],
          [['gallery', { name: 'Galerie' }]])),
        b('h2', 'Contact'), b('p', '✉️ bonjour@… · 📸 @…')],
    },
  ];
}

// ---------- Recherche ----------
function docText(blocks) {
  return (blocks || []).map(b => b.db ? [b.db.title, ...b.db.rows.map(r => rowTitle(b.db, r))].filter(Boolean).join(' · ') : b.type === 'table' ? b.rows.flat().map(textOfHtml).join(' ') : b.type === 'diagram' ? b.diagram.nodes.map(n => n.text).join(' ') : b.text || b.caption || '').filter(Boolean).join('\n');
}
function hl(text, q) {
  const i = q ? fold(text).indexOf(q) : -1;
  return i < 0 ? text : [text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
}
function openSearch() {
  let res = [], act = 0, close;
  const inp = h('input', { class: 'search-in', placeholder: 'Rechercher dans vos pages et vos fiches…', 'aria-label': 'Rechercher' });
  const list = h('div', { class: 'results' });
  const all = () => {
    const items = livePages().map(pg => ({ title: pg.title, icon: pg.icon, sub: pathOf(pg), body: () => docText(pg.blocks), go: () => openPage(pg.id) }));
    eachDb((db, b, host) => { if (host.trashed) return; db.rows.forEach(r => items.push({ title: rowTitle(db, r), icon: r.icon || '📄', sub: 'Fiche de « ' + (db.title || 'Sans titre') + ' »', body: () => db.columns.map(c => cellText(c, r.cells[c.id], r)).join(' · ') + '\n' + docText(r.blocks), go: () => openRow(r.id) })); });
    return items;
  };
  const items = all();
  const draw = () => {
    const q = fold(inp.value.trim());
    res = items.map(it => {
      if (!q) return { it, score: 1 };
      if (fold(it.title || 'Sans titre').includes(q)) return { it, score: 3 };
      const body = it.body(), i = fold(body).indexOf(q);
      return i < 0 ? null : { it, body, i, score: 2 };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 40);
    act = Math.max(0, Math.min(act, res.length - 1));
    list.replaceChildren(...(res.length ? res.map((r, k) => {
      let sub = r.it.sub;
      if (r.body != null) { const s = Math.max(0, r.i - 40); sub = hl((s ? '…' : '') + r.body.slice(s, r.i + q.length + 80).replace(/\n/g, ' '), q); }
      return h('button', { class: 'res' + (k === act ? ' on' : ''), onclick: () => { close(); r.it.go(); }, onmousemove: () => { if (act !== k) { act = k; draw(); } } },
        h('span', {}, r.it.icon || '📄'), h('span', { class: 'res-main' }, h('span', { class: 'res-t' }, hl(r.it.title || 'Sans titre', q)), h('span', { class: 'res-s' }, sub)));
    }) : [h('div', { class: 'pad muted' }, 'Aucun résultat')]));
    list.children[act]?.scrollIntoView?.({ block: 'nearest' });
  };
  inp.oninput = () => { act = 0; draw(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (res.length) { act = (act + (e.key === 'ArrowDown' ? 1 : -1) + res.length) % res.length; draw(); } }
    if (e.key === 'Enter' && res[act]) { close(); res[act].it.go(); }
  };
  close = modal('Rechercher', h('div', {}, inp, list), null, 'wide');
  draw(); inp.focus();
}

// ---------- Corbeille ----------
function openTrash() {
  let close;
  const roots = S.pages.filter(x => x.trashed && x.trashRoot === x.id).sort((a, b) => b.trashed.localeCompare(a.trashed));
  const body = h('div', {},
    roots.length ? roots.map(pg => h('div', { class: 'tpl' },
      h('div', { class: 'tpl-ic' }, pg.icon || '📄'),
      h('div', { class: 'tpl-main' }, h('b', {}, pg.title || 'Sans titre'), h('div', { class: 'muted small' }, 'Supprimée le ' + fmtDateTime(pg.trashed) + (descendants(pg.id).length > 1 ? ` · avec ${descendants(pg.id).length - 1} sous-page(s)` : ''))),
      h('button', { class: 'btn', onclick: () => { restorePage(pg); close(); openTrash(); } }, 'Restaurer'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await dialog({ title: 'Supprimer définitivement ?', text: `« ${pg.title || 'Sans titre'} » sera effacée pour de bon.`, ok: 'Supprimer définitivement', danger: true })) return;
        const ids = descendants(pg.id); S.pages = S.pages.filter(x => !ids.includes(x.id)); save(); close(); openTrash(); renderSidebar();
      } }, 'Supprimer'))) : h('p', { class: 'muted' }, 'La corbeille est vide.'),
    roots.length ? h('div', { class: 'dlg-btns' }, h('button', { class: 'btn danger', onclick: async () => {
      if (!await dialog({ title: 'Vider la corbeille ?', text: `${roots.length} page(s) seront effacées pour de bon.`, ok: 'Vider', danger: true })) return;
      S.pages = S.pages.filter(x => !x.trashed); save(); close(); renderSidebar();
    } }, 'Vider la corbeille')) : null);
  close = modal('Corbeille', body, null, 'wide');
}

// ---------- Réglages, sauvegardes et import ----------
function applyTheme() {
  const t = S.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : S.theme;
  document.documentElement.dataset.theme = t;
  $('#btn-theme').replaceChildren(ico(t === 'dark' ? 'sun' : 'moon'), h('span', { class: 'lbl' }, t === 'dark' ? 'Thème clair' : 'Thème sombre'));
}
function openSettings() {
  let close;
  const body = h('div', { class: 'settings' },
    h('div', { class: 'mh' }, 'Apparence'),
    h('div', { class: 'row' }, ['light', 'dark', 'auto'].map(t => h('button', { class: 'btn' + (S.theme === t ? ' primary' : ''), onclick: () => { S.theme = t; applyTheme(); save(); close(); openSettings(); } }, { light: '☀️ Clair', dark: '🌙 Sombre', auto: '🖥 Comme le Mac' }[t]))),
    window.SIMPLY_STATIC ? [h('div', { class: 'mh' }, 'Vos données'),
      h('p', { class: 'muted small' }, 'Version en ligne : vos pages sont enregistrées dans ce navigateur, sur cet appareil uniquement. Personne d’autre ne les voit. Téléchargez régulièrement une sauvegarde (plus bas) : vider les données du navigateur les effacerait.')]
    : [h('div', { class: 'mh' }, 'Comptes'), accountsSection(() => close()), h('div', { class: 'mh' }, 'Accès depuis le Wi-Fi'), networkSection()],
    h('div', { class: 'mh' }, 'Assistant IA'),
    h('button', { class: 'mi', onclick: () => { close(); openAiSettings(); } }, h('span', { class: 'mi-ic' }, '✨'), 'Choisir l’IA (Claude ou IA locale) et la clé API'),
    h('div', { class: 'mh' }, 'Importer'),
    window.SIMPLY_STATIC ? null : h('button', { class: 'mi', onclick: () => { close(); importNotionFromServer(); } }, h('span', { class: 'mi-ic' }, 'N'), 'Importer mon export Notion (dossier « import »)'),
    h('button', { class: 'mi', onclick: async () => { close(); const f = await pickFile('.json'); if (f) try { importNotion(JSON.parse(await f.text())); } catch { toast('Fichier illisible'); } } }, h('span', { class: 'mi-ic' }, '{ }'), 'Importer un fichier d’export Notion (.json)'),
    h('button', { class: 'mi', onclick: () => { close(); importMarkdown(); } }, h('span', { class: 'mi-ic' }, 'M↓'), 'Importer des pages Markdown (.md)'),
    h('div', { class: 'mh' }, 'Sauvegardes'),
    h('button', { class: 'mi', onclick: () => download('simply-sauvegarde-' + today() + '.json', JSON.stringify(S), 'application/json') }, h('span', { class: 'mi-ic' }, '⬇'), 'Télécharger une sauvegarde complète'),
    h('button', { class: 'mi', onclick: async () => {
      const f = await pickFile('.json'); if (!f) return;
      let d; try { d = JSON.parse(await f.text()); } catch { return toast('Fichier illisible'); }
      if (!d || !Array.isArray(d.pages)) return toast('Ce fichier n’est pas une sauvegarde Simply.');
      if (!await dialog({ title: 'Restaurer cette sauvegarde ?', text: `Tout le contenu actuel sera remplacé par la sauvegarde (${d.pages.length} pages). ⌘Z permet d’annuler.`, ok: 'Restaurer', danger: true })) return;
      S = d; migrate(); save(); close(); applyTheme(); openPage(S.lastPage);
    } }, h('span', { class: 'mi-ic' }, '⬆'), 'Restaurer une sauvegarde…'),
    window.SIMPLY_STATIC ? null : h('p', { class: 'muted small' }, 'Vos données sont dans le dossier « donnees » de Simply. Une copie de secours est faite à chaque lancement.'),
    h('div', { class: 'mh' }, 'Raccourcis'),
    h('div', { class: 'keys' }, [['⌘K', 'Rechercher'], ['⌘Z / ⇧⌘Z', 'Annuler / rétablir'], ['/', 'Insérer un bloc'], ['⌘B ⌘I ⌘U', 'Gras, italique, souligné'], ['⌘E', 'Code'], ['⌘K (texte sélectionné)', 'Lien'], ['Tab / ⇧Tab', 'Décaler un bloc'], ['⌘\\', 'Masquer la barre latérale'], ['⌘J', 'Assistant IA'], ['# - 1. [] > ---', 'Raccourcis d’écriture']].map(([k, l]) => h('div', {}, h('kbd', {}, k), ' ', l))));
  close = modal('Réglages', body, null, 'wide');
}
async function importMarkdown() {
  const inp = h('input', { type: 'file', accept: '.md,.markdown,.txt', multiple: true, style: 'display:none' });
  inp.onchange = async () => {
    let first = null;
    for (const f of inp.files) {
      const md = await f.text();
      const m = md.match(/^#\s+(.+)\n/);
      const pg = createPage(null, m ? m[1].trim() : f.name.replace(/\.(md|markdown|txt)$/i, ''), { blocks: mdToBlocks(m ? md.slice(m[0].length) : md) });
      first ||= pg;
    }
    inp.remove();
    if (first) { save(); openPage(first.id); toast(`${inp.files.length} page(s) importée(s)`); }
  };
  document.body.append(inp); inp.click();
}
async function importNotionFromServer() {
  const r = await fetch('/api/notion-import');
  if (!r.ok) return toast('Aucun export Notion trouvé dans le dossier « import ».');
  importNotion(await r.json());
}
// Transforme l'export Notion (pages, bases, fiches) en pages Simply, en gardant la même organisation.
function importNotion(data) {
  if (!data || !Array.isArray(data.databases)) return toast('Ce fichier n’est pas un export Notion reconnu.');
  const TYPE = { title: 'title', text: 'text', rich_text: 'text', number: 'number', select: 'select', multi_select: 'multi', status: 'status', date: 'date', url: 'url', email: 'email', phone_number: 'phone', checkbox: 'checkbox', person: 'person', people: 'person', created_time: 'created', relation: 'relation' };
  const VIEW = { table: 'table', board: 'board', calendar: 'calendar', gallery: 'gallery', list: 'list' };
  const col = c => COLORS.includes(c) ? c : 'gray';
  const cleanMd = md => String(md || '').replace(/<database[^>]*>[\s\S]*?<\/database>/g, '').replace(/<page url[^>]*>[\s\S]*?<\/page>/g, '');
  const pageMap = {}, dbMap = {}, rowMap = {};
  const pending = [];
  const pages = data.pages || [];
  const root = createPage(null, 'Import Notion', { icon: '📥', blocks: [newBlock('p', 'Contenu importé depuis Notion le ' + fmtDate(today()) + '.')] });
  // Pages
  for (const np of pages) {
    const pg = createPage(root.id, np.title || 'Sans titre', { icon: np.icon || '📄', blocks: mdToBlocks(cleanMd(np.markdown)) });
    pageMap[np.id?.replace(/-/g, '')] = pg;
    root.blocks.push({ id: uid(), type: 'page', pageId: pg.id });
  }
  for (const np of pages) { const pg = pageMap[np.id?.replace(/-/g, '')]; const par = np.parentId && pageMap[np.parentId.replace(/-/g, '')]; if (par) reparentQuiet(pg, par); }
  // Bases
  for (const nd of data.databases) {
    const db = { id: uid(), title: nd.title || 'Sans titre', icon: nd.icon || null, columns: [], rows: [], views: [], templates: [] };
    const byName = {};
    for (const c of nd.columns || []) {
      let t = TYPE[c.type] || 'text';
      const nc = { id: uid(), name: c.name, type: t };
      if (isChoice(t)) nc.options = (c.options || []).map(o => opt(o.name, col(o.color)));
      if (t === 'relation') { nc._target = c.relation || c.dataSourceUrl || null; }
      db.columns.push(nc); byName[c.name] = nc;
    }
    if (!db.columns.some(c => c.type === 'title')) db.columns.unshift({ id: uid(), name: 'Nom', type: 'title' });
    const tc = titleCol(db);
    for (const nr of nd.rows || []) {
      const r = newRowObj(db);
      r.created = nr.createdTime ? new Date(nr.createdTime.replace(' ', 'T')).toISOString() : r.created;
      r.icon = nr.icon || null;
      r.blocks = mdToBlocks(cleanMd(nr.markdown));
      r.cells[tc.id] = nr.title || '';
      for (const [k, v] of Object.entries(nr.props || {})) {
        const c = byName[k] || db.columns.find(x => fold(x.name) === fold(k));
        if (!c || c.type === 'title' || c.type === 'created' || isBlank(v)) continue;
        if (isChoice(c.type)) { const ids = [].concat(v).filter(Boolean).map(n => ensureOpt(c, String(n)).id); r.cells[c.id] = c.type === 'multi' ? ids : ids[0]; }
        else if (c.type === 'relation') pending.push({ r, c, ids: [].concat(v) });
        else if (c.type === 'number') r.cells[c.id] = Number(v);
        else if (c.type === 'date') r.cells[c.id] = String(typeof v === 'object' ? v.start || '' : v).slice(0, 10) || null;
        else if (c.type === 'checkbox') r.cells[c.id] = v === true || v === '__YES__';
        else r.cells[c.id] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      rowMap[(nr.id || '').replace(/-/g, '')] = r.id;
      db.rows.push(r);
    }
    for (const nv of nd.views || []) {
      const v = newView(VIEW[nv.type] || 'table', db);
      v.name = nv.name || v.name;
      if (nv.groupBy && byName[nv.groupBy]) v.groupBy = byName[nv.groupBy].id;
      if (nv.calendarBy && byName[nv.calendarBy]) v.dateCol = byName[nv.calendarBy].id;
      v.sorts = (nv.sorts || []).filter(s => byName[s.property]).map(s => ({ col: byName[s.property].id, dir: s.direction === 'descending' ? 'desc' : 'asc' }));
      if (v.type === 'calendar' && !v.dateCol) ensureDateCol(db, v);
      db.views.push(v);
    }
    if (!db.views.length) db.views.push(newView('table', db));
    db.view = db.views[0].id;
    if (nd.templateMarkdown) { const t = { id: uid(), name: 'Modèle par défaut', icon: '📄', blocks: mdToBlocks(cleanMd(nd.templateMarkdown)), cells: {} }; db.templates.push(t); db.defaultTpl = t.id; }
    dbMap[(nd.id || '').replace(/-/g, '')] = db;
    // La base devient une page (comme dans Notion), rangée dans sa page parente.
    const parent = nd.parentPageId && pageMap[nd.parentPageId.replace(/-/g, '')];
    const pg = createPage(parent ? parent.id : root.id, db.title, { icon: db.icon || '🗂️', blocks: [{ id: uid(), type: 'db', db }] });
    pg.isDb = true;
    (parent || root).blocks.push({ id: uid(), type: 'page', pageId: pg.id });
  }
  // Relations : on relie les fiches importées entre elles quand c'est possible.
  for (const { r, c, ids } of pending) {
    const mapped = ids.map(x => rowMap[String(x).split('/').pop().replace(/-/g, '')]).filter(Boolean);
    if (mapped.length) {
      if (!c.relation) { const target = Object.values(dbMap).find(d => d.rows.some(x => x.id === mapped[0])); if (target) c.relation = target.id; }
      r.cells[c.id] = mapped;
    }
  }
  // Relation vers une base absente : la colonne devient du texte.
  Object.values(dbMap).forEach(db => db.columns.forEach(c => { delete c._target; if (c.type === 'relation' && !c.relation) { c.type = 'text'; db.rows.forEach(r => { if (Array.isArray(r.cells[c.id])) r.cells[c.id] = ''; }); } }));
  save(); openPage(root.id);
  const nRows = Object.values(dbMap).reduce((a, d) => a + d.rows.length, 0);
  toast(`Import terminé : ${pages.length} page(s), ${Object.keys(dbMap).length} base(s), ${nRows} fiche(s)`);
}
function reparentQuiet(pg, parent) {
  const old = page(pg.parentId);
  if (old) old.blocks = old.blocks.filter(b => !(b.type === 'page' && b.pageId === pg.id));
  pg.parentId = parent.id;
  parent.blocks.push({ id: uid(), type: 'page', pageId: pg.id });
}

// ---------- Premier lancement et mises à jour du format ----------
function seed() {
  S = { version: 2, theme: 'auto', pages: [], templates: [], favorites: [], lastPage: null };
  const b = (type, html = '', extra) => Object.assign(newBlock(type, html), extra || {});
  const welcome = createPage(null, 'Bienvenue dans Simply', {
    icon: '👋', blocks: [
      b('callout', 'Simply est votre espace personnel : pages, bases de données, modèles et schémas. Tout est enregistré automatiquement <b>sur cet ordinateur</b>, sans compte ni Internet.', { icon: '✨', color: 'bg-blue' }),
      b('h2', 'Pour commencer'),
      b('todo', 'Tapez <b>/</b> au début d’une ligne pour insérer un titre, une liste, une image, un schéma, une base de données…'),
      b('todo', 'Sélectionnez du texte pour le mettre en <b>gras</b>, en <i>italique</i>, en <span class="tc-red">couleur</span> ou en faire un lien'),
      b('todo', 'Collez une image (⌘V) ou glissez-la dans la page'),
      b('todo', 'Essayez un modèle : bouton « 🧩 Modèles » à gauche'),
      b('todo', 'Cherchez partout avec ⌘K · annulez avec ⌘Z'),
      b('toggle', 'Raccourcis d’écriture', { open: false }),
      b('bullet', '<code>#</code> + espace : grand titre (<code>##</code> moyen, <code>###</code> petit)', { indent: 1 }),
      b('bullet', '<code>-</code> + espace : liste à puces · <code>1.</code> + espace : liste numérotée', { indent: 1 }),
      b('bullet', '<code>[]</code> + espace : case à cocher · <code>></code> + espace : bloc dépliable', { indent: 1 }),
      b('bullet', '<code>---</code> : séparateur · <code>```</code> : bloc de code · Tab : décaler', { indent: 1 }),
    ],
  });
  welcome.cover = { grad: GRADIENTS[1] };
  const tpl = builtins().find(t => t.id === 'tpl-projet');
  const ex = createPage(welcome.id, 'Projet exemple', { icon: tpl.icon, blocks: freshBlocks(tpl.blocks) });
  welcome.blocks.push(b('h2', 'Exemple'), { id: uid(), type: 'page', pageId: ex.id });
  S.lastPage = welcome.id;
  return S;
}
function migrate() {
  S.version = 2;
  S.templates ||= []; S.favorites ||= [];
  const fixBlocks = blocks => (blocks || []).forEach(b => {
    if (TEXT.has(b.type) && b.type !== 'code' && b.html == null) b.html = esc(b.text || '');
    if (b.type === 'db' && b.db) { migrateDb(b.db); b.db.rows.forEach(r => fixBlocks(r.blocks)); }
  });
  S.pages.forEach(p => fixBlocks(p.blocks));
  // L'application s'appelait « Feuillet » : on met à jour la page d'accueil d'origine.
  S.pages.forEach(p => {
    if (p.title !== 'Bienvenue dans Feuillet') return;
    p.title = 'Bienvenue dans Simply';
    p.blocks.forEach(b => { if (b.html) setHtml(b, b.html.replace(/Feuillet/g, 'Simply')); });
  });
  S.templates.forEach(t => fixBlocks(t.blocks));
}

// ---------- Démarrage ----------
async function boot() {
  try {
    const me = await (await fetch('/api/me')).json();
    if (me.accounts && !me.user) return showLogin(me.signup);
    ME = me.user;
    if (ME) $('.side-foot').prepend(h('button', { class: 'side-btn acc-me', title: 'Se déconnecter', onclick: logout }, h('span', { class: 'acc-av sm' }, ME.name[0].toUpperCase()), h('span', { class: 'lbl' }, ME.name), ico('log-out')));
  } catch { /* ancien serveur sans comptes : on continue comme avant */ }
  try {
    const r = await fetch('/api/data');
    if (!r.ok) throw 0;
    S = await r.json();
  } catch {
    // Ne jamais repartir de zéro si les données n'ont pas pu être lues : on risquerait de les écraser.
    document.body.innerHTML = '<div class="empty">⚠ Impossible de lire vos données. Vérifiez que Simply est bien lancé (fenêtre Terminal ouverte), puis rechargez la page.</div>';
    return;
  }
  if (!S) { seed(); save(); } else { migrate(); setStatus('✓ Enregistré'); }
  histReset();
  applyTheme();
  const m = location.hash.match(/^#\/(page|fiche)\/(\w+)/);
  if (m && m[1] === 'fiche' && findRow(m[2])) { nav = { page: findRow(m[2]).host.id, row: m[2] }; history.replaceState(nav, ''); renderAll(); }
  else { const id = m && page(m[2]) ? m[2] : S.lastPage; openPage(id); history.replaceState(nav, '', '#/page/' + nav.page); }
}

$$('[data-ico]').forEach(el => el.prepend(ico(el.dataset.ico)));
$('#btn-search').onclick = openSearch;
$('#btn-tpl').onclick = () => openTemplates();
$('#btn-ai').onclick = () => toggleAi();
$('#btn-trash').onclick = openTrash;
$('#btn-settings').onclick = openSettings;
$('#btn-new').onclick = e => newPageMenu(e.currentTarget);
$('#btn-new2').onclick = $('#btn-compose').onclick = () => newPage();
$('#btn-theme').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark'; S.theme = dark ? 'light' : 'dark'; applyTheme(); save(); };
$('#btn-collapse').onclick = $('#btn-expand').onclick = () => { S.sideCollapsed = !S.sideCollapsed; save(); renderSidebar(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S && applyTheme());
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'k') { e.preventDefault(); openSearch(); }
  if (mod && k === 'j') { e.preventDefault(); toggleAi(); }
  if (mod && k === '\\') { e.preventDefault(); S.sideCollapsed = !S.sideCollapsed; save(); renderSidebar(); }
  if (mod && k === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); histGo(e.shiftKey ? 1 : -1); }
  if (mod && k === 'y' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); histGo(1); }
  if (e.key === 'Escape' && popupEl) closePopup();
});
// Glisser des images sur la page (hors d'un bloc) : ajoutées à la fin.
$('#main').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
$('#main').addEventListener('drop', e => {
  if (!e.dataTransfer.files.length || e.defaultPrevented) return;
  e.preventDefault();
  const d = currentDoc(); if (!d || (page(nav.page)?.isDb && !nav.row)) return;
  const last = d.blocks.at(-1) || (d.blocks.push(newBlock()), d.blocks.at(-1));
  dropImages(d, last, [...e.dataTransfer.files]);
});
addEventListener('resize', () => { closePopup(); hideFmt(); });
boot();
