(() => {
  'use strict';

  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  /* ───────────────────────── contributions ───────────────────────── */

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderContributions() {
    const data = window.CONTRIBUTIONS;
    const grid = document.querySelector('.contributions .grid');
    const total = document.querySelector('.contrib-total');
    if (!data || !grid) {
      document.querySelector('.contributions')?.remove();
      return;
    }
    total.textContent = `${data.total.toLocaleString('en-US')} in the last year`;
    const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
    const frag = document.createDocumentFragment();
    data.weeks.forEach((week, wi) => {
      const col = document.createElement('div');
      col.className = 'week';
      const first = new Date(`${week[0][0]}T00:00:00Z`).getUTCDay();
      const lead = wi === 0 ? first : 0;
      for (let i = 0; i < lead; i++) col.append(Object.assign(document.createElement('span'), { className: 'pad' }));
      for (const [date, count, level] of week) {
        const d = new Date(`${date}T00:00:00Z`);
        const cell = document.createElement('span');
        cell.dataset.level = level;
        const what = count === 0 ? 'No contributions' : `${count} contribution${count === 1 ? '' : 's'}`;
        cell.title = `${what} on ${month.format(d)} ${ordinal(d.getUTCDate())}.`;
        col.append(cell);
      }
      for (let i = lead + week.length; i < 7; i++) col.append(Object.assign(document.createElement('span'), { className: 'pad' }));
      frag.append(col);
    });
    grid.replaceChildren(frag);
  }

  /* ───────────────────────── skyline ───────────────────────── */

  function mountSkyline() {
    const frame = document.querySelector('.art');
    const pre = frame?.querySelector('pre');
    if (!frame || !pre || !window.Skylines) return;

    const nameEl = document.querySelector('.city-name');
    const vantageEl = document.querySelector('.city-vantage');
    const timeEl = document.querySelector('.city-time');
    const cityLinks = [...document.querySelectorAll('.city-link')];
    const clocks = new Map();

    const clock = (tz) => {
      if (!clocks.has(tz)) {
        clocks.set(tz, new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }));
      }
      return clocks.get(tz).format(new Date()).toLowerCase();
    };

    let current = null;
    const tick = () => {
      if (current) timeEl.textContent = clock(current.tz);
    };

    const sky = window.Skylines.createSkyline(frame, pre, {
      onChange(scene) {
        current = scene;
        nameEl.textContent = scene.name;
        vantageEl.textContent = scene.vantage;
        frame.setAttribute('aria-label', `ASCII skyline of ${scene.name.split(',')[0]}, ${scene.vantage}`);
        cityLinks.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.city === scene.slug)));
        store.set('skyline-city', scene.slug);
        tick();
      },
    });

    // ?city=nyc opens a given city; otherwise open on a different one than last visit
    const asked = sky.bySlug(new URLSearchParams(location.search).get('city') || '');
    const last = store.get('skyline-city');
    const pool = sky.scenes.map((s, i) => i).filter((i) => sky.scenes[i].slug !== last);
    sky.start(asked >= 0 ? asked : pool[Math.floor(Math.random() * pool.length)]);

    setInterval(tick, 10_000);

    frame.addEventListener('click', () => sky.step(1));
    document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => sky.step(Number(b.dataset.step))));

    cityLinks.forEach((b) =>
      b.addEventListener('click', () => {
        sky.go(sky.bySlug(b.dataset.city));
        // On phones the skyline sits below the bio; bring it into view
        const rect = frame.getBoundingClientRect();
        if (rect.top > innerHeight || rect.bottom < 0) frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }),
    );

    addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight') sky.step(1);
      else if (e.key === 'ArrowLeft') sky.step(-1);
    });
  }

  renderContributions();
  mountSkyline();
})();
