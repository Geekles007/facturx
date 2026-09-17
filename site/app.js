(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Nav : bordure à l'apparition du défilement
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Révélations : immédiates au-dessus de la ligne de flottaison, au défilement ensuite
  const reveals = [...document.querySelectorAll('.reveal')];
  const below = reveals.filter((el) => {
    if (el.getBoundingClientRect().top < innerHeight * 0.92) {
      el.classList.add('in');
      return false;
    }
    return true;
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    for (const el of below) io.observe(el);
    // Saut d'ancre : les éléments passés au-dessus de l'écran n'intersectent jamais
    let pending = below;
    addEventListener(
      'scroll',
      () => {
        if (pending.length === 0) return;
        pending = pending.filter((el) => {
          if (el.getBoundingClientRect().bottom > 0) return true;
          el.classList.add('in');
          io.unobserve(el);
          return false;
        });
      },
      { passive: true },
    );
  } else {
    for (const el of below) el.classList.add('in');
  }

  // Compteurs (tabular-nums, 900 ms, ease-out) — immédiat si mouvement réduit
  const counters = document.querySelectorAll('[data-count]');
  // `data-format="compact"` : 1 234 s'écrit « 1,2 k », dans la langue de la page. Un compteur dont
  // l'ordre de grandeur n'est pas connu d'avance tient ainsi dans sa colonne.
  const compact = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const show = (el, n) => {
    el.textContent = el.dataset.format === 'compact' ? compact.format(n) : String(n);
  };
  const run = (el) => {
    const target = Number(el.dataset.count);
    if (reduce) {
      show(el, target);
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      const eased = 1 - (1 - p) ** 3;
      show(el, Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  // Un compteur dont la valeur arrive après coup se remet en file : observé, il s'anime quand il
  // devient visible ; sans observateur, il s'affiche tout de suite.
  let queue;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            run(e.target);
            io.unobserve(e.target);
          }
      },
      { threshold: 0.6 },
    );
    queue = (el) => io.observe(el);
  } else {
    queue = run;
  }
  for (const el of counters) queue(el);

  // Téléchargements npm : chiffre relevé à la construction du site (scripts/fetch-npm-downloads.mjs)
  // et servi depuis le même domaine — la page ne contacte aucun tiers, et il n'y a donc rien à
  // consentir. Le fichier manque, ne répond pas ou ne dit pas ce qu'on attend : la case reste
  // cachée, comme elle l'est sans JavaScript.
  const npm = document.querySelector('[data-downloads]');
  if (npm) {
    fetch(npm.dataset.downloads)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ downloads, end }) => {
        if (!Number.isFinite(downloads) || downloads < 0) return;
        // La date de fin de période vient du relevé : un chiffre figé entre deux déploiements
        // reste daté plutôt que faux. Sans elle, la phrase finirait par « au » dans le vide.
        if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
        const when = npm.querySelector('time');
        when.dateTime = end;
        when.textContent = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
          dateStyle: 'medium',
          timeZone: 'UTC',
        }).format(new Date(`${end}T00:00:00Z`));
        const dd = npm.querySelector('[data-count]');
        dd.dataset.count = String(Math.round(downloads));
        npm.hidden = false;
        queue(dd);
      })
      .catch(() => {});
  }

  // Copier : API presse-papiers, sinon sélection + execCommand, sinon sélection seule
  const fallbackCopy = (b) => {
    const code = b.parentElement.querySelector('code');
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  };
  for (const b of document.querySelectorAll('.copy')) {
    const label = b.querySelector('span');
    // Les libellés viennent du document, pas du script : une seule version de ce fichier sert
    // la page française et la page anglaise, sans risque qu'elles divergent.
    const repos = label.textContent;
    const copie = b.dataset.copied ?? 'Copié';
    const selection = b.dataset.selected ?? 'Sélectionné';
    let timer;
    const flash = (text) => {
      b.classList.add('done');
      label.textContent = text;
      clearTimeout(timer);
      timer = setTimeout(() => {
        b.classList.remove('done');
        label.textContent = repos;
      }, 1600);
    };
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        flash(copie);
      } catch {
        flash(fallbackCopy(b) ? copie : selection);
      }
    });
  }

  // Onglets (clavier : flèches, Home, End) avec indicateur glissant
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const indicator = tablist.querySelector('.indicator');
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    const place = (tab) => {
      indicator.style.width = `${tab.offsetWidth}px`;
      indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
    };
    const select = (i, focus = false) => {
      tabs.forEach((t, j) => {
        const on = i === j;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      place(tabs[i]);
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', (e) => {
        const map = {
          ArrowRight: (i + 1) % tabs.length,
          ArrowLeft: (i - 1 + tabs.length) % tabs.length,
          Home: 0,
          End: tabs.length - 1,
        };
        if (e.key in map) {
          e.preventDefault();
          select(map[e.key], true);
        }
      });
    });
    place(tabs[0]);
    addEventListener(
      'resize',
      () => place(tabs.find((t) => t.getAttribute('aria-selected') === 'true')),
      { passive: true },
    );
  }
})();
