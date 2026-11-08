// Pose la classe `js` sur <html>, avant le premier rendu : style.css ne cache les blocs `.reveal`
// que lorsqu'elle est là, parce que seul un script peut les faire apparaître. Chargé sans `defer`,
// dans le <head>, à la place de l'ancien script en ligne : la CSP du site n'en admet aucun.
document.documentElement.classList.add('js');
