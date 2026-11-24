# jburrell999.github.io

Personal site for James Burrell. It's plain HTML, CSS and JavaScript with no build step and no dependencies.

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The page: bio, social links, contributions, projects |
| `assets/style.css` | All styles (Quicksand, dark, single accent per city) |
| `assets/skylines.js` | ASCII skyline renderer and the three city scenes |
| `assets/main.js` | Contributions grid, city switching, local time per city |
| `assets/contributions.js` | Snapshot of the GitHub contributions calendar (generated) |
| `scripts/fetch_contributions.py` | Regenerates the snapshot from the GitHub profile's contributions calendar |
| `.github/workflows/deploy.yml` | Deploys to GitHub Pages on push, and every 6 hours to refresh contributions |
| `404.html` | Not-found page |

## The skylines

Each city (San Francisco, New York, Atlanta) is drawn with canvas shapes into a small offscreen buffer, averaged into
character cells, and printed into a `<pre>` about 14 times a second. Thin structures such as cables, spires and
suspenders are detected per cell and drawn with `/ \ | -`. Water reflections, Golden Gate fog, twinkling windows,
aircraft lights and Piedmont Park fireflies are animated in cell space. The animation pauses off-screen and respects
`prefers-reduced-motion`.

- Click the art, use the arrows, press <kbd>←</kbd> <kbd>→</kbd>, or click a city name in the bio to switch cities.
- `?city=sf`, `?city=nyc` or `?city=atl` opens a specific city.
- To change a scene, edit its `draw(k)` function in `assets/skylines.js`. Coordinates are 1000 units wide and the
  ground sits near y = 400.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Edit content

- **Bio, links, projects:** edit `index.html` directly. Each project is one `<li>` in `.project-list`.
- **Contributions:** `python3 scripts/fetch_contributions.py` (no token needed)

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which refreshes the contributions snapshot and publishes the site
with GitHub Pages. In the repo settings, set **Pages → Source** to **GitHub Actions**. The workflow also runs every 6
hours so the contributions graph stays current.

Contributions are read from the same public calendar the GitHub profile shows, so private contributions are included
as counts, exactly as on the profile. The GraphQL API is only a fallback; it sees public contributions only.
