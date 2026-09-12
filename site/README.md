# Landing page

Site statique, sans build ni dépendance : `index.html`, `style.css`, `app.js`, `favicon.svg` et les polices Geist (`fonts/`, licence SIL OFL). Chemins relatifs — se déploie tel quel à la racine ou dans un sous-dossier.

Déploiement sur un hébergement classique (rsync/SFTP) :

```bash
rsync -av --delete site/ utilisateur@hote:/chemin/vers/www/
```

Prévisualisation locale : `python3 -m http.server 4173 --directory site` puis http://localhost:4173.

Les chiffres (tests, règles BR-FR, fichiers tiers, version npm) sont écrits en dur dans `index.html` : les mettre à jour à chaque release.

Le JavaScript est optionnel (révélations au défilement, compteurs, onglets, bouton Copier) ; sans lui, tout le contenu reste lisible et les trois exemples de code sont accessibles. `prefers-reduced-motion` désactive les animations.
