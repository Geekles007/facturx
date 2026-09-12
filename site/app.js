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
  const run = (el) => {
    const target = Number(el.dataset.count);
    if (reduce) {
      el.textContent = String(target);
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      const eased = 1 - (1 - p) ** 3;
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
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
    for (const el of counters) io.observe(el);
  } else {
    for (const el of counters) el.textContent = el.dataset.count;
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
    let timer;
    const flash = (text) => {
      b.classList.add('done');
      label.textContent = text;
      clearTimeout(timer);
      timer = setTimeout(() => {
        b.classList.remove('done');
        label.textContent = 'Copier';
      }, 1600);
    };
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        flash('Copié');
      } catch {
        flash(fallbackCopy(b) ? 'Copié' : 'Sélectionné');
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
