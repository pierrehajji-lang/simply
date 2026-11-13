'use strict';
/* Zoubiders — fondations : petits outils, état, sauvegarde, annuler/rétablir, menus et fenêtres. */

// ---------- Petits outils ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
// Minuscules sans accents, même longueur que l'original (pour surligner les résultats au bon endroit).
const fold = s => { s = String(s ?? ''); let o = ''; for (const c of s) o += ((c.normalize('NFD')[0] || c).toLowerCase()[0] || c); return o; };
const pad2 = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = (d = 0) => { const t = new Date(); t.setDate(t.getDate() + d); return isoDay(t); };
const fmtDate = v => { if (!v) return ''; const d = new Date(String(v).slice(0, 10) + 'T00:00'); return isNaN(d) ? String(v) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtDateTime = v => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Dans ces cases, un symbole texte (« ⧉ », « ▦ »…) est remplacé par une icône dessinée (voir icons.js).
const ICON_SLOTS = new Set(['mi-ic', 'ct', 'cp-ic', 'ico-slot']);
function h(tag, props, ...kids) {
  const el = tag === 'svg' || props?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'svg') continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (!(el instanceof SVGElement) && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const iconSlot = ICON_SLOTS.has(props?.class);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(iconSlot && typeof c === 'string' ? glyph(c) : c);
  return el;
}
// Comme replaceChildren, mais ignore les valeurs vides (null, false) au lieu d'afficher « null ».
const setKids = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const svg = (tag, props = {}, ...kids) => h(tag, { ...props, svg: true }, ...kids);

// ---------- Couleurs (texte, fonds, étiquettes) ----------
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const COLOR_FR = { default: 'Par défaut', gray: 'Gris', brown: 'Marron', orange: 'Orange', yellow: 'Jaune', green: 'Vert', blue: 'Bleu', purple: 'Violet', pink: 'Rose', red: 'Rouge' };
// Couleurs « témoins » : le navigateur les applique, puis on les remplace par des classes (qui suivent le thème clair/sombre).
const SENTINEL = c => '#' + (0xA10000 + COLORS.indexOf(c) * 7).toString(16);
const SENT_RGB = Object.fromEntries(COLORS.map(c => { const x = parseInt(SENTINEL(c).slice(1), 16); return [`rgb(${x >> 16}, ${(x >> 8) & 255}, ${x & 255})`, c]; }));

// ---------- Nettoyage du texte enrichi ----------
// Seules quelques balises sont gardées : gras, italique, souligné, barré, code, liens, couleurs. Tout le reste devient du texte.
const KEEP = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a', BR: 'br', MARK: 'span' };
function sanitize(html) {
  const src = document.createElement('div');
  src.innerHTML = html;
  const out = document.createElement('div');
  const walk = (from, to) => {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) { to.append(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      if (/^(SCRIPT|STYLE|META|LINK|TITLE)$/.test(n.tagName)) continue;
      let tag = KEEP[n.tagName], el = null;
      const st = n.style || {};
      const cls = [];
      // Couleurs : classes connues, couleurs témoins ou styles venant du navigateur.
      for (const c of (n.getAttribute('class') || '').split(/\s+/)) if (/^(tc|bg)-[a-z]+$/.test(c)) cls.push(c);
      const fc = n.tagName === 'FONT' ? n.getAttribute('color') : null;
      const fcol = fc && Object.keys(SENT_RGB).find(k => SENTINEL(SENT_RGB[k]) === fc.toLowerCase());
      if (fcol) cls.push('tc-' + SENT_RGB[fcol]);
      if (st.color && SENT_RGB[st.color]) cls.push('tc-' + SENT_RGB[st.color]);
      if (st.backgroundColor && SENT_RGB[st.backgroundColor]) cls.push('bg-' + SENT_RGB[st.backgroundColor]);
      if (st.fontWeight === 'bold' || +st.fontWeight >= 600) tag = tag || 'b';
      if (st.fontStyle === 'italic') tag = tag || 'i';
      if (tag) {
        el = document.createElement(tag);
        if (tag === 'a') {
          const href = n.getAttribute('href') || '';
          if (/^(https?:|mailto:|tel:|#page:)/i.test(href)) el.setAttribute('href', href); else el = document.createElement('span');
        }
      } else if (cls.length) el = document.createElement('span');
      if (el && cls.length) el.className = [...new Set(cls)].join(' ');
      if (tag === 'br') { to.append(el); continue; }
      if (el) { walk(n, el); if (el.childNodes.length) to.append(el); }
      else {
        walk(n, to);
        // Les blocs (div, p…) collés au milieu d'une ligne deviennent des retours à la ligne.
        if (/^(DIV|P|LI|H[1-6]|TR|BLOCKQUOTE)$/.test(n.tagName) && n.nextSibling) to.append(document.createElement('br'));
      }
    }
  };
  walk(src, out);
  let res = out.innerHTML.replace(/(<br>)+$/, '');
  return res;
}
const textOfHtml = html => { const d = document.createElement('div'); d.innerHTML = html || ''; for (const br of d.querySelectorAll('br')) br.replaceWith('\n'); return d.textContent; };

// ---------- État et sauvegarde ----------
let S = null;          // tout l'espace de travail
let nav = { page: null, row: null };  // ce qui est affiché : une page, ou une fiche de base de données
let saveTimer = null, saving = Promise.resolve();
function setStatus(t, err) { const s = $('#status'); if (!s) return; s.textContent = t; s.classList.toggle('err', !!err); }
function save() { setStatus('Modifications…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 350); histMark(); }
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const body = JSON.stringify(S);
  // Les envois sont mis en file : jamais un ancien état n'écrase un plus récent.
  saving = saving.then(() => fetch('/api/data', { method: 'PUT', body })
    .then(r => { if (r.status === 401) return location.reload(); if (!r.ok) throw 0; if (!saveTimer) setStatus('✓ Enregistré'); })
    .catch(() => setStatus('⚠ Échec de l’enregistrement — Zoubiders est-il toujours lancé ?', true)));
}
// shortcut: sendBeacon est limité à ~64 Ko ; au-delà, seules les dernières 350 ms de frappe peuvent être perdues à la fermeture.
addEventListener('beforeunload', () => { if (saveTimer) window.SIMPLY_STATIC ? flush() : navigator.sendBeacon('/api/data', JSON.stringify(S)); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });

// ---------- Annuler / rétablir ----------
// On garde des photos de l'espace de travail, prises après chaque pause de frappe.
const hist = { list: [], pos: -1, timer: null };
function histReset() { hist.list = [JSON.stringify(S)]; hist.pos = 0; }
function histMark() { clearTimeout(hist.timer); hist.timer = setTimeout(histSnap, 500); }
function histSnap() {
  clearTimeout(hist.timer); hist.timer = null;
  const cur = JSON.stringify(S);
  if (cur === hist.list[hist.pos]) return;
  hist.list = hist.list.slice(0, hist.pos + 1);
  hist.list.push(cur);
  if (hist.list.length > 150) hist.list.shift();
  hist.pos = hist.list.length - 1;
}
function histGo(d) {
  if (hist.timer) histSnap();
  const p = hist.pos + d;
  if (p < 0 || p >= hist.list.length) return toast(d < 0 ? 'Rien à annuler' : 'Rien à rétablir');
  hist.pos = p;
  S = JSON.parse(hist.list[p]);
  setStatus('Modifications…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 350);
  closePopup(); $$('.overlay').forEach(o => o.remove());
  applyTheme(); renderAll();
  toast(d < 0 ? 'Annulé' : 'Rétabli');
}

// ---------- Envoi d'images ----------
async function uploadImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Ce fichier n’est pas une image.');
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  if (!r.ok) throw new Error(await r.text() || 'Envoi impossible');
  return (await r.json()).url;
}
function pickImage() {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
    document.body.append(inp); inp.click();
  });
}
function pickFile(accept) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, style: 'display:none' });
    inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
    document.body.append(inp); inp.click();
  });
}
function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Curseur dans un texte modifiable ----------
function getCaret(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return 0;
  const r = sel.getRangeAt(0), pre = document.createRange();
  pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
// Position (nœud texte + décalage) correspondant au n-ième caractère.
function pointAt(el, off) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let t; (t = w.nextNode());) { last = t; if (off <= t.length) return [t, off]; off -= t.length; }
  return last ? [last, last.length] : [el, 0];
}
function rangeAt(el, start, end) {
  const r = document.createRange();
  r.setStart(...pointAt(el, start)); r.setEnd(...pointAt(el, end));
  return r;
}
function setCaret(el, off) {
  if (!el) return;
  el.focus();
  const sel = getSelection(), r = document.createRange();
  if (off === 'end' || off >= el.textContent.length) { r.selectNodeContents(el); r.collapse(false); }
  else r.setStart(...pointAt(el, off));
  r.collapse(r.collapsed ? true : false);
  sel.removeAllRanges(); sel.addRange(r);
}
function caretRect(el) {
  const s = getSelection();
  const r = s.rangeCount && s.getRangeAt(0).getClientRects()[0];
  return r && r.height ? r : el.getBoundingClientRect();
}
// Le curseur est-il sur la première (ou dernière) ligne du bloc ?
function atEdge(el, up) {
  const s = getSelection();
  const r = s.rangeCount && s.getRangeAt(0).getClientRects()[0];
  if (!r) return true;
  const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || 24;
  return up ? r.top - b.top < parseFloat(cs.paddingTop) + lh * 0.8 : b.bottom - r.bottom < parseFloat(cs.paddingBottom) + lh * 0.8;
}

// ---------- Menus flottants et fenêtres ----------
let popupEl = null, popupClose = null;
function outside(e) { if (popupEl && !popupEl.contains(e.target)) closePopup(); }
function popup(anchor, content, onClose, cls = '') {
  closePopup();
  const el = h('div', { class: 'popup ' + cls }, content);
  document.body.append(el);
  placeAt(el, anchor);
  popupEl = el; popupClose = onClose;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  return el;
}
function placeAt(el, anchor) {
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let y = r.bottom + 4;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 4);
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
  el.style.top = y + 'px';
}
function closePopup() {
  if (typeof slash !== 'undefined') slash = null;
  if (!popupEl) return;
  popupEl.remove(); popupEl = null;
  document.removeEventListener('mousedown', outside);
  const f = popupClose; popupClose = null; f && f();
}
// items : { icon, label, action, danger, check, hint } | '-' | { header }
function menu(anchor, items, onClose) {
  return popup(anchor, items.filter(Boolean).map(it => it === '-' ? h('div', { class: 'sep' })
    : it.header ? h('div', { class: 'mh' }, it.header)
    : it.el ? it.el
    : h('button', { class: 'mi' + (it.danger ? ' danger' : ''), onclick: () => { closePopup(); it.action(); } },
      h('span', { class: 'mi-ic' }, glyph(it.icon || '')), h('span', { class: 'mi-l' }, it.label),
      it.hint ? h('span', { class: 'mi-hint' }, it.hint) : null,
      it.check ? h('span', { class: 'chk' }, '✓') : null)), onClose);
}

function modal(title, body, onClose, cls = '') {
  let closed = false;
  const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov) close(); } },
    h('div', { class: 'modal ' + cls, role: 'dialog', 'aria-label': title },
      title ? h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'x', title: 'Fermer', onclick: () => close() }, '✕')) : null, body));
  const escKey = e => {
    if (e.key === 'Escape' && !popupEl && $$('.overlay').at(-1) === ov) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  function close() {
    if (closed) return;
    closed = true; ov.remove(); document.removeEventListener('keydown', escKey, true); onClose && onClose();
  }
  closePopup();
  document.body.append(ov);
  document.addEventListener('keydown', escKey, true);
  return close;
}

// Remplace confirm()/prompt() : renvoie true / le texte saisi, ou null si annulé.
function dialog({ title, text, input, ok = 'OK', danger, placeholder }) {
  return new Promise(res => {
    let done = false;
    const inp = input != null ? h('input', { class: 'mini wide', value: input, placeholder: placeholder || '' }) : null;
    const finish = v => { if (done) return; done = true; close(); res(v); };
    const okBtn = h('button', { class: 'btn ' + (danger ? 'danger-solid' : 'primary'), onclick: () => finish(inp ? inp.value.trim() || null : true) }, ok);
    const body = h('div', { class: 'dlg', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } } },
      text ? h('p', {}, text) : null, inp, h('div', { class: 'dlg-btns' }, h('button', { class: 'btn', onclick: () => finish(null) }, 'Annuler'), okBtn));
    const close = modal(title, body, () => finish(null), 'small');
    (inp || okBtn).focus();
    inp && inp.select();
  });
}

function toast(msg, action) {
  $$('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' }, msg, action ? h('button', { onclick: () => { t.remove(); action.fn(); } }, action.label) : null);
  document.body.append(t);
  setTimeout(() => t.remove(), action ? 5000 : 2500);
}

const EMOJIS = ('📄 📝 📚 📌 ✅ 🚀 🎯 💡 📅 🗓️ 🗂️ 📊 📈 🧠 🎨 🏠 💼 ✈️ 🍳 🎵 💪 🌱 ⭐ ❤️ 🔥 🧪 📖 🛒 💰 🎓 🧩 🔖 👋 🌙 📸 🎬 🎥 🎤 🎧 📣 💬 ✉️ 📞 🧾 🏷️ 🛠️ ⚙️ 🔑 🔒 🌍 🗺️ ☀️ ⚡ 🍀 🎁 🏆 🥇 🎉 🤝 👥 🙂 😎 🤔 👀 🧭 🧳 🏭 👕 🧢 🎒 ✂️ 🖌️ 🖍️ 📐 💻 📱 🖥️ 🕹️ 🐶 🐱 🌸 🍕 ☕ 🏃 🧘 ⚽ 🎸 🎹 📦 🚚 🧺 🧴').split(' ');
function iconPicker(anchor, cur, onPick) {
  const inp = h('input', { class: 'mini wide', placeholder: 'Ou collez un emoji…', maxLength: 4 });
  inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { closePopup(); onPick(inp.value.trim()); } };
  popup(anchor, [
    h('div', { class: 'emojis' }, EMOJIS.map(e => h('button', { class: e === cur ? 'on' : '', onclick: () => { closePopup(); onPick(e); } }, e))),
    h('div', { class: 'pad row' }, inp, h('button', { class: 'btn', onclick: () => { closePopup(); onPick(null); } }, 'Retirer')),
  ], null, 'wide-pop');
  inp.focus();
}
