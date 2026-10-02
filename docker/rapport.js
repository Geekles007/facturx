/**
 * Complément du rapport GoAccess, chargé par `--html-custom-js` (docker/goaccess-report.sh) : un
 * lien vers la page des compteurs, à côté du titre du rapport. GoAccess n'a pas d'option pour en
 * ajouter un ; si une version future renomme l'élément visé, le lien manque, et rien d'autre.
 */
(() => {
  const titre = document.querySelector('.report-title');
  if (!titre) return;
  const lien = document.createElement('a');
  lien.href = 'compteurs.html';
  lien.textContent = 'Compteurs jour par jour';
  titre.append(' · ', lien);
})();
