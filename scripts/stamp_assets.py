#!/usr/bin/env python3
"""Add a content hash to local asset links in the built HTML (e.g. main.js?v=1a2b3c4d).

GitHub Pages serves everything with a 10-minute cache, and a normal refresh
reuses cached scripts and styles. Stamping each link with a hash of the
file means a deploy that changes a file also changes its URL, so a plain
refresh picks it up.

    python3 scripts/stamp_assets.py _site
"""

import hashlib
import re
import sys
from pathlib import Path


def main() -> int:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    pattern = re.compile(r'(\b(?:src|href)=")(/?)((?:assets/)?[\w./-]+\.(?:js|css|svg|png))(")')

    for page in site.glob("*.html"):
        text = page.read_text()
        stamped = 0

        def stamp(m: re.Match) -> str:
            nonlocal stamped
            target = site / m.group(3)
            if not target.is_file():
                return m.group(0)
            stamped += 1
            digest = hashlib.sha256(target.read_bytes()).hexdigest()[:10]
            return f"{m.group(1)}{m.group(2)}{m.group(3)}?v={digest}{m.group(4)}"

        page.write_text(pattern.sub(stamp, text))
        print(f"{page.name}: stamped {stamped} links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
