# Simply

Un espace de travail libre et gratuit, façon carnet numérique : pages, bases de données (tableau, Kanban, calendrier, galerie, graphique, chronologie), modèles prêts à l'emploi (dont une collection « Recherche d'emploi »), schémas et assistant IA.

## L'utiliser tout de suite

Ouvrez la version en ligne : **https://pierrehajji-lang.github.io/simply/**

- Rien à installer, pas de compte à créer.
- Vos pages sont enregistrées **dans votre navigateur**, sur votre appareil : personne d'autre ne les voit. Pensez à faire des sauvegardes (Réglages › Télécharger une sauvegarde).
- Assistant IA : ajoutez votre propre clé API Claude (Réglages › Assistant IA), ou utilisez une IA locale avec Ollama.

## L'installer sur son ordinateur (Mac)

Avec [Node.js](https://nodejs.org) installé :

```bash
npm install
node server.js
```

Simply s'ouvre sur http://localhost:3210. Vos données sont rangées dans le dossier `donnees/`. Sur Mac, vous pouvez aussi double-cliquer sur `Lancer Simply.command`.

Cette version installée ajoute : comptes avec un espace séparé par personne, accès depuis le Wi-Fi, partage par Internet (`Ouvrir Simply sur Internet.command`, qui utilise [cloudflared](https://github.com/cloudflare/cloudflared) à placer dans `outils/`). Le mode d'emploi complet est dans [LISEZMOI.md](LISEZMOI.md).

## Contribuer

Le code est volontairement simple : HTML, CSS et JavaScript sans framework (`public/`), plus un petit serveur Node (`server.js`). Vérification : `node test.js`.

Icônes : [Lucide](https://lucide.dev) (licence ISC). Licence de Simply : [MIT](LICENSE).
