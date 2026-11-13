'use strict';
/* Zoubiders — assistant IA : discussion, actions sur le texte sélectionné, création de modèles.
   Le « cerveau » est Claude (Internet + clé API) ou une IA locale Ollama, au choix dans Réglages. */

const AI_SYSTEM = `Tu es l'assistant intégré à Zoubiders, une application de notes et de bases de données (comme un carnet numérique).
Réponds toujours en français, clairement et simplement : l'utilisateur débute en informatique.
Écris en Markdown simple, que Zoubiders sait afficher : titres (#, ##, ###), listes (- ou 1.), cases à cocher (- [ ]), citations (>), tableaux (| a | b |), séparateurs (---) et encadrés (<callout icon="💡">texte</callout>).`;

async function aiAsk(messages, { system = AI_SYSTEM, effort } = {}) {
  const r = await fetch('/api/ai', { method: 'POST', body: JSON.stringify({ system, messages, effort }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error(OLD_SERVER);
  if (!r.ok) throw new Error(j.error || 'L’assistant ne répond pas.');
  return j.text || '';
}
const OLD_SERVER = 'Zoubiders tourne encore avec une ancienne version : fermez la fenêtre Terminal de Zoubiders, puis relancez « Lancer Zoubiders.command ».';
const pageMd = d => d ? `# ${d.title || rowTitleOf(d) || 'Sans titre'}\n\n${blocksToMd(d.blocks || [])}` : '';
function rowTitleOf(d) { const ctx = !S.pages.includes(d) && findRow(d.id); return ctx ? rowTitle(ctx.db, d) : ''; }
// Affiche une réponse Markdown avec le rendu habituel des pages (lecture seule).
const mdView = md => h('div', { class: 'ai-md', inert: true }, renderBlocks({ id: uid(), blocks: mdToBlocks(md) }));

// ---------- Panneau de discussion ----------
const aiChat = { el: null, msgs: [], busy: false, withPage: true };
function toggleAi(open = !aiChat.el) {
  if (!open) { aiChat.el?.remove(); aiChat.el = null; document.body.classList.remove('ai-open'); return; }
  if (aiChat.el) return;
  aiChat.el = h('aside', { class: 'ai-panel' });
  document.body.append(aiChat.el); document.body.classList.add('ai-open');
  drawAi();
}
function drawAi(focus = true) {
  const p = aiChat.el; if (!p) return;
  const input = h('textarea', { class: 'ai-in', rows: 3, placeholder: 'Posez une question, demandez un texte, un plan, une explication…',
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } } });
  const send = async text => {
    text = text.trim(); if (!text || aiChat.busy) return;
    const ctx = aiChat.withPage && currentDoc() ? `Voici la page ouverte dans Zoubiders :\n\n${pageMd(currentDoc())}\n\n---\n\n` : '';
    aiChat.msgs.push({ role: 'user', content: text, shown: text, ctx });
    aiChat.busy = true; drawAi();
    try {
      // Le contexte de page n'est joint qu'au dernier message, pour ne pas alourdir l'historique.
      const msgs = aiChat.msgs.map((m, i) => ({ role: m.role, content: i === aiChat.msgs.length - 1 ? m.ctx + m.content : m.content }));
      aiChat.msgs.push({ role: 'assistant', content: await aiAsk(msgs) });
    } catch (e) { aiChat.msgs.push({ role: 'error', content: e.message }); }
    aiChat.busy = false; drawAi();
  };
  const quick = [['📝 Résumer la page', 'Résume la page ouverte en quelques points clés.'], ['✅ Corriger la page', 'Relis la page ouverte et liste les fautes d’orthographe et de grammaire, avec la correction.'],
    ['💡 Idées', 'Propose 5 idées pour compléter ou améliorer cette page.'], ['📋 Plan d’action', 'Transforme cette page en plan d’action avec des cases à cocher.']];
  const insertHere = md => {
    const d = currentDoc();
    if (!d || (page(nav.page)?.isDb && !nav.row)) return toast('Ouvrez une page (pas une base) pour y insérer le texte.');
    d.blocks = isEmptyDoc(d) ? mdToBlocks(md) : [...d.blocks, ...mdToBlocks(md)]; save(); renderMain(); toast('Ajouté à la page');
  };
  const list = h('div', { class: 'ai-list' },
    !aiChat.msgs.length ? h('div', { class: 'ai-hello' }, h('div', { class: 'ai-star' }, '✨'), h('b', {}, 'Comment puis-je aider ?'),
      h('p', { class: 'muted small' }, 'Questions, explications, rédaction, correction… Sélectionnez du texte dans une page pour le corriger ou l’améliorer avec « ✨ IA ».'),
      h('div', { class: 'ai-quick' }, quick.map(([l, q]) => h('button', { class: 'chip', onclick: () => send(q) }, l)))) : null,
    aiChat.msgs.map(m => m.role === 'user' ? h('div', { class: 'ai-msg me' }, m.shown)
      : m.role === 'error' ? h('div', { class: 'ai-msg err' }, '⚠️ ', m.content, ' ', h('button', { class: 'btn sm', onclick: openAiSettings }, 'Réglages IA'))
      : h('div', { class: 'ai-msg bot' }, mdView(m.content), h('div', { class: 'ai-acts' },
        h('button', { class: 'tool', onclick: () => { navigator.clipboard?.writeText(m.content); toast('Copié'); } }, 'Copier'),
        h('button', { class: 'tool', onclick: () => insertHere(m.content) }, 'Insérer dans la page'),
        h('button', { class: 'tool', onclick: () => { const pg = newPage(null, { title: 'Réponse de l’assistant', icon: '✨', blocks: mdToBlocks(m.content) }); save(); openPage(pg.id); } }, 'Nouvelle page')))),
    aiChat.busy ? h('div', { class: 'ai-msg bot ai-wait' }, h('span', { class: 'dots' }, '•••'), ' Réflexion…') : null);
  p.replaceChildren(
    h('div', { class: 'ai-head' }, h('span', { class: 'ai-star' }, '✨'), h('b', { class: 'grow' }, 'Assistant'),
      aiChat.msgs.length ? h('button', { class: 'tool', title: 'Nouvelle discussion', onclick: () => { aiChat.msgs = []; drawAi(); } }, 'Effacer') : null,
      h('button', { class: 'tool', title: 'Réglages de l’IA', onclick: openAiSettings }, ico('gear')),
      h('button', { class: 'x', title: 'Fermer (⌘J)', onclick: () => toggleAi(false) }, '✕')),
    list,
    h('div', { class: 'ai-foot' }, input,
      h('div', { class: 'row' },
        h('label', { class: 'muted small ai-ctx' }, h('input', { type: 'checkbox', checked: aiChat.withPage, onchange: e => { aiChat.withPage = e.target.checked; } }),
          ' Tenir compte de la page ouverte'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary sm', disabled: aiChat.busy, onclick: () => send(input.value) }, 'Envoyer'))));
  list.scrollTop = list.scrollHeight;
  if (focus && !aiChat.busy) input.focus();
}

// ---------- Actions sur le texte sélectionné (bouton « ✨ IA » de la barre de mise en forme) ----------
const AI_EDITS = [
  ['✅', 'Corriger l’orthographe et la grammaire', 'Corrige les fautes d’orthographe, de grammaire et de ponctuation, sans changer le style.'],
  ['✨', 'Améliorer l’écriture', 'Améliore ce texte : plus clair, plus fluide, même sens.'],
  ['✂️', 'Raccourcir', 'Raccourcis ce texte en gardant l’essentiel.'],
  ['➕', 'Développer', 'Développe ce texte avec un peu plus de détails.'],
  ['💼', 'Ton professionnel', 'Réécris ce texte sur un ton professionnel (candidature, e-mail de travail).'],
  ['🙂', 'Ton simple et amical', 'Réécris ce texte sur un ton simple et chaleureux.'],
  ['🇬🇧', 'Traduire en anglais', 'Traduis ce texte en anglais.'],
];
function aiSelectionMenu(anchor, ed) {
  const sel = getSelection(), range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null, text = sel.toString();
  if (!range || !text.trim()) return;
  const rewrite = async how => {
    closePopup(); hideFmt();
    toast('✨ L’assistant travaille…');
    let out;
    try {
      out = (await aiAsk([{ role: 'user', content: `${how}\nRéponds UNIQUEMENT par le texte final, sans guillemets ni explication.\n\nTexte :\n${text}` }],
        { system: 'Tu es un correcteur et rédacteur francophone précis. Tu renvoies seulement le texte demandé.' })).trim();
    } catch (e) { return toast('⚠️ ' + e.message, { label: 'Réglages IA', fn: openAiSettings }); }
    $$('.toast').forEach(t => t.remove());
    const close = modal('Proposition de l’assistant', h('div', { class: 'dlg' },
      h('div', { class: 'ai-cmp' }, h('div', {}, h('div', { class: 'mh' }, 'Avant'), h('p', { class: 'muted' }, text)), h('div', {}, h('div', { class: 'mh' }, 'Après'), h('p', {}, out))),
      h('div', { class: 'dlg-btns' },
        h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
        h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(out); toast('Copié'); close(); } }, 'Copier'),
        h('button', { class: 'btn primary', onclick: () => {
          close();
          if (!ed.isConnected) return toast('Le texte a changé entre-temps : copiez la proposition.');
          ed.focus(); sel.removeAllRanges(); sel.addRange(range);
          document.execCommand('insertText', false, out);
          ed.dispatchEvent(new Event('input'));
        } }, 'Remplacer'))), null, 'wide');
  };
  popup(anchor, [
    h('div', { class: 'mh' }, '✨ Demander à l’assistant'),
    ...AI_EDITS.map(([ic, label, how]) => h('button', { class: 'mi', onmousedown: e => e.preventDefault(), onclick: () => rewrite(how) }, h('span', { class: 'mi-ic' }, ic), label)),
    h('div', { class: 'sep' }),
    h('button', { class: 'mi', onmousedown: e => e.preventDefault(), onclick: () => {
      closePopup(); hideFmt(); toggleAi(true); aiChat.withPage = false;
      const ta = $('.ai-in'); ta.value = `Explique-moi simplement ce passage :\n« ${text} »`; ta.focus();
    } }, h('span', { class: 'mi-ic' }, '💬'), 'Expliquer / poser une question'),
  ]);
}

// ---------- Créer un modèle avec l'IA ----------
async function aiCreateTemplate() {
  const want = await dialog({ title: '✨ Créer un modèle avec l’IA', text: 'Décrivez le modèle voulu. Ex. : « suivi de mes candidatures de stage », « menu de la semaine », « préparation d’un oral ».', input: '', placeholder: 'Je voudrais un modèle pour…', ok: 'Créer' });
  if (!want) return;
  toast('✨ L’assistant prépare votre modèle…');
  let md;
  try {
    md = await aiAsk([{ role: 'user', content: `Crée un modèle de page Zoubiders pour : ${want}
Première ligne : « ICONE: » suivi d'un seul emoji. Deuxième ligne : « NOM: » suivi d'un nom court.
Ensuite la page en Markdown : un encadré d'introduction, des titres, des cases à cocher, des listes et au moins un tableau prérempli avec des exemples utiles.` }], { effort: 'medium' });
  } catch (e) { return toast('⚠️ ' + e.message, { label: 'Réglages IA', fn: openAiSettings }); }
  const icon = (md.match(/^\s*ICONE:\s*(\S+)/m) || [])[1] || '🧩';
  const name = ((md.match(/^\s*NOM:\s*(.+)$/m) || [])[1] || want).trim().slice(0, 60);
  const body = md.replace(/^\s*(ICONE|NOM):.*$/gm, '').replace(/^```(markdown)?\s*$/gm, '');
  const t = { id: uid(), name, icon, title: name, blocks: mdToBlocks(body), isDb: false, desc: 'Créé par l’assistant : « ' + want + ' »' };
  if (!t.blocks.length) return toast('L’assistant n’a rien renvoyé d’utilisable, réessayez.');
  S.templates.push(t); save();
  $$('.toast').forEach(x => x.remove());
  openTemplates(null, null, t.id);
}

// ---------- Réglages ----------
async function openAiSettings() {
  let c;
  try { const r = await fetch('/api/ai/config'); if (r.status === 404) return toast(OLD_SERVER); c = await r.json(); } catch { return toast('Zoubiders ne répond pas : relancez « Lancer Zoubiders.command ».'); }
  let provider = c.provider, close;
  const key = h('input', { class: 'mini wide', type: 'password', placeholder: c.hasKey ? '•••••••• (clé enregistrée — laissez vide pour la garder)' : 'sk-ant-…', autocomplete: 'off' });
  const model = h('input', { class: 'mini wide', value: c.ollamaModel });
  const status = h('p', { class: 'small muted' });
  const pane = h('div');
  const draw = () => pane.replaceChildren(
    h('div', { class: 'ai-choice' },
      [['claude', '☁️ Claude', 'Très bonnes réponses. Internet + clé API payante (quelques centimes par question). Le texte envoyé quitte votre Mac.'],
        ['ollama', '💻 IA locale (Ollama)', 'Gratuit et hors ligne, rien ne quitte votre Mac. Plus lent et moins précis. Nécessite l’app Ollama.']].map(([v, t, d]) =>
        h('button', { class: 'ai-opt' + (provider === v ? ' on' : ''), onclick: () => { provider = v; draw(); } }, h('b', {}, t), h('span', { class: 'muted small' }, d)))),
    provider === 'claude' ? h('div', {},
      h('div', { class: 'mh' }, 'Clé API Claude'), key,
      h('p', { class: 'small muted' }, c.static ? 'À créer sur console.anthropic.com (rubrique « API Keys »). Elle reste dans ce navigateur, sur cet appareil.' : 'À créer sur console.anthropic.com (rubrique « API Keys »). Elle est gardée sur ce Mac, dans donnees/ia.json, jamais dans vos sauvegardes.'),
      c.hasKey ? h('button', { class: 'btn sm danger', onclick: async () => { await saveConf({ clearKey: true }); close(); toast('Clé effacée'); } }, 'Effacer la clé enregistrée') : null)
      : h('div', {},
        h('div', { class: 'mh' }, 'Modèle local'), model,
        h('p', { class: 'small muted' }, 'Installez Ollama (ollama.com), puis dans le Terminal : « ollama pull llama3.1 ». Laissez l’app Ollama ouverte.')),
    status);
  const saveConf = b => fetch('/api/ai/config', { method: 'PUT', body: JSON.stringify(b) });
  draw();
  close = modal('Assistant IA', h('div', { class: 'dlg' }, pane, h('div', { class: 'dlg-btns' },
    h('button', { class: 'btn', onclick: async () => {
      await saveConf({ provider, ollamaModel: model.value, apiKey: key.value });
      status.textContent = 'Test en cours…';
      try { await aiAsk([{ role: 'user', content: 'Réponds juste « Bonjour ! »' }]); status.textContent = '✅ L’assistant répond correctement.'; }
      catch (e) { status.textContent = '⚠️ ' + e.message; }
    } }, 'Tester'),
    h('button', { class: 'btn primary', onclick: async () => { await saveConf({ provider, ollamaModel: model.value, apiKey: key.value }); close(); toast('Réglages de l’IA enregistrés'); } }, 'Enregistrer'))), null, 'small');
}
