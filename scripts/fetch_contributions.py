#!/usr/bin/env python3
"""Fetch the last year of GitHub contributions and write assets/contributions.js.

The numbers come from the public contributions calendar that the GitHub
profile page shows (github.com/users/<login>/contributions). That calendar
includes private contributions as plain counts, which the GraphQL API leaves
out for tokens that can't see those repos, so it matches the profile exactly
and needs no token. If it can't be read, the GraphQL API is used instead
(public contributions only, needs GITHUB_TOKEN or GH_TOKEN).

    python3 scripts/fetch_contributions.py

If both fail, the existing file is left untouched so the site still builds
with the last good snapshot.
"""

import html
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

LOGIN = os.environ.get("GH_LOGIN", "JBurrell999")
OUT = Path(__file__).resolve().parent.parent / "assets" / "contributions.js"
UA = {"User-Agent": "Mozilla/5.0 (personal-site contributions refresh)"}


def get(url: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def from_profile() -> tuple[dict[str, tuple[int, int]], int | None]:
    """Day -> (count, level) from the profile calendar, plus the headline total."""
    page = get(f"https://github.com/users/{LOGIN}/contributions").decode("utf-8", "replace")

    cells = {}  # element id -> (date, level)
    for tag in re.findall(r"<td\b[^>]*\bContributionCalendar-day\b[^>]*>", page):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', tag))
        if "data-date" in attrs and "id" in attrs:
            cells[attrs["id"]] = (attrs["data-date"], int(attrs.get("data-level", 0)))

    days = {}
    for target, text in re.findall(r'<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)</tool-tip>', page):
        if target not in cells:
            continue
        day, level = cells[target]
        m = re.match(r"\s*([\d,]+)\s+contribution", html.unescape(text))
        days[day] = (int(m.group(1).replace(",", "")) if m else 0, level)

    # Cells whose tooltip is missing still count, as zero-or-level only
    for day, level in cells.values():
        days.setdefault(day, (0, level))

    flat = re.sub(r"\s+", " ", page)
    m = re.search(r"([\d,]+) contributions? in the last year", flat)
    total = int(m.group(1).replace(",", "")) if m else None
    return days, total


LEVELS = {"NONE": 0, "FIRST_QUARTILE": 1, "SECOND_QUARTILE": 2, "THIRD_QUARTILE": 3, "FOURTH_QUARTILE": 4}
QUERY = """
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}
"""


def from_api() -> tuple[dict[str, tuple[int, int]], int | None]:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        raise RuntimeError("no GITHUB_TOKEN/GH_TOKEN set")
    body = json.dumps({"query": QUERY, "variables": {"login": LOGIN}}).encode()
    payload = json.loads(get(
        "https://api.github.com/graphql",
        data=body,
        headers={"Authorization": f"bearer {token}", "Content-Type": "application/json"},
    ))
    cal = payload["data"]["user"]["contributionsCollection"]["contributionCalendar"]
    days = {
        d["date"]: (d["contributionCount"], LEVELS.get(d["contributionLevel"], 0))
        for w in cal["weeks"] for d in w["contributionDays"]
    }
    return days, cal["totalContributions"]


def to_weeks(days: dict[str, tuple[int, int]]) -> list[list[list]]:
    """Group days into Sunday-first weeks, the way GitHub draws its calendar."""
    weeks: list[list[list]] = []
    current_start = None
    for day in sorted(days):
        d = date.fromisoformat(day)
        start = d - timedelta(days=(d.weekday() + 1) % 7)
        if start != current_start:
            weeks.append([])
            current_start = start
        count, level = days[day]
        weeks[-1].append([day, count, level])
    return weeks


def main() -> int:
    source = None
    for name, fetch in (("profile calendar", from_profile), ("GraphQL API", from_api)):
        try:
            days, total = fetch()
        except Exception as exc:  # network, markup, auth, or schema problems
            print(f"{name}: could not read ({exc})")
            continue
        if len(days) >= 300:
            source = name
            break
        print(f"{name}: only {len(days)} days found, trying the next source")
    if not source:
        print("Keeping existing snapshot.")
        return 0

    summed = sum(c for c, _ in days.values())
    if total is None:
        total = summed
    data = {
        "login": LOGIN,
        "total": total,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "weeks": to_weeks(days),
    }
    OUT.write_text(
        "// Generated by scripts/fetch_contributions.py, do not edit by hand.\n"
        f"window.CONTRIBUTIONS = {json.dumps(data, separators=(',', ':'))};\n"
    )
    print(f"From the {source}: {total} contributions ({summed} summed over {len(days)} days, "
          f"{len(data['weeks'])} weeks) -> {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
