// Zoubiders : petit serveur local (seule dépendance : le kit officiel Claude, utilisé pour l'assistant IA). Sert l'interface, enregistre les données dans un fichier JSON
// et range les images ajoutées dans donnees/fichiers/.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const os = require('os');

const PORT = Number(process.env.PORT) || 3210;
const PUB = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'donnees');
const FILES = path.join(DATA_DIR, 'fichiers');
const DATA = path.join(DATA_DIR, 'espace.json');
const URL = `http://localhost:${PORT}`;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
};
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg' };
const MAX_IMG = 25 * 1024 * 1024;

// ---------- Comptes (facultatifs) ----------
// Sans compte : un seul espace (donnees/espace.json), comme avant. Dès qu'un compte existe, il faut se connecter.
// Le premier compte (administrateur) garde l'espace existant ; chaque autre compte a le sien dans donnees/comptes/<id>/.
const ACCOUNTS = path.join(DATA_DIR, 'comptes.json');
const accounts = () => { try { return JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8')); } catch { return []; } };
const saveAccounts = list => fs.writeFileSync(ACCOUNTS, JSON.stringify(list, null, 2), { mode: 0o600 });
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const sessions = new Map(); // jeton de connexion -> id du compte (oublié quand Zoubiders s'arrête)
function currentUser(req) {
  const tok = (req.headers.cookie || '').match(/(?:^|;\s*)simply_session=([a-f0-9]+)/)?.[1];
  const id = tok && sessions.get(tok);
  return id ? accounts().find(a => a.id === id) || null : null;
}
function dataFileOf(user) {
  if (!user || user.admin) return DATA;
  const dir = path.join(DATA_DIR, 'comptes', user.id);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'espace.json');
}
const publicUser = a => a && { id: a.id, name: a.name, admin: !!a.admin };
const validName = n => typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 80;
const MIN_PW = 8;
const validPw = p => typeof p === 'string' && p.length >= MIN_PW && p.length <= 200;
function readJson(req, res, limit, cb) {
  readBody(req, limit, buf => { let b; try { b = JSON.parse(buf); } catch { return sendJson(res, 400, { error: 'Demande invalide' }); } cb(b || {}); });
}
function login(res, user) {
  const tok = crypto.randomBytes(24).toString('hex');
  sessions.set(tok, user.id);
  res.setHeader('Set-Cookie', `simply_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${viaTunnel(res.req) ? '; Secure' : ''}`);
}

// ---------- Accès depuis le Wi-Fi ----------
// Zoubiders écoute sur le réseau, mais n'accepte un autre appareil que si l'accès Wi-Fi est activé ET que des comptes existent.
const NET = path.join(DATA_DIR, 'reseau.json');
const netConf = () => { try { return JSON.parse(fs.readFileSync(NET, 'utf8')); } catch { return {}; } };
const wifiOn = () => !!netConf().wifi;
// Inscriptions libres : la personne à qui on donne l'adresse crée elle-même son compte (espace vide, séparé).
const signupOn = () => netConf().signup !== false;
// Une demande qui passe par le tunnel Internet arrive elle aussi de 127.0.0.1 : on la reconnaît à ses en-têtes de relais.
const viaTunnel = req => !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !viaTunnel(req);
const clientIp = req => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress);
// Code d'invitation : nécessaire pour créer soi-même un compte. Créé automatiquement, l'administrateur peut le changer.
function inviteCode(renew) {
  const c = netConf();
  if (!c.invite || renew) { c.invite = Array.from(crypto.randomBytes(6), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join(''); fs.writeFileSync(NET, JSON.stringify(c)); }
  return c.invite;
}
// Trop d'essais de connexion ratés depuis une même adresse : pause de 15 minutes.
const failures = new Map();
const blocked = ip => (failures.get(ip)?.until || 0) > Date.now();
function failed(ip) {
  const f = failures.get(ip) || { n: 0, until: 0 };
  if (++f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60e3; }
  failures.set(ip, f);
}
// Adresse publique du tunnel, écrite par « Ouvrir Zoubiders sur Internet.command » tant qu'il tourne.
const internetUrl = () => { try { return fs.readFileSync(path.join(DATA_DIR, 'lien-internet.txt'), 'utf8').trim() || null; } catch { return null; } };
const lanUrls = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}`);

// ---------- Assistant IA : Claude (Internet + clé API) ou IA locale Ollama (sans Internet) ----------
let Anthropic = null;
try { const m = require('@anthropic-ai/sdk'); Anthropic = m.default || m; } catch { /* kit absent : seule l'IA locale marche */ }
// La clé API reste dans ce fichier à part, jamais dans espace.json (qui part dans les sauvegardes).
const AI_CONF = path.join(DATA_DIR, 'ia.json');
const aiConf = () => { try { return JSON.parse(fs.readFileSync(AI_CONF, 'utf8')); } catch { return {}; } };
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

async function askClaude(conf, system, messages, effort) {
  if (!Anthropic) throw new Error('Le kit Claude n’est pas installé (lancez « npm install » dans le dossier de Zoubiders).');
  const client = new Anthropic(conf.apiKey ? { apiKey: conf.apiKey } : {});
  try {
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5', max_tokens: 16000, system, messages,
      output_config: { effort: effort === 'medium' ? 'medium' : 'low' },
      // Si le modèle principal refuse, l'API réessaie toute seule sur un modèle de secours.
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    if (r.stop_reason === 'refusal') throw new Error('L’IA a refusé de répondre à cette demande.');
    return r.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Clé API refusée : vérifiez-la dans Réglages › Assistant IA.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Trop de demandes d’un coup : réessayez dans une minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Impossible de joindre Claude : vérifiez votre connexion Internet.');
    if (e instanceof Anthropic.APIError) throw new Error(`Erreur de Claude (${e.status}) : ${e.message}`);
    if (!conf.apiKey) throw new Error('Aucune clé API Claude : ajoutez-la dans Réglages › Assistant IA (ou choisissez l’IA locale).');
    throw e;
  }
}
async function askOllama(conf, system, messages) {
  let r;
  try {
    r = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', body: JSON.stringify({ model: conf.ollamaModel || 'llama3.1', stream: false, messages: [{ role: 'system', content: system }, ...messages] }) });
  } catch { throw new Error('L’IA locale ne répond pas : ouvrez l’application Ollama, puis réessayez.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('IA locale : ' + (j.error || r.status) + (r.status === 404 ? ` (modèle absent : lancez « ollama pull ${conf.ollamaModel || 'llama3.1'} »)` : ''));
  return j.message?.content || '';
}

fs.mkdirSync(FILES, { recursive: true });
// Copie de secours à chaque démarrage : on peut revenir à l'état de la dernière ouverture.
if (fs.existsSync(DATA)) fs.copyFileSync(DATA, path.join(DATA_DIR, 'espace.sauvegarde.json'));

function readBody(req, limit, cb) {
  const chunks = []; let size = 0, over = false;
  req.on('data', c => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
  req.on('end', () => cb(over ? null : Buffer.concat(chunks)));
}

function sendFile(res, file) {
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

// Résout un chemin demandé à l'intérieur d'un dossier, sans jamais en sortir.
function inside(dir, rel) {
  const file = path.resolve(dir, '.' + rel);
  return file.startsWith(dir + path.sep) && fs.existsSync(file) && !fs.statSync(file).isDirectory() ? file : null;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }

  // Autre appareil du Wi-Fi : refusé tant que l'accès n'est pas ouvert et protégé par des comptes.
  // Depuis Internet (tunnel) : seulement si les comptes sont activés. Depuis le Wi-Fi : en plus, l'accès Wi-Fi doit être ouvert.
  if (!isLocal(req) && !(accounts().length && (viaTunnel(req) || wifiOn()))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(viaTunnel(req) ? 'Zoubiders n’est pas encore prêt : son propriétaire doit activer les comptes.' : 'Zoubiders n’est pas ouvert au Wi-Fi. Sur le Mac de Zoubiders : Réglages › Accès depuis le Wi-Fi.');
  }
  if (url === '/api/network' && req.method === 'GET') {
    if (!isLocal(req) && !currentUser(req)) return sendJson(res, 401, { error: 'Connexion requise' });
    const admin = !!currentUser(req)?.admin;
    return sendJson(res, 200, { wifi: wifiOn(), signup: signupOn(), accounts: accounts().length > 0, urls: lanUrls(), local: isLocal(req), internet: internetUrl(), invite: admin ? inviteCode() : undefined });
  }
  if (url === '/api/network' && req.method === 'PUT') {
    return readJson(req, res, 1024, b => {
      // Seulement depuis le Mac lui-même, et par l'administrateur une fois les comptes activés.
      if (!isLocal(req)) return sendJson(res, 403, { error: 'À régler depuis le Mac de Zoubiders.' });
      if (b.wifi === true && !accounts().length) return sendJson(res, 400, { error: 'Activez d’abord les comptes : sinon n’importe qui sur le Wi-Fi verrait vos pages.' });
      if (accounts().length && !currentUser(req)?.admin) return sendJson(res, 403, { error: 'Réservé à l’administrateur.' });
      const c = netConf();
      if (typeof b.wifi === 'boolean') c.wifi = b.wifi;
      if (typeof b.signup === 'boolean') c.signup = b.signup;
      fs.writeFileSync(NET, JSON.stringify(c));
      if (b.newInvite) inviteCode(true);
      sendJson(res, 200, { ok: true });
    });
  }
  // --- Comptes ---
  if (url === '/api/me' && req.method === 'GET') {
    const list = accounts();
    // On ne révèle pas la liste des comptes : chacun tape son identifiant.
    return sendJson(res, 200, { accounts: list.length > 0, user: publicUser(currentUser(req)), signup: signupOn(), minPw: MIN_PW });
  }
  if (url === '/api/login' && req.method === 'POST') {
    return readJson(req, res, 4096, b => {
      const ip = clientIp(req);
      if (blocked(ip)) return sendJson(res, 429, { error: 'Trop d’essais ratés : réessayez dans 15 minutes.' });
      const a = accounts().find(x => x.name.toLowerCase() === String(b.name || '').trim().toLowerCase());
      // shortcut: simple délai contre les essais en rafale ; suffisant sur un Wi-Fi de maison, pas pour Internet.
      if (!a || hashPw(b.password || '', a.salt) !== a.hash) return failed(ip), setTimeout(() => sendJson(res, 401, { error: 'Identifiant ou code incorrect.' }), 600);
      failures.delete(ip); login(res, a); sendJson(res, 200, { user: publicUser(a) });
    });
  }
  if (url === '/api/logout' && req.method === 'POST') {
    const tok = (req.headers.cookie || '').match(/simply_session=([a-f0-9]+)/)?.[1];
    if (tok) sessions.delete(tok);
    res.setHeader('Set-Cookie', 'simply_session=; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }
  if (url === '/api/accounts' && req.method === 'POST') {
    return readJson(req, res, 4096, b => {
      const list = accounts(), me = currentUser(req);
      // Le premier compte devient administrateur ; ensuite l'admin en ajoute, ou chacun s'inscrit si les inscriptions sont ouvertes.
      if (list.length && !me?.admin) {
        if (!signupOn()) return sendJson(res, 403, { error: 'Les inscriptions sont fermées : demandez un compte à l’administrateur.' });
        const ip = clientIp(req);
        if (blocked(ip)) return sendJson(res, 429, { error: 'Trop d’essais ratés : réessayez dans 15 minutes.' });
        if (String(b.invite || '').trim().toUpperCase() !== inviteCode()) { failed(ip); return sendJson(res, 403, { error: 'Code d’invitation incorrect : demandez-le à la personne qui vous a envoyé le lien.' }); }
      }
      if (!validName(b.name)) return sendJson(res, 400, { error: 'Choisissez un identifiant (e-mail ou prénom, 80 caractères maximum).' });
      if (!validPw(b.password)) return sendJson(res, 400, { error: `Le code doit faire au moins ${MIN_PW} caractères.` });
      if (list.some(a => a.name.toLowerCase() === b.name.trim().toLowerCase())) return sendJson(res, 400, { error: 'Cet identifiant est déjà pris.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const a = { id: crypto.randomBytes(6).toString('hex'), name: b.name.trim(), salt, hash: hashPw(b.password, salt), admin: !list.length, created: new Date().toISOString() };
      list.push(a); saveAccounts(list);
      if (!me) login(res, a);
      sendJson(res, 200, { user: publicUser(a) });
    });
  }
  if (url === '/api/accounts' && req.method === 'GET') {
    const me = currentUser(req);
    if (!me) return sendJson(res, 401, { error: 'Non connecté' });
    return sendJson(res, 200, accounts().map(publicUser));
  }
  if (url === '/api/accounts/remove' && req.method === 'POST') {
    return readJson(req, res, 4096, b => {
      const me = currentUser(req);
      if (!me?.admin) return sendJson(res, 403, { error: 'Réservé à l’administrateur.' });
      if (b.id === me.id) return sendJson(res, 400, { error: 'Vous ne pouvez pas supprimer votre propre compte.' });
      // Le compte disparaît de la liste, mais son dossier de données est conservé (donnees/comptes/<id>).
      saveAccounts(accounts().filter(a => a.id !== b.id));
      for (const [t, id] of sessions) if (id === b.id) sessions.delete(t);
      sendJson(res, 200, { ok: true });
    });
  }
  if (url === '/api/password' && req.method === 'POST') {
    return readJson(req, res, 4096, b => {
      const me = currentUser(req);
      if (!me) return sendJson(res, 401, { error: 'Non connecté' });
      if (hashPw(b.old || '', me.salt) !== me.hash) return sendJson(res, 400, { error: 'Mot de passe actuel incorrect.' });
      if (!validPw(b.password)) return sendJson(res, 400, { error: `Le nouveau code doit faire au moins ${MIN_PW} caractères.` });
      const list = accounts(), a = list.find(x => x.id === me.id);
      a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(b.password, a.salt);
      saveAccounts(list); sendJson(res, 200, { ok: true });
    });
  }
  // Dès qu'il existe des comptes, toutes les autres demandes exigent d'être connecté.
  const user = currentUser(req);
  if (url.startsWith('/api/') && !user && accounts().length) return sendJson(res, 401, { error: 'Connexion requise' });
  const DATA = dataFileOf(user);

  if (url === '/api/data') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.existsSync(DATA) ? fs.readFileSync(DATA) : 'null');
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      return readBody(req, 200 * 1024 * 1024, buf => {
        const body = buf && buf.toString('utf8');
        try {
          const d = JSON.parse(body);
          if (!d || !Array.isArray(d.pages)) throw new Error('format');
        } catch {
          res.writeHead(400);
          return res.end('Données invalides');
        }
        try {
          // Écriture dans un fichier temporaire puis renommage : le fichier n'est jamais à moitié écrit.
          fs.writeFileSync(DATA + '.tmp', body);
          fs.renameSync(DATA + '.tmp', DATA);
          res.writeHead(204);
          res.end();
        } catch (e) {
          res.writeHead(500);
          res.end(String(e));
        }
      });
    }
  }

  if (url === '/api/ai/config' && req.method === 'GET') {
    const c = aiConf();
    return sendJson(res, 200, { provider: c.provider || 'claude', ollamaModel: c.ollamaModel || 'llama3.1', hasKey: !!(c.apiKey || process.env.ANTHROPIC_API_KEY), sdk: !!Anthropic });
  }
  if (url === '/api/ai/config' && req.method === 'PUT') {
    return readBody(req, 64 * 1024, buf => {
      let b; try { b = JSON.parse(buf); } catch { return sendJson(res, 400, { error: 'Réglages invalides' }); }
      const c = aiConf();
      if (b.provider === 'claude' || b.provider === 'ollama') c.provider = b.provider;
      if (typeof b.ollamaModel === 'string' && b.ollamaModel.trim()) c.ollamaModel = b.ollamaModel.trim();
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) c.apiKey = b.apiKey.trim();
      if (b.clearKey) delete c.apiKey;
      fs.writeFileSync(AI_CONF, JSON.stringify(c, null, 2), { mode: 0o600 });
      sendJson(res, 200, { ok: true });
    });
  }
  if (url === '/api/ai' && req.method === 'POST') {
    return readBody(req, 4 * 1024 * 1024, async buf => {
      let b; try { b = JSON.parse(buf); } catch { return sendJson(res, 400, { error: 'Demande invalide' }); }
      if (!Array.isArray(b?.messages) || !b.messages.length) return sendJson(res, 400, { error: 'Demande vide' });
      const messages = b.messages.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content).map(m => ({ role: m.role, content: m.content }));
      const c = aiConf();
      try {
        const text = c.provider === 'ollama' ? await askOllama(c, String(b.system || ''), messages) : await askClaude(c, String(b.system || ''), messages, b.effort);
        sendJson(res, 200, { text });
      } catch (e) { sendJson(res, 502, { error: e.message }); }
    });
  }

  // Export Notion préparé dans le dossier « import » (lu à la demande par l'interface).
  if (url === '/api/notion-import' && req.method === 'GET') {
    const f = path.join(__dirname, 'import', 'notion-export.json');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Aucun export'); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(f));
  }

  // Envoi d'une image : le corps de la requête est l'image elle-même.
  if (url === '/api/upload' && req.method === 'POST') {
    const ext = IMG_EXT[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) { res.writeHead(415); return res.end('Seules les images sont acceptées'); }
    return readBody(req, MAX_IMG, buf => {
      if (!buf || !buf.length) { res.writeHead(413); return res.end('Image trop lourde (25 Mo maximum)'); }
      const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext;
      fs.writeFileSync(path.join(FILES, name), buf);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: '/fichiers/' + name }));
    });
  }

  if (url.startsWith('/fichiers/')) {
    if (!isLocal(req) && !user) { res.writeHead(401); return res.end(); }
    const file = inside(FILES, url.slice('/fichiers'.length));
    if (file) return sendFile(res, file);
  } else {
    const file = inside(PUB, url === '/' ? '/index.html' : url);
    if (file) return sendFile(res, file);
  }
  res.writeHead(404);
  res.end('Introuvable');
});

const openBrowser = () => { if (!process.env.NO_OPEN) exec(`open ${URL}`); };

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Zoubiders tourne déjà : ouverture de ${URL}`);
    openBrowser();
    process.exit(0);
  }
  throw e;
});

// 127.0.0.1 : l'app n'est accessible que depuis cet ordinateur.
// 0.0.0.0 : joignable depuis le Wi-Fi, mais les autres appareils sont refusés tant que l'accès n'est pas activé (voir plus haut).
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Zoubiders est lancé : ${URL}\n  Vos données : ${DATA}\n  Accès Wi-Fi : ${wifiOn() && accounts().length ? 'ouvert → ' + lanUrls().join(' ou ') : 'fermé (Réglages › Accès depuis le Wi-Fi)'}\n  Laissez cette fenêtre ouverte. Pour arrêter : Ctrl + C\n`);
  openBrowser();
});
