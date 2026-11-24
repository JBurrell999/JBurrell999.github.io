/*
 * Skylines: San Francisco, New York and Atlanta, drawn live in ASCII.
 *
 * Each city is painted with plain canvas shapes into a small offscreen
 * buffer, averaged into character cells, and printed into a <pre>. Thin
 * structures (cables, spires, suspenders) are detected per cell and drawn
 * with line glyphs. Water, fog, stars, windows, aircraft lights and
 * fireflies are animated per frame in cell space, which keeps it cheap.
 */
(() => {
  'use strict';

  const W = 1000; // scene width, in scene units
  const BASE = 460; // height of the composed scene; taller frames get more sky
  const RAMP = ' .:-=+*#%@'; // dense glyphs read as light on the dark page
  const WATER = ' .-~~=+*#';
  const SCRAMBLE = '.:-=+*#%@/\\|';

  const PALETTE = {
    orange: [240, 98, 64], // international orange
    gold: [238, 192, 96],
    red: [255, 70, 56],
    crown: [150, 186, 255],
    firefly: [228, 222, 112],
  };
  const PALETTE_NAMES = Object.keys(PALETTE);
  const PALETTE_CSS = PALETTE_NAMES.map((n) => `rgb(${PALETTE[n].join(',')})`);
  const PALETTE_UNIT = PALETTE_NAMES.map((n) => {
    const [r, g, b] = PALETTE[n];
    const m = Math.hypot(r, g, b);
    return [r / m, g / m, b / m];
  });
  const RED = PALETTE_NAMES.indexOf('red');
  const FIREFLY = PALETTE_NAMES.indexOf('firefly');

  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  function hash(x, y, s = 0) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, 7);
    const b = hash(xi + 1, yi, 7);
    const c = hash(xi, yi + 1, 7);
    const d = hash(xi + 1, yi + 1, 7);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  const fbm = (x, y) =>
    vnoise(x, y) * 0.55 + vnoise(x * 2.03 + 5.2, y * 2.03 + 1.3) * 0.3 + vnoise(x * 4.1 + 9.7, y * 4.1 + 3.1) * 0.15;

  function mulberry(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ───────────────────────── drawing kit ───────────────────────── */

  function makeKit(ctx, mask, top, seed) {
    const rand = mulberry(seed);
    const lights = [];
    const moons = [];
    const shade = (v) => {
      const c = Math.round(clamp(v) * 255);
      return `rgb(${c},${c},${c})`;
    };
    const tint = (name, v) => {
      const [r, g, b] = PALETTE[name];
      const k = (clamp(v) * 255) / Math.max(r, g, b);
      return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
    };
    const paint = (s) => (typeof s === 'number' ? shade(s) : s);
    const path = (c, pts) => {
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    };

    // Every shape is painted on the picture and, in black, on the window mask,
    // so whatever is drawn later hides the windows behind it
    const draw = (s, shape, stroke = 0) => {
      for (const [c, style] of [[ctx, s], [mask, '#000']]) {
        c.beginPath();
        shape(c);
        if (stroke) {
          c.strokeStyle = style;
          c.lineWidth = stroke;
          c.lineCap = 'butt';
          c.stroke();
        } else {
          c.fillStyle = style;
          c.fill();
        }
      }
    };
    const gradient = (x, w, stops) => {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      stops.forEach(([at, v]) => g.addColorStop(at, shade(v)));
      return g;
    };

    const kit = {
      rand,
      top,
      lights,
      moons,
      shade,
      tint,
      rect(x, y, w, h, s) {
        draw(paint(s), (c) => c.rect(x, y, w, h));
      },
      poly(pts, s) {
        draw(paint(s), (c) => path(c, pts));
      },
      line(x1, y1, x2, y2, w, s) {
        draw(paint(s), (c) => {
          c.moveTo(x1, y1);
          c.lineTo(x2, y2);
        }, w);
      },
      curve(a, m, b, w, s) {
        draw(paint(s), (c) => {
          c.moveTo(a[0], a[1]);
          c.quadraticCurveTo(m[0], m[1], b[0], b[1]);
        }, w);
      },
      circle(x, y, r, s) {
        draw(paint(s), (c) => c.arc(x, y, r, 0, Math.PI * 2));
      },
      // Upper half of an ellipse standing on y
      dome(x, y, rx, ry, s) {
        draw(paint(s), (c) => {
          c.ellipse(x, y, rx, ry, 0, Math.PI, Math.PI * 2);
          c.closePath();
        });
      },
      // Pointed gothic arch opening, springing at y
      gothic(x, y, hw, rise, s) {
        draw(paint(s), (c) => {
          c.moveTo(x - hw, y);
          c.quadraticCurveTo(x - hw, y - rise * 0.62, x, y - rise);
          c.quadraticCurveTo(x + hw, y - rise * 0.62, x + hw, y);
          c.closePath();
        });
      },
      // Lit windows go wherever glass is painted; lit is the share that's on
      glass(x, y, w, h, lit = 0.5) {
        mask.fillStyle = `rgb(${Math.round(lit * 255)},0,0)`;
        mask.fillRect(x, y, w, h);
      },
      glassPoly(pts, lit = 0.5) {
        mask.fillStyle = `rgb(${Math.round(lit * 255)},0,0)`;
        path(mask, pts);
        mask.fill();
      },
      // A building face lit from the left, with a window grid inset from its edges
      block(x, y, w, bottom, v, { glass = true, lit = 0.25 + rand() * 0.45, light = 0.14 } = {}) {
        draw(gradient(x, w, [[0, v * (1 + light)], [1, v * (1 - light * 1.8)]]), (c) => c.rect(x, y, w, bottom - y));
        if (glass && w > 9) kit.glass(x + Math.min(4, w * 0.18), y + 5, w - Math.min(8, w * 0.36), bottom - y - 5, lit);
      },
      // Round body shaded like a cylinder
      cylinder(x, y, w, bottom, v) {
        draw(gradient(x, w, [[0, v * 0.55], [0.3, v * 1.15], [1, v * 0.35]]), (c) => c.rect(x, y, w, bottom - y));
      },
      // Drawn per cell after sampling, so its rim stays soft instead of turning into line glyphs
      moon(x, y, r) {
        moons.push([x, y, r]);
      },
      light(x, y, color = 'red', steady = false) {
        lights.push([x, y, color, steady]);
      },
    };
    return kit;
  }

  // Point on a quadratic curve whose control point sits midway in x
  const onCurve = (a, c, b, x) => {
    const t = (x - a[0]) / (b[0] - a[0]);
    return (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1];
  };

  /* ───────────────────────── the cities ───────────────────────── */

  const SCENES = [
    {
      slug: 'sf',
      name: 'San Francisco, CA',
      vantage: 'from the Marin Headlands',
      tz: 'America/Los_Angeles',
      water: 396,
      stars: 0.0035,
      fog: true,
      draw(k) {
        const r = k.rand;
        const O = (v) => k.tint('orange', v);
        const deck = 318;

        k.moon(150, k.top + 74, 20);

        // The city's hills across the strait
        k.poly(
          [[400, 397], [450, 388], [510, 382], [570, 379], [630, 377], [700, 378], [760, 372], [820, 366],
            [880, 359], [930, 352], [980, 348], [1070, 354], [1070, 397]],
          0.11,
        );

        // Downtown, small and hazy behind the bridge
        for (let x = 568; x < 905;) {
          const w = 7 + r() * 11;
          const h = 8 + r() * 36 * (1 - Math.abs(x - 735) / 230);
          k.block(x, 378 - h, w, 382, 0.24 + r() * 0.1, { lit: 0.4 });
          x += w + 1 + r() * 2;
        }
        k.poly([[680, 380], [704, 380], [692, 290]], 0.52); // Transamerica Pyramid
        k.line(692, 292, 692, 276, 1.6, 0.55);
        k.block(744, 306, 22, 380, 0.46, { lit: 0.6 }); // Salesforce Tower
        k.dome(755, 307, 11, 11, 0.5);
        k.poly([[770, 380], [783, 380], [783, 322], [776, 316], [770, 322]], 0.36); // 181 Fremont

        // Sutro Tower on the far hill
        const sx = 962;
        const sb = 350;
        k.line(sx - 9, sb, sx, sb - 58, 1.6, 0.32);
        k.line(sx + 9, sb, sx, sb - 58, 1.6, 0.32);
        k.line(sx, sb, sx, sb - 58, 1.2, 0.28);
        k.rect(sx - 8, sb - 52, 16, 2.5, 0.32);
        k.rect(sx - 6, sb - 38, 12, 2, 0.28);
        k.light(sx, sb - 60);

        // Marin hillside in the foreground
        k.poly(
          [[-80, 228], [-10, 224], [36, 234], [80, 252], [126, 280], [170, 306], [206, 330], [244, 352],
            [286, 372], [326, 388], [352, 397], [-80, 397]],
          0.16,
        );

        // Towers: two stepped legs joined by art deco portals
        const tower = (cx, top, s) => {
          const base = 397;
          const half = 21 * s;
          const H = base - top;
          for (const side of [-1, 1]) {
            const x = cx + side * half;
            const v = side < 0 ? 0.9 : 0.62;
            k.rect(x - 4.5 * s, top, 9 * s, H * 0.36, O(v));
            k.rect(x - 5.5 * s, top + H * 0.36, 11 * s, H * 0.32, O(v));
            k.rect(x - 6.5 * s, top + H * 0.68, 13 * s, H * 0.32, O(v * 0.92));
            k.rect(x - 6 * s, top - 4 * s, 12 * s, 5 * s, O(v));
            k.light(x, top - 6 * s);
          }
          for (const f of [0, 0.22, 0.43, 0.64]) {
            const y = top + f * (deck - top);
            k.rect(cx - half, y, half * 2, 8 * s, O(0.78));
            k.rect(cx - half + 7 * s, y + 2.5 * s, half * 2 - 14 * s, 3 * s, O(0.42));
          }
          k.rect(cx - half, deck + 18 * s, half * 2, 7 * s, O(0.6));
        };
        tower(300, 52, 1);
        tower(772, 130, 0.74);

        // Roadway and stiffening truss
        k.rect(-60, deck, 1120, 7, O(0.72));
        k.rect(-60, deck + 7, 1120, 6, O(0.18));
        for (let x = -60; x < 1060; x += 14) {
          k.line(x, deck + 7, x + 7, deck + 13, 1, O(0.5));
          k.line(x + 7, deck + 13, x + 14, deck + 7, 1, O(0.5));
        }

        // Main cables and suspenders
        const A = [300, 54];
        const B = [772, 132];
        const C = [(A[0] + B[0]) / 2, (4 * (deck - 8) - A[1] - B[1]) / 2];
        const L = [-60, deck - 2];
        const CL = [(A[0] + L[0]) / 2, 292];
        const R = [1060, deck - 2];
        const CR = [(B[0] + R[0]) / 2, 296];
        for (const [a, c, b] of [[L, CL, A], [A, C, B], [B, CR, R]]) {
          for (let x = Math.min(a[0], b[0]) + 12; x < Math.max(a[0], b[0]) - 8; x += 17) {
            k.line(x, onCurve(a, c, b, x) + 3, x, deck, 0.8, O(0.4));
          }
          k.curve(a, c, b, 2.6, O(0.95));
        }
      },
    },

    {
      slug: 'nyc',
      name: 'New York, NY',
      vantage: 'from Brooklyn Bridge Park',
      tz: 'America/New_York',
      water: 398,
      stars: 0.006,
      draw(k) {
        const r = k.rand;
        const shore = 394;

        // Midtown, further off
        for (let x = 610; x < 1060;) {
          const w = 9 + r() * 14;
          const h = 50 + r() * 100;
          k.block(x, shore - h, w, shore, 0.19 + r() * 0.07, { lit: 0.3 });
          x += w + r() * 3;
        }
        // Chrysler Building: stacked stainless arches and a needle
        {
          const cx = 878;
          k.block(cx - 12, 196, 24, shore, 0.36);
          let w = 12;
          let y = 197;
          for (let i = 0; i < 5; i++) {
            k.dome(cx, y, w, 11, i % 2 ? 0.5 : 0.7);
            y -= 8;
            w *= 0.78;
          }
          k.poly([[cx - 2.4, y + 6], [cx + 2.4, y + 6], [cx, y - 44]], 0.7);
        }
        // One Vanderbilt
        k.block(820, 168, 22, shore, 0.3);
        k.poly([[820, 168], [842, 168], [835, 140], [827, 140]], 0.36);
        k.line(831, 140, 831, 108, 1.2, 0.4);
        // Empire State Building, crown lit
        {
          const cx = 760;
          k.block(cx - 25, 262, 50, shore, 0.32);
          k.block(cx - 19, 220, 38, 262, 0.36);
          k.block(cx - 14, 152, 28, 220, 0.4, { lit: 0.6 });
          k.block(cx - 10, 140, 20, 152, 0.44, { glass: false });
          k.block(cx - 7, 131, 14, 140, 0.46, { glass: false });
          k.poly([[cx - 6, 131], [cx + 6, 131], [cx + 4, 106], [cx - 4, 106]], k.tint('crown', 0.78));
          k.poly([[cx - 4, 106], [cx + 4, 106], [cx + 2, 95], [cx - 2, 95]], k.tint('crown', 0.9));
          k.line(cx, 95, cx, 56, 1.4, 0.55);
          k.light(cx, 54);
        }
        // Billionaires' Row: 432 Park, Central Park Tower, Steinway Tower
        k.block(928, 104, 13, shore, 0.34, { lit: 0.6 });
        k.block(952, 96, 19, shore, 0.3);
        k.block(984, 130, 9, shore, 0.36, { glass: false });
        k.rect(984, 118, 6, 12, 0.36);
        k.rect(984, 110, 3, 8, 0.36);
        k.light(961, 94);

        // Downtown, closer
        for (let x = 300; x < 660;) {
          const w = 12 + r() * 18;
          const h = 30 + r() * 90;
          k.block(x, shore - h, w, shore, 0.28 + r() * 0.1);
          x += w + r() * 2;
        }
        // Woolworth Building
        k.block(368, 282, 30, shore, 0.46);
        k.block(374, 252, 18, 282, 0.5, { glass: false });
        k.poly([[372, 253], [394, 253], [383, 228]], 0.56);
        k.line(383, 230, 383, 218, 1.2, 0.56);
        // 7 WTC
        k.block(408, 244, 32, shore, 0.4, { lit: 0.6 });
        // 70 Pine, with its spire
        k.block(640, 266, 20, shore, 0.38);
        k.poly([[640, 266], [660, 266], [650, 244]], 0.44);
        k.line(650, 246, 650, 226, 1.2, 0.44);
        // 4 WTC and 3 WTC
        k.block(578, 232, 30, shore, 0.42, { lit: 0.55 });
        k.poly([[578, 232], [608, 232], [608, 222]], 0.42);
        k.block(524, 192, 34, shore, 0.48, { lit: 0.5 });
        k.line(524, 196, 558, 236, 1.2, 0.62);
        k.line(558, 196, 524, 236, 1.2, 0.62);
        for (const x of [526, 556]) k.line(x, 192, x, 180, 1.4, 0.5);
        // One World Trade Center: square base, rotated square top, eight triangles
        {
          const cx = 470;
          const pod = 336;
          const top = 118;
          const wb = 24;
          const wt = 16;
          k.rect(cx - wb, pod, wb * 2, shore - pod, 0.4);
          k.poly([[cx - wb, pod], [cx - wt, top], [cx, top]], 0.74);
          k.poly([[cx + wb, pod], [cx + wt, top], [cx, top]], 0.3);
          k.poly([[cx - wb, pod], [cx + wb, pod], [cx, top]], 0.54);
          k.glassPoly([[cx - wb + 5, pod - 4], [cx + wb - 5, pod - 4], [cx, top + 14]], 0.45);
          k.rect(cx - wt, top - 5, wt * 2, 5, 0.5);
          k.rect(cx - 5, top - 10, 10, 5, 0.56);
          k.line(cx, top - 10, cx, top - 84, 2, 0.62);
          k.light(cx, top - 86);
        }

        // Brooklyn Bridge in the foreground: granite tower, gothic arches, cable web
        {
          const cx = 150;
          const deck = 328;
          const top = 154;
          const hw = 46;
          const anchor = 420;
          const A = [cx - 34, top + 8];
          const B = [cx + 34, top + 8];
          const L = [-60, deck - 36];
          const R = [anchor, deck - 18];
          const CL = [(A[0] + L[0]) / 2, 300];
          const CR = [(B[0] + R[0]) / 2, deck + 6];
          // web: suspenders and diagonal stays
          for (const [a, c, b] of [[L, CL, A], [B, CR, R]]) {
            for (let x = Math.min(a[0], b[0]) + 7; x < Math.max(a[0], b[0]) - 4; x += 8) {
              k.line(x, onCurve(a, c, b, x), x, deck, 0.9, 0.42);
            }
          }
          for (let i = 1; i <= 7; i++) {
            k.line(cx + hw - 4, top + 14, cx + hw + i * 30, deck, 0.9, 0.5);
            k.line(cx - hw + 4, top + 14, cx - hw - i * 30, deck, 0.9, 0.5);
          }
          k.rect(-60, deck, anchor + 80, 8, 0.56); // roadway
          k.rect(anchor - 10, deck - 22, 46, shore - deck + 22, 0.42); // Manhattan anchorage
          // tower
          k.rect(cx - hw, top + 26, hw * 2, 398 - top - 26, 0.5);
          for (const px of [-hw, -7, hw - 12]) k.rect(cx + px, top + 26, px === -7 ? 14 : 12, 398 - top - 26, 0.6);
          k.rect(cx - hw - 4, top + 18, hw * 2 + 8, 9, 0.66);
          k.rect(cx - hw + 2, top, hw * 2 - 4, 18, 0.56);
          for (const ax of [cx - 24, cx + 24]) {
            k.rect(ax - 12, 224, 24, deck - 224, 0);
            k.gothic(ax, 225, 12, 32, 0);
          }
          k.rect(cx - hw, deck, hw * 2, 8, 0.62);
          k.curve(L, CL, A, 2.6, 0.72);
          k.curve(B, CR, R, 2.6, 0.72);
        }
      },
    },

    {
      slug: 'atl',
      name: 'Atlanta, GA',
      vantage: 'from Piedmont Park',
      tz: 'America/New_York',
      water: 410,
      stars: 0.003,
      fireflies: true,
      draw(k) {
        const r = k.rand;
        const ground = 400;
        const gold = (v) => k.tint('gold', v);

        k.moon(860, k.top + 70, 21);

        // Downtown and Midtown filler
        for (let x = -40; x < 1050;) {
          const w = 12 + r() * 20;
          const h = 60 + r() * 90;
          k.block(x, ground - h, w, ground, 0.17 + r() * 0.08, { lit: 0.3 });
          x += w + r() * 4;
        }
        // Westin Peachtree Plaza: glass cylinder with a ring on top
        k.cylinder(150, 206, 34, ground, 0.5);
        k.cylinder(147, 194, 40, 207, 0.62);
        k.rect(160, 186, 14, 8, 0.5);
        // Truist Plaza: tiered, arched crown
        {
          const cx = 238;
          k.block(cx - 18, 178, 36, ground, 0.36);
          k.block(cx - 14, 162, 28, 178, 0.42, { glass: false });
          k.dome(cx, 163, 14, 7, 0.48);
          k.block(cx - 9, 148, 18, 160, 0.5, { glass: false });
          k.dome(cx, 149, 9, 6, 0.56);
          k.line(cx, 143, cx, 128, 1.2, 0.5);
        }
        // 191 Peachtree: twin temple crowns
        {
          const cx = 336;
          k.block(cx - 25, 226, 50, ground, 0.4);
          for (const tx of [cx - 19, cx + 19]) {
            k.rect(tx - 6, 206, 12, 20, 0.5);
            k.poly([[tx - 7, 206], [tx + 7, 206], [tx, 196]], 0.56);
          }
        }
        // Promenade II: ziggurat top and needle
        {
          const cx = 612;
          k.block(cx - 20, 212, 40, ground, 0.38);
          [[16, 200], [12, 189], [8, 178], [4, 168]].forEach(([hw, y], i) =>
            k.rect(cx - hw, y, hw * 2, 12, 0.46 + i * 0.05));
          k.line(cx, 168, cx, 132, 1.2, 0.5);
        }
        // Bank of America Plaza: the tallest, with its gold lattice pyramid and spire
        {
          const cx = 470;
          const top = 128;
          k.block(cx - 25, top, 50, ground, 0.46, { lit: 0.5 });
          k.rect(cx - 25, top, 5, ground - top, 0.3);
          k.rect(cx + 20, top, 5, ground - top, 0.24);
          const apex = 70;
          k.poly([[cx - 25, top], [cx + 25, top], [cx, apex]], gold(0.36));
          for (let y = top - 9; y > apex + 4; y -= 9) {
            const hw = (25 * (y - apex)) / (top - apex);
            k.line(cx - hw, y, cx + hw, y, 1.1, gold(0.9));
          }
          k.line(cx - 25, top, cx, apex, 1.6, gold(0.95));
          k.line(cx + 25, top, cx, apex, 1.6, gold(0.95));
          k.line(cx, top, cx, apex, 1.1, gold(0.8));
          k.poly([[cx - 2.6, apex], [cx + 2.6, apex], [cx, 22]], gold(1));
        }
        // One Atlantic Center: copper gothic roof with pinnacles
        {
          const cx = 712;
          const top = 170;
          k.block(cx - 22, top, 44, ground, 0.42, { lit: 0.45 });
          k.poly([[cx - 22, top], [cx + 22, top], [cx, 118]], 0.6);
          for (const px of [-22, -11, 11, 22]) k.poly([[cx + px - 2.5, top], [cx + px + 2.5, top], [cx + px, top - 22]], 0.66);
          k.line(cx, 120, cx, 100, 1.2, 0.6);
          k.light(cx, 98);
        }
        // 1180 Peachtree: glass sail fin
        k.block(800, 212, 34, ground, 0.4, { lit: 0.6 });
        k.poly([[800, 212], [834, 212], [834, 158], [812, 192]], 0.52);
        // 1100 Peachtree and Four Seasons
        k.block(872, 236, 30, ground, 0.34);
        k.block(540, 250, 28, ground, 0.34);
        k.dome(554, 251, 14, 9, 0.4);

        // Piedmont Park canopy
        // Trees are dark against the lit towers, with moonlight catching their crowns
        const crowns = [];
        for (let x = -60; x < 1070; x += 12 + r() * 9) {
          crowns.push([x, 362 + 10 * Math.sin(x * 0.012) + 7 * Math.sin(x * 0.043 + 1) + r() * 6, 12 + r() * 9]);
        }
        for (const [tx, th, tr] of [[20, 314, 50], [100, 338, 30], [940, 324, 44], [1000, 300, 46]]) {
          for (let i = 0; i < 9; i++) {
            const a = r() * Math.PI * 2;
            const d = r() * tr * 0.7;
            crowns.push([tx + Math.cos(a) * d, th + Math.sin(a) * d * 0.7, 12 + r() * 10]);
          }
        }
        for (const [x, y, rad] of crowns) k.circle(x - rad * 0.18, y - rad * 0.3, rad * 0.9, 0.3);
        for (const [x, y, rad] of crowns) k.circle(x, y, rad, 0.035);
        k.rect(-60, 374, 1130, 40, 0.035);
        for (let i = 0; i < 9; i++) {
          const x = 60 + i * 110 + r() * 40;
          k.light(x, 384 + r() * 10, 'firefly', true); // park lamps
        }
      },
    },
  ];

  /* ───────────────────────── renderer ───────────────────────── */

  const SX = 4; // subpixels per cell, across
  const SY = 8; // and down: cells are twice as tall as wide

  function createSkyline(frame, pre, { onChange } = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const maskCanvas = document.createElement('canvas');
    const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');

    let index = 0;
    let L = null; // layout
    let base = null; // per-cell static render of the current city
    let glyph = [];
    let color = [];
    let prev = null; // last frame of the previous city, for the wipe
    let wipeStart = 0;
    let visible = true;
    let raf = 0;
    let lastPaint = 0;
    let scale = 1;
    const t0 = performance.now();

    function layout() {
      const fw = frame.clientWidth;
      const fh = frame.clientHeight;
      if (!fw || !fh) return null;
      const cellPx = fw < 640 ? 2.4 : 2.75;
      const cols = Math.round(clamp(fw / cellPx, 110, 300));
      const cellW = fw / cols;
      const cellH = cellW * 2;
      const rows = Math.max(8, Math.floor(fh / cellH));
      const gridH = rows * cellH;
      const s = Math.min(fw / W, gridH / BASE); // px per scene unit
      const offX = (fw - W * s) / 2;
      return { fw, fh, cols, rows, cellW, cellH, gridH, s, offX, top: BASE - gridH / s };
    }

    const sceneY = (r) => BASE - (L.gridH - (r + 0.5) * L.cellH) / L.s;
    const sceneX = (c) => ((c + 0.5) * L.cellW - L.offX) / L.s;
    const cellOf = (x, y) => {
      const c = Math.floor((L.offX + x * L.s) / L.cellW);
      const r = Math.floor((L.gridH - (BASE - y) * L.s) / L.cellH);
      return c >= 0 && c < L.cols && r >= 0 && r < L.rows ? r * L.cols + c : -1;
    };

    function build(scene) {
      const { cols, rows, cellW, s, offX, gridH } = L;
      const cw = cols * SX;
      const ch = rows * SY;
      canvas.width = maskCanvas.width = cw;
      canvas.height = maskCanvas.height = ch;
      for (const c of [ctx, mctx]) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#000';
        c.fillRect(0, 0, cw, ch);
        const k = (s * SX) / cellW;
        c.setTransform(k, 0, 0, k, (offX * SX) / cellW, ((gridH - BASE * s) * SX) / cellW);
      }
      const kit = makeKit(ctx, mctx, L.top, 1 + index * 7919);
      scene.draw(kit);

      const px = ctx.getImageData(0, 0, cw, ch).data;
      const mk = maskCanvas.width ? mctx.getImageData(0, 0, cw, ch).data : null;
      const n = cols * rows;
      const v = new Float32Array(n);
      const hue = new Int8Array(n).fill(-1);
      const line = new Array(n).fill('');
      const glass = new Float32Array(n).fill(-1);
      const sub = new Float32Array(SX * SY);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let peak = 0;
          let gl = 0;
          let gm = 0;
          for (let j = 0; j < SY; j++) {
            for (let i = 0; i < SX; i++) {
              const p = ((r * SY + j) * cw + c * SX + i) * 4;
              const R = px[p];
              const G = px[p + 1];
              const B = px[p + 2];
              const m = Math.max(R, G, B) / 255;
              sub[j * SX + i] = m;
              sum += m;
              sr += R;
              sg += G;
              sb += B;
              if (m > peak) peak = m;
              if (mk[p] > 0) {
                gl += 1;
                gm += mk[p] / 255;
              }
            }
          }
          const idx = r * cols + c;
          const mean = sum / (SX * SY);
          v[idx] = mean;

          // A saturated cell takes the nearest palette colour
          const mx = Math.max(sr, sg, sb);
          if (mx > 0 && (mx - Math.min(sr, sg, sb)) / mx > 0.3 && mean > 0.04) {
            const len = Math.hypot(sr, sg, sb);
            let best = -1;
            let bestDot = 0.9;
            PALETTE_UNIT.forEach(([ur, ug, ub], pi) => {
              const d = (sr * ur + sg * ug + sb * ub) / len;
              if (d > bestDot) {
                bestDot = d;
                best = pi;
              }
            });
            hue[idx] = best;
          }

          if (gl / (SX * SY) > 0.8) {
            glass[idx] = gm / gl;
            continue;
          }

          // Thin, elongated structure inside the cell: pick a line glyph by its direction
          if (peak > 0.2 && mean < peak * 0.55) {
            let wsum = 0;
            let mxp = 0;
            let myp = 0;
            for (let j = 0; j < SY; j++) {
              for (let i = 0; i < SX; i++) {
                const w = sub[j * SX + i];
                wsum += w;
                mxp += w * (i + 0.5);
                myp += w * (j + 0.5);
              }
            }
            mxp /= wsum;
            myp /= wsum;
            let xx = 0;
            let yy = 0;
            let xy = 0;
            for (let j = 0; j < SY; j++) {
              for (let i = 0; i < SX; i++) {
                const w = sub[j * SX + i];
                const dx = i + 0.5 - mxp;
                const dy = j + 0.5 - myp;
                xx += w * dx * dx;
                yy += w * dy * dy;
                xy += w * dx * dy;
              }
            }
            const tr = xx + yy;
            const det = xx * yy - xy * xy;
            const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
            const l1 = tr / 2 + disc;
            const l2 = tr / 2 - disc;
            if (l1 > 0 && l2 / l1 < 0.2) {
              const ang = (Math.atan2(2 * xy, xx - yy) / 2) * (180 / Math.PI); // 0 = horizontal, y down
              const a = Math.abs(ang);
              line[idx] = a < 24 ? (myp > SY * 0.72 ? '_' : '-') : a > 66 ? '|' : ang > 0 ? '\\' : '/';
            }
          }
        }
      }

      // Crescent moon with a faint halo, sampled 4 × 8 per cell
      for (const [mx0, my0, mr] of kit.moons) {
        const uw = L.cellW / L.s;
        const uh = L.cellH / L.s;
        for (let r = 0; r < rows; r++) {
          const cy = sceneY(r);
          if (Math.abs(cy - my0) > mr * 2.2) continue;
          for (let c = 0; c < cols; c++) {
            const cx = sceneX(c);
            const d = Math.hypot(cx - mx0, cy - my0);
            if (d > mr * 2.2) continue;
            let inside = 0;
            for (let j = 0; j < 8; j++) {
              for (let i = 0; i < 4; i++) {
                const x = cx + ((i + 0.5) / 4 - 0.5) * uw;
                const y = cy + ((j + 0.5) / 8 - 0.5) * uh;
                const lit = Math.hypot(x - mx0, y - my0) < mr;
                const shadow = Math.hypot(x - mx0 - mr * 0.5, y - my0 + mr * 0.22) < mr * 0.88;
                if (lit && !shadow) inside++;
              }
            }
            const idx = r * cols + c;
            const halo = d > mr ? 0.08 * (1 - (d - mr) / (mr * 0.7)) : 0;
            v[idx] = Math.max(v[idx], (inside / 32) * 0.95, halo);
            line[idx] = '';
          }
        }
      }

      const waterRow = scene.water == null
        ? rows
        : clamp(Math.floor((gridH - (BASE - scene.water) * s) / L.cellH), 0, rows);

      const lights = kit.lights
        .map(([x, y, name, steady], i) => ({ i: cellOf(x, y), phase: hash(i, 3, 9) * 1.6, hue: PALETTE_NAMES.indexOf(name), steady }))
        .filter((l) => l.i >= 0);

      const flies = [];
      if (scene.fireflies) {
        for (let i = 0; i < 26; i++) {
          flies.push({
            x: hash(i, 1, 4) * W,
            y: 332 + hash(i, 2, 4) * 70,
            p: [hash(i, 3, 4), hash(i, 4, 4), hash(i, 5, 4), hash(i, 6, 4)].map((h) => h * Math.PI * 2),
            speed: 0.55 + hash(i, 7, 4) * 0.7,
          });
        }
      }

      return { scene, v, hue, line, glass, waterRow, lights, flies };
    }

    function compose(t) {
      const { cols, rows } = L;
      const { scene, v, hue, line, glass, waterRow, lights, flies } = base;
      const n = cols * rows;
      if (glyph.length !== n) {
        glyph = new Array(n);
        color = new Int8Array(n);
      }
      const fogRows = scene.fog ? new Float32Array(rows) : null;
      if (fogRows) for (let r = 0; r < rows; r++) {
        const y = sceneY(r);
        fogRows[r] = smooth(210, 300, y) * (1 - smooth(400, 430, y)) * (0.6 + 0.4 * smooth(300, 370, y));
      }

      for (let r = 0; r < rows; r++) {
        const below = r >= waterRow;
        const depth = below ? (r - waterRow + 1) / Math.max(1, rows - waterRow) : 0;
        const rm = 2 * waterRow - 1 - r;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let val;
          let ch = '';
          let col = -1;

          if (!below) {
            val = v[i];
            col = hue[i];
            const g = glass[i];
            if (g >= 0) {
              if ((r & 1) === 0) {
                const h = hash(c, r, 11);
                let lit = h < g;
                if (hash(c, r, 13) < 0.05) lit = Math.sin(t * (0.2 + hash(c, r, 5) * 0.5) + h * 40) > 0.2;
                val = lit ? 0.74 + 0.26 * hash(c, r, 17) : val * 0.38;
              }
            } else if (line[i]) {
              ch = line[i];
            }
            if (val < 0.012 && scene.stars) {
              const h = hash(c, r, 21);
              if (h < scene.stars) {
                const tw = 0.5 + 0.5 * Math.sin(t * (0.6 + hash(c, r, 22) * 1.8) + hash(c, r, 23) * 6.3);
                const b = tw * (0.35 + (h / scene.stars) * 0.65);
                ch = b > 0.72 ? '*' : b > 0.42 ? '+' : b > 0.12 ? '.' : ' ';
              }
            }
          } else if (rm >= 0) {
            const wob = Math.sin(r * 1.9 + t * 1.3) * (0.5 + depth * 2) + Math.sin(c * 0.09 - t * 0.7 + r * 0.8) * 0.9;
            const cs = clamp(Math.round(c + wob), 0, cols - 1);
            const j = rm * cols + cs;
            const g = glass[j];
            val = (g >= 0 && (rm & 1) === 0 && hash(cs, rm, 11) < g ? 0.8 : v[j]) * (0.52 - depth * 0.3);
            const ripple = Math.sin(c * 0.23 + r * 2.3 - t * 1.6) + Math.sin(c * 0.051 - r * 1.1 + t * 0.8);
            if (ripple > 1.05 - depth * 0.9) val *= 0.3;
            if (val < 0.04 && hash(c, r, Math.floor(t * 2.5)) < 0.006) val = 0.22;
            col = hue[j];
            ch = WATER[Math.round(clamp(val * 1.15) * (WATER.length - 1))];
          } else {
            val = 0;
          }

          if (fogRows && fogRows[r] > 0) {
            const x = sceneX(c);
            const y = sceneY(r);
            const f = clamp((fbm(x / 170 - t * 0.05, y / 30 + t * 0.012) - 0.47) * 2.6) * fogRows[r];
            if (f > 0.02) {
              val = val * (1 - 0.5 * f) + 0.34 * f;
              if (f > 0.3) {
                ch = '';
                if (col >= 0 && f > 0.5) col = -1;
              }
            }
          }

          if (!ch) {
            const grain = val > 0.012 ? 0.9 + 0.2 * hash(c, r, 3) : 1;
            ch = RAMP[Math.round(Math.pow(clamp(val * grain), 0.9) * (RAMP.length - 1))];
          }
          glyph[i] = ch;
          color[i] = ch === ' ' ? -1 : col;
        }
      }

      for (const l of lights) {
        if (l.steady) {
          glyph[l.i] = '*';
          color[l.i] = l.hue;
        } else if ((t * 0.75 + l.phase) % 1.6 < 0.75) {
          glyph[l.i] = '@';
          color[l.i] = l.hue < 0 ? RED : l.hue;
        }
      }

      for (const f of flies) {
        const b = Math.pow(Math.max(0, Math.sin(t * f.speed + f.p[3])), 6);
        if (b < 0.12) continue;
        const x = f.x + 22 * Math.sin(t * 0.11 + f.p[0]) + 9 * Math.sin(t * 0.29 + f.p[1]);
        const y = f.y + 7 * Math.sin(t * 0.19 + f.p[2]);
        const i = cellOf(x, y);
        if (i < 0) continue;
        glyph[i] = b > 0.7 ? '*' : b > 0.35 ? '+' : '.';
        color[i] = FIREFLY;
      }
    }

    function paint(now) {
      const t = (now - t0) / 1000;
      compose(t);
      const { cols, rows } = L;
      let g = glyph;
      let col = color;
      if (prev) {
        const p = (now - wipeStart) / 700;
        if (p >= 1.15 || prev.g.length !== glyph.length) {
          prev = null;
        } else {
          g = new Array(glyph.length);
          col = new Int8Array(glyph.length);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const i = r * cols + c;
              const th = 0.75 * (c / cols) + 0.25 * hash(c, r, 31);
              if (p >= th + 0.12) {
                g[i] = glyph[i];
                col[i] = color[i];
              } else if (p >= th) {
                g[i] = glyph[i] === ' ' && prev.g[i] === ' ' ? ' ' : SCRAMBLE[(hash(c, r, Math.floor(now / 50)) * SCRAMBLE.length) | 0];
                col[i] = -1;
              } else {
                g[i] = prev.g[i];
                col[i] = prev.c[i];
              }
            }
          }
        }
      }

      let html = '';
      for (let r = 0; r < rows; r++) {
        let run = -1;
        let s = '';
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const k = col[i];
          if (k !== run) {
            if (run >= 0) s += '</span>';
            if (k >= 0) s += `<span style="color:${PALETTE_CSS[k]}">`;
            run = k;
          }
          s += g[i];
        }
        if (run >= 0) s += '</span>';
        html += r ? '\n' + s : s;
      }
      // Only glyphs from our own ramps and our own spans ever reach the page
      pre.innerHTML = html;
      lastPaint = now;
    }

    function fit() {
      pre.style.transform = '';
      const w = pre.scrollWidth;
      scale = w ? L.fw / w : 1;
      pre.style.transform = `translate(0px, ${(L.fh - L.gridH).toFixed(2)}px) scale(${scale})`;
    }

    function refresh(keepPrev = false) {
      const next = layout();
      if (!next) return;
      const resized = !L || next.cols !== L.cols || next.rows !== L.rows || next.fw !== L.fw || next.fh !== L.fh;
      L = next;
      if (!keepPrev && resized) prev = null;
      base = build(SCENES[index]);
      paint(performance.now());
      fit();
    }

    function loop(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      if (reduced.matches && !prev) return;
      if (now - lastPaint > 1000 / 14) paint(now);
      raf = requestAnimationFrame(loop);
    }

    function kick() {
      if (!raf) raf = requestAnimationFrame(loop);
    }

    function go(next, { animate = true } = {}) {
      next = ((next % SCENES.length) + SCENES.length) % SCENES.length;
      if (next === index && base) return;
      if (animate && base && !reduced.matches) {
        prev = { g: glyph.slice(), c: color.slice() };
        wipeStart = performance.now();
      }
      index = next;
      refresh(true);
      onChange?.(SCENES[index], index);
      kick();
    }

    new ResizeObserver(() => {
      const before = L && `${L.fw}x${L.fh}`;
      const next = layout();
      if (!next || before === `${next.fw}x${next.fh}`) return;
      refresh();
    }).observe(frame);

    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) kick();
    }).observe(frame);

    document.addEventListener('visibilitychange', kick);
    reduced.addEventListener?.('change', () => {
      if (base) paint(performance.now());
      kick();
    });

    return {
      scenes: SCENES,
      get index() {
        return index;
      },
      get scene() {
        return SCENES[index];
      },
      start(i) {
        index = ((i % SCENES.length) + SCENES.length) % SCENES.length;
        refresh();
        onChange?.(SCENES[index], index);
        kick();
      },
      go,
      step(d) {
        go(index + d);
      },
      bySlug(slug) {
        return SCENES.findIndex((s) => s.slug === slug);
      },
    };
  }

  window.Skylines = { SCENES, createSkyline };
})();
