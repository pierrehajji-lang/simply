# Zoubiders

Votre espace de travail personnel, façon Notion : pages, bases de données, modèles, schémas. Tout tourne **uniquement sur votre Mac**, sans compte ni Internet.

## Ouvrir Zoubiders

**Le plus simple :** double-cliquez sur **`Lancer Zoubiders.command`**.
Une fenêtre Terminal s'ouvre (laissez-la ouverte) et Zoubiders s'affiche dans votre navigateur à l'adresse http://localhost:3210.

> La première fois, macOS peut refuser d'ouvrir le fichier. Faites alors **clic droit › Ouvrir › Ouvrir**.

**Pour arrêter :** fermez la fenêtre Terminal (ou appuyez sur `Ctrl + C` dedans).

## Où sont mes données ?

Dans le dossier `donnees/` :
- `espace.json` : tout votre contenu, enregistré automatiquement à chaque modification ;
- `espace.sauvegarde.json` : une copie faite à chaque lancement ;
- `fichiers/` : les images que vous ajoutez.

Pour faire une sauvegarde, copiez le dossier `donnees/` ailleurs, ou utilisez **⚙ Réglages › Télécharger une sauvegarde**.

## Ce que vous pouvez faire

- **Pages et sous-pages** : « + » dans la barre latérale ; glissez une page sur une autre pour la ranger dedans. Favoris ⭐, corbeille 🗑 (restaurable).
- **Blocs** : tapez `/` pour insérer texte, titres, listes, cases à cocher, listes dépliables, encadrés, citations, code, images, tableaux simples, schémas, bases de données, sous-pages ou liens vers une page.
- **Mise en forme** : sélectionnez du texte → gras, italique, souligné, barré, code, lien, couleurs.
- **Images** : collez-les (⌘V) ou glissez-les dans la page ; redimensionnez avec la poignée à droite.
- **Schémas** : formes, notes et flèches ; double-clic pour écrire, glissez la flèche bleue → pour relier.
- **Bases de données** : chaque ligne est une **fiche** (une page avec ses propriétés). Vues **Tableau, Kanban, Calendrier, Galerie, Liste** ; filtres, tris, propriétés masquées, calculs en bas de colonne (somme, moyenne…), relations entre bases, modèles de fiche, import/export **CSV (Excel)**.
- **Modèles** : bouton « 🧩 Modèles » (planning éditorial, banque d'idées, scripts vidéo, projet, budget, clients…), dont une catégorie **Recherche d’emploi** (candidatures, CV, lettre, entretiens, réseau, comparatif d’offres, planning…). « Créer un modèle » : depuis une page, une page vide ou avec l’assistant IA ; ou sur une page, « ⋯ › Enregistrer comme modèle ».
- **Vues Graphique et Chronologie** : dans une base, « + » à côté des vues. Le graphique compte (ou additionne) les fiches par catégorie ; la chronologie place chaque fiche entre une date de début et une date de fin.
- **Assistant IA** (⌘J) : questions, explications, rédaction ; sélectionnez du texte puis « ✨ IA » pour corriger, améliorer, traduire. Réglages › Assistant IA : **Claude** (Internet + clé API payante, gardée dans donnees/ia.json) ou **IA locale Ollama** (gratuite, hors ligne). Si vous copiez Zoubiders ailleurs, lancez une fois npm install dans le dossier.
- **Comptes** : Réglages › Comptes › « Activer les comptes ». Le premier compte (administrateur) garde le contenu actuel ; chaque autre compte a son propre espace.
- **Accès depuis le Wi-Fi** : une fois les comptes activés, Réglages › Accès depuis le Wi-Fi › « Ouvrir au Wi-Fi ». L'adresse à taper sur les autres appareils s'affiche. Fermé par défaut ; à n'utiliser que sur un Wi-Fi de confiance.
- **Accès depuis Internet** : comptes activés, puis double-clic sur **`Ouvrir Zoubiders sur Internet.command`**. Un lien `https://….trycloudflare.com` s'affiche (aussi dans Réglages). Envoyez-le avec le **code d'invitation** (Réglages) : sans ce code, personne ne peut créer de compte. Le lien marche tant que cette fenêtre reste ouverte et change à chaque fois. Outil utilisé : cloudflared (Cloudflare), dans le dossier outils/.
- **Import** : ⚙ Réglages › Importer (export Notion, pages Markdown).
- **Raccourcis** : ⌘K rechercher · ⌘Z / ⇧⌘Z annuler / rétablir · Tab décaler · ⌘\ masquer la barre latérale.

## Vérifier que le serveur fonctionne (optionnel)

```bash
node test.js
```
