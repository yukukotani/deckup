#!/usr/bin/env python3
"""Create a Deckup theme package skeleton."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PACKAGE_NAME_PATTERN = re.compile(
    r"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$"
)

SINGLE_SLOT_LAYOUT = '''---
import "./styles.css";
---

<slot />
'''

TWO_COLUMN_LAYOUT = '''---
import "./styles.css";
---

<slot />
<section class="{namespace}-column {namespace}-column--left">
  <slot name="left" />
</section>
<section class="{namespace}-column {namespace}-column--right">
  <slot name="right" />
</section>
'''

STYLES = '''/* Replace these starter values with the theme's intentional visual system. */
:root {{
  color-scheme: light;
  --deckup-bg: #f8fafc;
  --deckup-text: #475569;
  --deckup-text-strong: #0f172a;
  --deckup-border: #cbd5e1;
  --deckup-code-bg: #e2e8f0;
  --deckup-accent: #2563eb;
  --deckup-shadow: 0 12px 30px rgb(15 23 42 / 0.12);
  --deckup-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --deckup-mono: "SFMono-Regular", Consolas, monospace;
}}

body {{
  color: var(--deckup-text);
  font-family: var(--deckup-sans);
}}

.deckup-shell {{
  background: var(--deckup-bg);
}}

.deckup-slide {{
  --theme-cqw: 1cqw;
  display: grid;
  align-content: center;
  gap: clamp(0.75rem, calc(2.2 * var(--theme-cqw)), 2rem);
  padding: clamp(2.5rem, calc(7 * var(--theme-cqw)), 7rem);
  color: var(--deckup-text);
  background: var(--deckup-bg);
  font-family: var(--deckup-sans);
}}

.deckup-slide > * {{
  max-width: 100%;
  margin: 0;
}}

.deckup-slide :is(h1, h2, h3) {{
  color: var(--deckup-text-strong);
  line-height: 1.1;
}}

.deckup-slide h1 {{
  font-size: clamp(2.25rem, calc(5 * var(--theme-cqw)), 5rem);
}}

.deckup-slide :is(p, li) {{
  font-size: clamp(1rem, calc(2 * var(--theme-cqw)), 1.5rem);
  line-height: 1.55;
}}

.deckup-slide pre {{
  max-width: 100%;
  overflow: auto;
  padding: clamp(0.75rem, calc(1.5 * var(--theme-cqw)), 1.5rem);
  background: var(--deckup-code-bg);
}}

[data-deckup-layout="cover"],
[data-deckup-layout="section"],
[data-deckup-layout="statement"],
[data-deckup-layout="number"],
[data-deckup-layout="quote"] {{
  justify-items: center;
  text-align: center;
}}

[data-deckup-layout="page"],
[data-deckup-layout="two-column"] {{
  align-content: start;
}}

[data-deckup-layout="two-column"] {{
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: clamp(1.5rem, calc(4 * var(--theme-cqw)), 4rem);
}}

[data-deckup-layout="two-column"] > :not(.{namespace}-column) {{
  grid-column: 1 / -1;
}}

.{namespace}-column {{
  min-width: 0;
  max-width: 100%;
}}

.{namespace}-column--left {{
  grid-column: 1;
}}

.{namespace}-column--right {{
  grid-column: 2;
}}
'''


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a new Deckup theme package."
    )
    parser.add_argument("destination", type=Path, help="New theme package directory")
    parser.add_argument(
        "--package-name",
        required=True,
        help="npm package name, for example @acme/deckup-theme",
    )
    return parser.parse_args()


def class_namespace(package_name: str) -> str:
    stem = package_name.rsplit("/", 1)[-1]
    for prefix in ("deckup-theme-", "theme-"):
        if stem.startswith(prefix):
            stem = stem[len(prefix) :]
            break
    namespace = re.sub(r"[^a-z0-9-]+", "-", stem).strip("-")
    return f"deckup-{namespace or 'theme'}"


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    print(f"created {path}")


def main() -> None:
    args = parse_args()
    package_name = args.package_name.strip()
    if not PACKAGE_NAME_PATTERN.fullmatch(package_name):
        raise SystemExit(
            "package name must be a lowercase npm name such as deckup-theme or "
            "@acme/deckup-theme"
        )

    destination = args.destination.resolve()
    if destination.exists():
        raise SystemExit(f"destination already exists: {destination}")

    layouts_dir = destination / "layouts"
    layouts_dir.mkdir(parents=True)

    package_json = {
        "name": package_name,
        "version": "0.1.0",
        "type": "module",
        "files": ["layouts"],
        "exports": {
            "./layouts/*.astro": "./layouts/*.astro",
            "./package.json": "./package.json",
        },
    }
    write_text(
        destination / "package.json",
        json.dumps(package_json, indent=2, ensure_ascii=False) + "\n",
    )

    for layout_id in (
        "cover",
        "default",
        "number",
        "page",
        "quote",
        "section",
        "statement",
    ):
        write_text(layouts_dir / f"{layout_id}.astro", SINGLE_SLOT_LAYOUT)

    namespace = class_namespace(package_name)
    write_text(
        layouts_dir / "two-column.astro",
        TWO_COLUMN_LAYOUT.format(namespace=namespace),
    )
    write_text(layouts_dir / "styles.css", STYLES.format(namespace=namespace))

    print(f"\nDeckup theme scaffolded at {destination}")
    print("Next: replace starter styling, install it in a deck, and render every layout.")


if __name__ == "__main__":
    main()
