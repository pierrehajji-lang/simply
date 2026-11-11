'use strict';
/* Simply — comptes : écran de connexion, création de comptes, changement de mot de passe. */

let ME = null; // compte connecté (null en mode « sans compte »)
const postJson = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur');
  return j;
};
// Petit formulaire à plusieurs champs ; renvoie les valeurs, ou null si annulé.
function formDialog(title, text, fields, ok) {
  return new Promise(res => {
    let done = false;
    const inputs = fields.map(f => h('input', { class: 'mini wide', type: f.type || 'text', placeholder: f.label, value: f.value || '', autocomplete: f.type === 'password' ? 'new-password' : 'off' }));
    const finish = v => { if (done) return; done = true; close(); res(v); };
    const okBtn = h('button', { class: 'btn primary', onclick: () => finish(inputs.map(i => i.value)) }, ok);
    const close = modal(title, h('div', { class: 'dlg acc-form', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } } },
      text ? h('p', {}, text) : null,
      fields.map((f, i) => h('label', { class: 'acc-field' }, h('span', { class: 'muted small' }, f.label), inputs[i])),
      h('div', { class: 'dlg-btns' }, h('button', { class: 'btn', onclick: () => finish(null) }, 'Annuler'), okBtn)), () => finish(null), 'small');
    inputs[0].focus();
  });
}

function showLogin(signup) {
  let mode = 'login';
  const id = h('input', { class: 'mini wide', placeholder: 'Identifiant (e-mail ou prénom)', autocomplete: 'username' });
  const pw = h('input', { class: 'mini wide', type: 'password', placeholder: 'Code (8 caractères minimum)', autocomplete: 'current-password' });
  const pw2 = h('input', { class: 'mini wide', type: 'password', placeholder: 'Retapez le code', autocomplete: 'new-password' });
  const inv = h('input', { class: 'mini wide', placeholder: 'Code d’invitation (reçu avec le lien)', autocomplete: 'off', style: 'text-transform:uppercase' });
  const err = h('p', { class: 'acc-err' });
  const card = h('div', { class: 'acc-card', onkeydown: e => { if (e.key === 'Enter') go(); } });
  const go = async () => {
    err.textContent = '';
    if (!id.value.trim()) return (err.textContent = 'Tapez votre identifiant.');
    try {
      if (mode === 'login') await postJson('/api/login', { name: id.value, password: pw.value });
      else {
        if (pw.value !== pw2.value) return (err.textContent = 'Les deux codes sont différents.');
        await postJson('/api/accounts', { name: id.value, password: pw.value, invite: inv.value });
      }
      location.reload();
    } catch (e) { err.textContent = e.message; }
  };
  const draw = () => {
    pw.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    card.replaceChildren(...[
      h('img', { src: 'icon.svg', alt: '', class: 'acc-logo' }), h('h1', {}, 'Simply'),
      h('p', { class: 'muted' }, mode === 'login' ? 'Connectez-vous à votre espace.' : 'Créez votre espace : il sera vide et rien qu’à vous.'),
      signup ? h('div', { class: 'acc-tabs' }, [['login', 'Se connecter'], ['signup', 'Créer un compte']].map(([m, l]) => h('button', { class: m === mode ? 'on' : '', onclick: () => { mode = m; draw(); (mode === 'signup' && !window.SIMPLY_CLOUD_ON ? inv : id).focus(); } }, l))) : null,
      mode === 'signup' && !window.SIMPLY_CLOUD_ON ? inv : null, id, pw, mode === 'signup' ? pw2 : null, err,
      h('button', { class: 'btn primary wide', onclick: go }, mode === 'login' ? 'Se connecter' : 'Créer mon compte'),
      h('p', { class: 'muted small' }, mode === 'login' ? (window.SIMPLY_CLOUD_ON ? 'Pas encore de compte ? Cliquez sur « Créer un compte ».' : 'Code oublié ? Demandez à l’administrateur de Simply.') : 'L’e-mail peut être inventé : il sert seulement d’identifiant.')].filter(Boolean));
  };
  draw();
  document.body.replaceChildren(h('div', { class: 'acc-screen' }, card));
  id.focus();
}

async function logout() { await postJson('/api/logout'); location.reload(); }

// Section « Accès depuis le Wi-Fi » des réglages.
function networkSection() {
  const box = h('div');
  const draw = async () => {
    let n; try { n = await (await fetch('/api/network')).json(); } catch { return; }
    const set = async wifi => {
      const r = await fetch('/api/network', { method: 'PUT', body: JSON.stringify({ wifi }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error || 'Erreur');
      toast(wifi ? 'Simply est ouvert au Wi-Fi' : 'Accès Wi-Fi fermé'); draw();
    };
    setKids(box, 
      n.wifi && n.accounts ? h('div', {},
        h('p', { class: 'small' }, '🟢 Ouvert. Sur un téléphone ou un ordinateur branché au même Wi-Fi, tapez cette adresse dans le navigateur :'),
        n.urls.map(u => h('div', { class: 'row' }, h('code', { class: 'net-url' }, u), h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(u); toast('Adresse copiée'); } }, 'Copier'))),
        h('p', { class: 'muted small' }, 'Le Mac doit rester allumé avec Simply lancé. Chacun se connecte avec son compte. À n’utiliser que sur votre Wi-Fi de confiance (maison, bureau), pas sur un Wi-Fi public.'),
        n.local ? h('button', { class: 'btn sm', onclick: () => set(false) }, 'Fermer l’accès Wi-Fi') : null)
      : h('div', {},
        h('p', { class: 'muted small' }, '🔒 Fermé : seul ce Mac peut ouvrir Simply.' + (n.accounts ? '' : ' Pour ouvrir, activez d’abord les comptes (ci-dessus), afin que chacun doive se connecter.')),
        n.accounts && n.local ? h('button', { class: 'btn sm primary', onclick: () => set(true) }, 'Ouvrir au Wi-Fi') : null),
      n.accounts && ME?.admin ? h('label', { class: 'row small acc-signup' }, h('input', { type: 'checkbox', checked: n.signup, onchange: async e => { await fetch('/api/network', { method: 'PUT', body: JSON.stringify({ signup: e.target.checked }) }); toast(e.target.checked ? 'Inscriptions ouvertes' : 'Inscriptions fermées'); } }),
        'Les personnes qui ont l’adresse et le code d’invitation peuvent créer leur propre compte (espace vide et séparé)') : null,
      n.invite ? h('div', { class: 'row small net-inv' }, 'Code d’invitation :', h('code', { class: 'net-url' }, n.invite),
        h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(n.invite); toast('Code copié'); } }, 'Copier'),
        h('button', { class: 'btn sm', title: 'L’ancien code ne marchera plus (les comptes déjà créés restent)', onclick: async () => { await fetch('/api/network', { method: 'PUT', body: JSON.stringify({ newInvite: true }) }); draw(); } }, 'Changer')) : null,
      h('div', { class: 'mh' }, 'Accès depuis Internet'),
      n.internet ? h('div', {},
        h('p', { class: 'small' }, '🟢 En ligne. Envoyez ce lien et le code d’invitation à qui vous voulez :'),
        h('div', { class: 'row' }, h('code', { class: 'net-url' }, n.internet), h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(n.internet); toast('Lien copié'); } }, 'Copier')),
        h('p', { class: 'muted small' }, 'Le lien marche tant que la fenêtre « Ouvrir Simply sur Internet » reste ouverte et que le Mac est allumé. Il change à chaque ouverture.'))
      : h('p', { class: 'muted small' }, n.accounts
        ? '🔒 Hors ligne. Pour partager Simply avec n’importe qui, double-cliquez sur « Ouvrir Simply sur Internet.command » dans le dossier de Simply : le lien s’affichera ici.'
        : '🔒 Hors ligne. Activez d’abord les comptes (ci-dessus) : Simply refuse toute connexion venant d’Internet sans comptes.'));
  };
  draw();
  return box;
}

// Section « Comptes » des réglages.
function accountsSection(closeSettings) {
  const box = h('div', { class: 'acc-sec' });
  const draw = async () => {
    if (!ME) {
      setKids(box, 
        h('p', { class: 'muted small' }, 'Simply n’a pas de comptes pour l’instant : tout le monde qui ouvre Simply sur ce Mac voit le même espace.'),
        h('button', { class: 'mi', onclick: async () => {
          const v = await formDialog('Activer les comptes', 'Créez d’abord VOTRE compte (administrateur). Il garde tout le contenu actuel. Ensuite, chaque personne aura son espace séparé.',
            [{ label: 'Votre identifiant (e-mail ou prénom)' }, { label: 'Code (8 caractères minimum)', type: 'password' }, { label: 'Retapez le code', type: 'password' }], 'Créer mon compte');
          if (!v) return;
          if (v[1] !== v[2]) return toast('Les deux mots de passe sont différents.');
          try { flush(); await saving; await postJson('/api/accounts', { name: v[0], password: v[1] }); location.reload(); } catch (e) { toast(e.message); }
        } }, h('span', { class: 'mi-ic' }, '👤'), 'Activer les comptes (créer le mien)'));
      return;
    }
    const list = await (await fetch('/api/accounts')).json().catch(() => []);
    setKids(box, 
      h('p', { class: 'small' }, 'Connecté en tant que ', h('b', {}, ME.name), ME.admin ? ' (administrateur)' : ''),
      h('div', { class: 'acc-list' }, (Array.isArray(list) ? list : []).map(a => h('div', { class: 'acc-row' },
        h('span', { class: 'acc-av' }, a.name[0].toUpperCase()), h('span', { class: 'grow' }, a.name, a.admin ? h('span', { class: 'muted small' }, ' · administrateur') : null),
        ME.admin && a.id !== ME.id ? h('button', { class: 'btn sm danger', onclick: async () => {
          if (!await dialog({ title: `Supprimer le compte « ${a.name} » ?`, text: 'Cette personne ne pourra plus se connecter. Ses pages sont conservées dans le dossier donnees/comptes (rien n’est effacé).', ok: 'Supprimer', danger: true })) return;
          try { await postJson('/api/accounts/remove', { id: a.id }); draw(); } catch (e) { toast(e.message); }
        } }, 'Retirer') : null))),
      ME.admin ? h('button', { class: 'mi', onclick: async () => {
        const v = await formDialog('Ajouter un compte', 'La personne aura son propre espace, vide au départ. Donnez-lui son nom et son mot de passe.',
          [{ label: 'Identifiant (e-mail ou prénom)' }, { label: 'Code (8 caractères minimum)', type: 'password' }], 'Ajouter');
        if (!v) return;
        try { await postJson('/api/accounts', { name: v[0], password: v[1] }); toast(`Compte « ${v[0]} » créé`); draw(); } catch (e) { toast(e.message); }
      } }, h('span', { class: 'mi-ic' }, '＋'), 'Ajouter un compte') : null,
      h('button', { class: 'mi', onclick: async () => {
        const v = await formDialog('Changer mon code', null, [{ label: 'Mot de passe actuel', type: 'password' }, { label: 'Nouveau mot de passe', type: 'password' }, { label: 'Retapez le nouveau', type: 'password' }], 'Changer');
        if (!v) return;
        if (v[1] !== v[2]) return toast('Les deux nouveaux mots de passe sont différents.');
        try { await postJson('/api/password', { old: v[0], password: v[1] }); toast('Mot de passe changé'); } catch (e) { toast(e.message); }
      } }, h('span', { class: 'mi-ic' }, '🔑'), 'Changer mon code'),
      h('button', { class: 'mi', onclick: () => { closeSettings(); logout(); } }, h('span', { class: 'mi-ic' }, '⇥'), 'Se déconnecter'));
  };
  draw();
  return box;
}
