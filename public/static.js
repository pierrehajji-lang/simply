'use strict';
/* Simply — mode « site web » (ex. GitHub Pages) : il n'y a pas de serveur Simply derrière.
   On remplace alors les appels /api/… par des équivalents dans le navigateur :
   les pages sont gardées dans ce navigateur (IndexedDB), l'IA est appelée directement avec la clé du visiteur. */
(() => {
  const realFetch = window.fetch.bind(window);
  // Y a-t-il un vrai serveur Simply ? (oui en local, sur le Wi-Fi ou via le tunnel ; non sur un simple site web)
  const probe = realFetch('/api/me', { cache: 'no-store' })
    .then(r => r.status !== 404) // un site web simple répond « introuvable » ; un serveur Simply répond (même pour refuser)
    .catch(() => false)
    .then(server => { window.SIMPLY_STATIC = !server; window.SIMPLY_CLOUD_ON = !server && !!(window.SIMPLY_CLOUD?.url && window.SIMPLY_CLOUD?.key); return !server; });

  // --- Petit coffre dans le navigateur (IndexedDB : bien plus grand que localStorage) ---
  let dbp = null;
  const db = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('simply', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const kv = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('kv', mode); const q = fn(tx.objectStore('kv')); tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error); }); };
  const kvGet = k => kv('readonly', s => s.get(k));
  const kvSet = (k, v) => kv('readwrite', s => s.put(v, k));

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const aiConf = () => { try { return JSON.parse(localStorage.getItem('simply-ia')) || {}; } catch { return {}; } };

  async function askClaude(conf, system, messages, effort) {
    if (!conf.apiKey) throw new Error('Aucune clé API Claude : ajoutez-la dans Réglages › Assistant IA (elle reste dans ce navigateur).');
    // Le kit officiel Claude, chargé seulement quand on utilise l'IA.
    const { default: Anthropic } = await import('https://esm.sh/@anthropic-ai/sdk@1.8.0');
    const client = new Anthropic({ apiKey: conf.apiKey, dangerouslyAllowBrowser: true });
    try {
      const r = await client.beta.messages.create({
        model: 'claude-opus-5-5', max_tokens: 16000, system, messages,
        output_config: { effort: effort === 'medium' ? 'medium' : 'low' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      });
      if (r.stop_reason === 'refusal') throw new Error('L’IA a refusé de répondre à cette demande.');
      return r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Clé API refusée : vérifiez-la dans Réglages › Assistant IA.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Trop de demandes d’un coup : réessayez dans une minute.');
      if (e instanceof Anthropic.APIConnectionError) throw new Error('Impossible de joindre Claude : vérifiez votre connexion Internet.');
      if (e instanceof Anthropic.APIError) throw new Error(`Erreur de Claude (${e.status}) : ${e.message}`);
      throw e;
    }
  }
  async function askOllama(conf, system, messages) {
    let r;
    try { r = await realFetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: conf.ollamaModel || 'llama3.1', stream: false, messages: [{ role: 'system', content: system }, ...messages] }) }); }
    catch { throw new Error('L’IA locale ne répond pas : Ollama doit être ouvert sur cet ordinateur et autoriser ce site (réglage OLLAMA_ORIGINS).'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('IA locale : ' + (j.error || r.status));
    return j.message?.content || '';
  }

  // --- Comptes en ligne (Supabase) : seulement si cloud-config.js est rempli ---
  const CL = window.SIMPLY_CLOUD || {};
  const cloudOn = !!(CL.url && CL.key);
  let sbp = null;
  const sb = () => sbp ||= import('https://esm.sh/@supabase/supabase-js@2.118.0').then(m => m.createClient(CL.url, CL.key));
  // Supabase veut une adresse e-mail : un simple prénom devient « prenom@utilisateurs.simply.app » (adresse fictive).
  const toEmail = n => { n = String(n || '').trim().toLowerCase(); return n.includes('@') ? n : n.normalize('NFD').replace(/[^a-z0-9._-]/g, '') + '@utilisateurs.simply.app'; };
  const nameOf = u => u.user_metadata?.name || u.email.replace('@utilisateurs.simply.app', '');
  async function cloud(path, method, body) {
    const s = await sb();
    const { data: { session } } = await s.auth.getSession();
    const u = session?.user;
    const b = () => { try { return JSON.parse(body || '{}'); } catch { return {}; } };
    if (path === '/api/me') return json({ accounts: true, user: u ? { id: u.id, name: nameOf(u), admin: false } : null, signup: true, minPw: 8, cloud: true });
    if (path === '/api/login') {
      const { error } = await s.auth.signInWithPassword({ email: toEmail(b().name), password: String(b().password || '') });
      return error ? json({ error: /rate|many/i.test(error.message) ? 'Trop d’essais : réessayez dans quelques minutes.' : 'Identifiant ou code incorrect.' }, 401) : json({ ok: true });
    }
    if (path === '/api/accounts' && method === 'POST') {
      const { name, password } = b();
      if (!String(name || '').trim()) return json({ error: 'Choisissez un identifiant (e-mail ou prénom).' }, 400);
      if (String(password || '').length < 8) return json({ error: 'Le code doit faire au moins 8 caractères.' }, 400);
      const { data, error } = await s.auth.signUp({ email: toEmail(name), password, options: { data: { name: String(name).trim() } } });
      if (error) return json({ error: /registered|exists/i.test(error.message) ? 'Cet identifiant est déjà pris.' : /invalid/i.test(error.message) ? 'Identifiant non accepté : essayez une adresse e-mail.' : 'Inscription impossible : ' + error.message }, 400);
      if (!data.session) return json({ error: 'Compte créé : confirmez-le avec le lien reçu par e-mail, puis connectez-vous.' }, 400);
      return json({ ok: true });
    }
    if (path === '/api/accounts') return json(u ? [{ id: u.id, name: nameOf(u), admin: false }] : []);
    if (path === '/api/logout') { await s.auth.signOut(); return json({ ok: true }); }
    if (!u) return json({ error: 'Connexion requise' }, 401);
    if (path === '/api/password') {
      const { old, password } = b();
      if (String(password || '').length < 8) return json({ error: 'Le nouveau code doit faire au moins 8 caractères.' }, 400);
      if ((await s.auth.signInWithPassword({ email: u.email, password: String(old || '') })).error) return json({ error: 'Code actuel incorrect.' }, 400);
      const { error } = await s.auth.updateUser({ password });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    if (path === '/api/data') {
      // Une ligne par compte dans la table « espaces » ; les règles de la base empêchent de lire celle des autres.
      if (method === 'GET') {
        const { data, error } = await s.from('espaces').select('data').eq('user_id', u.id).maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return new Response(data?.data ?? 'null', { headers: { 'Content-Type': 'application/json' } });
      }
      try { if (!Array.isArray(JSON.parse(body).pages)) throw 0; } catch { return json({ error: 'Données invalides' }, 400); }
      const { error } = await s.from('espaces').upsert({ user_id: u.id, data: body, updated_at: new Date().toISOString() });
      return error ? json({ error: error.message }, 500) : new Response(null, { status: 204 });
    }
    return null; // le reste (images, IA…) fonctionne comme sans comptes
  }

  async function local(path, method, body) {
    if (path === '/api/me') return json({ accounts: false, user: null, static: true });
    if (path === '/api/network') return json({ static: true });
    if (path === '/api/data') {
      if (method === 'GET') return new Response((await kvGet('espace')) ?? 'null', { headers: { 'Content-Type': 'application/json' } });
      try { if (!Array.isArray(JSON.parse(body).pages)) throw 0; } catch { return json({ error: 'Données invalides' }, 400); }
      await kvSet('espace', body);
      return new Response(null, { status: 204 });
    }
    if (path === '/api/upload') {
      // shortcut: l'image est rangée dans la page elle-même (data:) ; au-delà de quelques Mo par image, passer à un stockage à part.
      if (!(body instanceof Blob) || !/^image\//.test(body.type)) return json({ error: 'Seules les images sont acceptées' }, 415);
      if (body.size > 5 * 1024 * 1024) return json({ error: 'Image trop lourde pour la version en ligne (5 Mo maximum)' }, 413);
      const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(body); });
      return json({ url });
    }
    if (path === '/api/ai/config') {
      const c = aiConf();
      if (method === 'GET') return json({ provider: c.provider || 'claude', ollamaModel: c.ollamaModel || 'llama3.1', hasKey: !!c.apiKey, sdk: true, static: true });
      let b; try { b = JSON.parse(body); } catch { return json({ error: 'Réglages invalides' }, 400); }
      if (b.provider === 'claude' || b.provider === 'ollama') c.provider = b.provider;
      if (typeof b.ollamaModel === 'string' && b.ollamaModel.trim()) c.ollamaModel = b.ollamaModel.trim();
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) c.apiKey = b.apiKey.trim();
      if (b.clearKey) delete c.apiKey;
      localStorage.setItem('simply-ia', JSON.stringify(c));
      return json({ ok: true });
    }
    if (path === '/api/ai') {
      let b; try { b = JSON.parse(body); } catch { return json({ error: 'Demande invalide' }, 400); }
      const messages = (b.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content);
      if (!messages.length) return json({ error: 'Demande vide' }, 400);
      const c = aiConf();
      try { return json({ text: c.provider === 'ollama' ? await askOllama(c, String(b.system || ''), messages) : await askClaude(c, String(b.system || ''), messages, b.effort) }); }
      catch (e) { return json({ error: e.message }, 502); }
    }
    return json({ error: 'Pas disponible dans la version en ligne' }, 404);
  }

  window.fetch = async (input, opts = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/') || !(await probe)) return realFetch(input, opts);
    const path = url.split('?')[0], method = (opts.method || 'GET').toUpperCase();
    if (cloudOn) { const r = await cloud(path, method, opts.body); if (r) return r; }
    return local(path, method, opts.body);
  };
})();
