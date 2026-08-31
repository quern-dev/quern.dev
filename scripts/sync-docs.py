#!/usr/bin/env python3
"""Sync the Starlight docs in this site from the guides in the quern repo.

The pages under ``src/content/docs/`` are derived copies of ``docs/guides/*.md``
in the quern repo. They were kept in sync by hand, which meant they weren't:
by the v0.14.1 beta the site was still telling readers that app-state
checkpoints could not capture the keychain, months after that stopped being
true.

The transform is mechanical:

* the repo guide supplies the body,
* the site page keeps its own Starlight frontmatter (title/description drive
  the sidebar and meta tags, and differ from the repo's H1), and
* relative ``foo.md`` links become absolute Starlight routes ``/section/foo/``.

Usage::

    scripts/sync-docs.py --check    # report drift, exit 1 if any (for CI)
    scripts/sync-docs.py            # rewrite the site pages in place

``--repo`` points at the quern checkout; it defaults to a sibling directory.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SITE_DOCS = Path(__file__).resolve().parent.parent / "src" / "content" / "docs"
DEFAULT_REPO = Path(__file__).resolve().parent.parent.parent / "quern"

# site path (relative to src/content/docs) -> guide filename in docs/guides/
MAPPING = {
    "getting-started/installation-and-setup.md": "getting-started.md",
    "getting-started/device-pool.md": "device-pool.md",
    "getting-started/build-and-install.md": "build-and-install.md",
    "getting-started/app-knowledge.md": "app-knowledge.md",
    "ios/app-state.md": "app-state.md",
    "ios/ios-logging.md": "ios-logging.md",
    "ios/ios-preview.md": "ios-preview.md",
    "ios/ios-proxy-simulators.md": "ios-proxy-simulators.md",
    "ios/ios-proxy-physical-devices.md": "ios-proxy-physical-devices.md",
    "ios/ios-wda.md": "ios-wda.md",
    "android/android-getting-started.md": "android-getting-started.md",
    "android/android-proxy.md": "android-proxy.md",
    "android/android-logging.md": "android-logging.md",
    "react-native/react-native-logging.md": "react-native-logging.md",
    "cross-platform/network-debugging.md": "network-debugging.md",
    "workflows/workflow-api-testing.md": "workflow-api-testing.md",
    "workflows/workflow-crash-investigation.md": "workflow-crash-investigation.md",
    "workflows/workflow-multi-device.md": "workflow-multi-device.md",
    "workflows/workflow-physical-device-setup.md": "workflow-physical-device-setup.md",
    "workflows/workflow-onboarding.md": "workflow-onboarding.md",
    "workflows/workflow-location-testing.md": "workflow-location-testing.md",
    "workflows/workflow-test-scripts.md": "workflow-test-scripts.md",
    "workflows/workflow-app-knowledge.md": "workflow-app-knowledge.md",
}

# Guides with no page on the site. Listed so the check can say so out loud
# instead of silently ignoring them.
UNPUBLISHED_GUIDES = {
    "index.md",          # the repo's own guide index; Starlight builds its own
    "deep-link-testing.md",  # no site page yet
}

# guide filename -> Starlight route, derived from MAPPING
ROUTES = {guide: "/" + site[:-3] + "/" for site, guide in MAPPING.items()}


def rewrite_links(body: str) -> str:
    """Turn relative `foo.md` / `foo.md#anchor` links into Starlight routes."""

    def replace(match: re.Match[str]) -> str:
        target, anchor = match.group(1), match.group(2) or ""
        route = ROUTES.get(target)
        return f"]({route}{anchor.lstrip('#') and anchor})" if route else match.group(0)

    return re.sub(r"\]\(([a-z0-9-]+\.md)(#[^)]*)?\)", replace, body)


def frontmatter(text: str) -> str:
    match = re.match(r"^---\n.*?\n---\n", text, re.S)
    return match.group(0) if match else ""


def body_of_guide(text: str) -> str:
    """Guide body: drop the H1 (Starlight renders the frontmatter title)."""
    return re.sub(r"^#\s+.*\n+", "", text, count=1).strip() + "\n"


def render(site_path: Path, guide_path: Path) -> str:
    fm = frontmatter(site_path.read_text()) if site_path.exists() else ""
    if not fm:
        raise SystemExit(f"{site_path} has no frontmatter — refusing to guess a title")
    # Two blank lines after the frontmatter block matches the existing pages,
    # so syncing an unchanged guide produces a byte-identical file.
    return fm + "\n\n" + rewrite_links(body_of_guide(guide_path.read_text()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO)
    parser.add_argument("--check", action="store_true", help="report drift, don't write")
    args = parser.parse_args()

    guides = args.repo / "docs" / "guides"
    if not guides.is_dir():
        print(f"error: {guides} not found — pass --repo /path/to/quern", file=sys.stderr)
        return 2

    drifted, written, missing = [], [], []
    for site_rel, guide_name in sorted(MAPPING.items()):
        site_path, guide_path = SITE_DOCS / site_rel, guides / guide_name
        if not guide_path.exists():
            missing.append(guide_name)
            continue
        rendered = render(site_path, guide_path)
        if site_path.exists() and site_path.read_text() == rendered:
            continue
        if args.check:
            drifted.append(site_rel)
        else:
            site_path.write_text(rendered)
            written.append(site_rel)

    unpublished = sorted(
        p.name for p in guides.glob("*.md")
        if p.name not in MAPPING.values() and p.name not in UNPUBLISHED_GUIDES
    )

    for name in missing:
        print(f"error: mapped guide not found in repo: {name}", file=sys.stderr)
    for name in unpublished:
        print(f"warning: guide has no site page and is not in UNPUBLISHED_GUIDES: {name}")

    if args.check:
        if drifted:
            print(f"\n{len(drifted)} page(s) out of sync with the quern repo:")
            for name in drifted:
                print(f"  - {name}")
            print("\nRun scripts/sync-docs.py to update them.")
            return 1
        print(f"All {len(MAPPING)} synced pages match the quern repo.")
        return 2 if missing else 0

    print(f"Updated {len(written)} of {len(MAPPING)} page(s).")
    for name in written:
        print(f"  - {name}")
    return 2 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
