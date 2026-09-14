# Media

Visuels de communication du projet. **Rien ici n'est publié** : ce dossier est exclu de l'image
Docker et ne part pas sur le site.

| Fichier | Quoi |
|---|---|
| `statuts-cycle-de-vie.png` | Les quatre statuts du cycle de vie, carré 2400 × 2400 |

Chaque visuel garde sa source HTML à côté, pour qu'on puisse corriger un mot sans repartir de zéro.
Les fontes et les couleurs sont celles du site (`../site/fonts/`, `../site/style.css`) : les visuels
et le site restent d'une seule pièce.

## Régénérer

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=2 --window-size=1200,1200 \
  --screenshot="media/statuts-cycle-de-vie.png" \
  "file://$PWD/media/statuts-cycle-de-vie.html"
```

`--force-device-scale-factor=2` double la densité : la fenêtre fait 1200 × 1200, le fichier
2400 × 2400. `--allow-file-access-from-files` est nécessaire pour que les fontes locales se chargent.
Sur une machine sans Chrome, n'importe quel navigateur sans interface fait l'affaire.
