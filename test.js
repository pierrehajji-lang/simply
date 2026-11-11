// Vérification rapide du serveur : node test.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-'));
const PORT = 3299;
const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, NO_OPEN: '1' } });
const base = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

setTimeout(async () => {
  try {
    assert.strictEqual(await (await fetch(base + '/api/data')).json(), null);
    const data = { pages: [{ id: 'a', title: 'Été ✓' }] };
    assert.strictEqual((await fetch(base + '/api/data', { method: 'PUT', body: JSON.stringify(data) })).status, 204);
    assert.deepStrictEqual(await (await fetch(base + '/api/data')).json(), data);
    assert.strictEqual((await fetch(base + '/api/data', { method: 'PUT', body: '{oups' })).status, 400);
    const ai = await (await fetch(base + '/api/ai/config')).json();
    assert.ok(['claude', 'ollama'].includes(ai.provider) && typeof ai.hasKey === 'boolean');
    assert.strictEqual((await fetch(base + '/api/ai', { method: 'POST', body: '{}' })).status, 400);
    assert.strictEqual((await fetch(base + '/ia.json')).status, 404);
    assert.deepStrictEqual(await (await fetch(base + '/api/data')).json(), data, 'données invalides refusées');
    // Images : envoi, lecture, refus des autres fichiers.
    const up = await fetch(base + '/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG });
    assert.strictEqual(up.status, 200);
    const { url } = await up.json();
    const img = await fetch(base + url);
    assert.strictEqual(img.status, 200);
    assert.ok(Buffer.from(await img.arrayBuffer()).equals(PNG), 'image relue à l’identique');
    assert.strictEqual((await fetch(base + '/api/upload', { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: 'x' })).status, 415);
    // Impossible de sortir des dossiers autorisés.
    assert.strictEqual((await fetch(base + '/%2e%2e/server.js')).status, 404);
    assert.strictEqual((await fetch(base + '/fichiers/..%2Fespace.json')).status, 404);
    assert.strictEqual((await fetch(base + '/')).status, 200);
    for (const f of ['cloud-config.js', 'static.js', 'core.js', 'editor.js', 'diagram.js', 'db.js', 'ai.js', 'accounts.js', 'icons.js', 'app.js', 'style.css']) assert.strictEqual((await fetch(base + '/' + f)).status, 200, f);
    // Comptes : sans compte tout est ouvert ; après le premier compte, il faut se connecter et chacun a son espace.
    assert.deepStrictEqual((await (await fetch(base + '/api/me')).json()).accounts, false);
    // Via le tunnel Internet (en-tête de relais) : refusé tant qu'il n'y a pas de comptes, même si la demande vient de 127.0.0.1.
    const T = { 'cf-connecting-ip': '203.0.113.7' };
    assert.strictEqual((await fetch(base + '/api/data', { headers: T })).status, 403, 'tunnel refusé sans comptes');
    assert.strictEqual((await fetch(base + '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'Alice', password: 'court' }) })).status, 400, 'code de 8 caractères minimum');
    const mk = await fetch(base + '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'Alice', password: 'secret123' }) });
    assert.strictEqual(mk.status, 200);
    const alice = mk.headers.get('set-cookie').split(';')[0];
    assert.strictEqual((await fetch(base + '/api/data')).status, 401, 'connexion exigée');
    assert.deepStrictEqual(await (await fetch(base + '/api/data', { headers: { cookie: alice } })).json(), data, 'l’admin garde l’espace existant');
    assert.ok(!('names' in await (await fetch(base + '/api/me')).json()), 'la liste des comptes reste secrète');
    const invite = (await (await fetch(base + '/api/network', { headers: { cookie: alice } })).json()).invite;
    assert.ok(/^[A-Z0-9]{6}$/.test(invite), 'code d’invitation créé');
    assert.strictEqual((await (await fetch(base + '/api/network')).json()).invite, undefined, 'code visible seulement par l’admin');
    assert.strictEqual((await fetch(base + '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'bob@exemple.fr', password: 'motdepasse' }) })).status, 403, 'inscription sans code refusée');
    assert.strictEqual((await fetch(base + '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'bob@exemple.fr', password: 'x', invite }) })).status, 400, 'code trop court');
    assert.strictEqual((await fetch(base + '/api/accounts', { method: 'POST', headers: T, body: JSON.stringify({ name: 'bob@exemple.fr', password: 'motdepasse', invite: invite.toLowerCase() }) })).status, 200, 'inscription avec code, depuis Internet');
    assert.strictEqual((await fetch(base + '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'BOB@exemple.fr', password: 'autre1234', invite }) })).status, 400, 'identifiant unique');
    // Depuis Internet : page de connexion accessible, données protégées, réglages réseau interdits.
    assert.strictEqual((await fetch(base + '/api/me', { headers: T })).status, 200);
    assert.strictEqual((await fetch(base + '/api/data', { headers: T })).status, 401);
    assert.strictEqual((await fetch(base + '/api/network', { method: 'PUT', headers: { ...T, cookie: alice }, body: '{"wifi":true}' })).status, 403, 'réglages réseau seulement sur le Mac');
    // Essais ratés en rafale : blocage.
    const B = { 'cf-connecting-ip': '198.51.100.9' };
    for (let i = 0; i < 5; i++) await fetch(base + '/api/login', { method: 'POST', headers: B, body: JSON.stringify({ name: 'Alice', password: 'mauvais' + i }) });
    assert.strictEqual((await fetch(base + '/api/login', { method: 'POST', headers: B, body: JSON.stringify({ name: 'Alice', password: 'secret123' }) })).status, 429, 'bloqué après 5 essais');
    assert.strictEqual((await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ name: 'bob@exemple.fr', password: 'faux' }) })).status, 401);
    const lb = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ name: 'bob@exemple.fr', password: 'motdepasse' }) });
    const bob = lb.headers.get('set-cookie').split(';')[0];
    assert.strictEqual(await (await fetch(base + '/api/data', { headers: { cookie: bob } })).json(), null, 'Bob a un espace vide à lui');
    assert.ok(!fs.readFileSync(path.join(dir, 'comptes.json'), 'utf8').includes('motdepasse'), 'mot de passe jamais stocké en clair');
    const net = await (await fetch(base + '/api/network', { headers: { cookie: alice } })).json();
    assert.strictEqual(net.wifi, false, 'Wi-Fi fermé par défaut');
    // Depuis l'adresse Wi-Fi du Mac (vue comme un autre appareil) : refusé tant que l'accès est fermé, puis ouvert.
    const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    if (lan) assert.strictEqual((await fetch(`http://${lan.address}:${PORT}/api/me`)).status, 403, 'Wi-Fi fermé : refusé');
    assert.strictEqual((await fetch(base + '/api/network', { method: 'PUT', headers: { cookie: bob }, body: '{"wifi":true}' })).status, 403, 'seul l’admin ouvre le Wi-Fi');
    assert.strictEqual((await fetch(base + '/api/network', { method: 'PUT', headers: { cookie: alice }, body: '{"wifi":true}' })).status, 200);
    if (lan) {
      assert.strictEqual((await fetch(`http://${lan.address}:${PORT}/api/me`)).status, 200, 'Wi-Fi ouvert : page de connexion accessible');
      assert.strictEqual((await fetch(`http://${lan.address}:${PORT}/api/data`)).status, 401, 'mais données protégées');
      assert.strictEqual((await fetch(`http://${lan.address}:${PORT}/api/network`, { method: 'PUT', headers: { cookie: alice }, body: '{"wifi":false}' })).status, 403, 'réglage Wi-Fi seulement depuis le Mac');
    }
    assert.strictEqual((await fetch(base + '/api/network', { method: 'PUT', headers: { cookie: alice }, body: '{"signup":false}' })).status, 200);
    assert.strictEqual((await fetch(base + '/api/accounts', { method: 'POST', body: JSON.stringify({ name: 'carla', password: 'motdepasse', invite }) })).status, 403, 'inscriptions fermées');
    console.log('OK : tous les tests passent');
  } catch (e) {
    console.error('ÉCHEC :', e.message);
    process.exitCode = 1;
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true });
  }
}, 500);
