# Landing page

Site statique, sans build ni dépendance : `index.html`, `style.css`, `favicon.svg`. Chemins relatifs — se déploie tel quel à la racine ou dans un sous-dossier.

Déploiement sur un hébergement classique (rsync/SFTP) :

```bash
rsync -av --delete site/ utilisateur@hote:/chemin/vers/www/
```

Prévisualisation locale : `python3 -m http.server 4173 --directory site` puis http://localhost:4173.
