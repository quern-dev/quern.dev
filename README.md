# quern.dev

Landing page, docs site, and update-check endpoint for [Quern](https://github.com/quern-dev/quern).

Astro + Starlight for the pages, a small Cloudflare Worker (`src/worker.js`) for
the API routes and asset serving.

## Deployment — pushes to `main` go live automatically

**Cloudflare is connected to this GitHub repo and builds and deploys on every
push to `main`.** That connection is configured in the Cloudflare dashboard, not
in this repo — there is no workflow file and nothing in `wrangler.toml` that
hints at it. Treat a push to `main` as a publish.

There is no manual step. If you ever need one — the Git integration is
disconnected, or you want to ship without a commit:

```bash
npm run build
CLOUDFLARE_API_TOKEN="$(cat quern-analytics/cloudflare-api-token.txt)" npx wrangler deploy
```

That path needs an account ID as well: the deploy token is scoped without
account-list permission, so wrangler cannot work out which account to target on
its own. Prefer pushing.

To sanity-check what is actually live:

```bash
curl -s https://quern.dev/api/check-update?sha=$(git -C ../quern rev-parse origin/release/stable) | python3 -m json.tool
```

## The docs are generated, not hand-written

Everything under `src/content/docs/` is a derived copy of `docs/guides/*.md` in
the quern repo. Edit the guide **there**, then sync:

```bash
scripts/sync-docs.py                 # rewrite the site pages from ../quern
scripts/sync-docs.py --check         # report drift, exit 1 (for CI)
scripts/sync-docs.py --repo /path/to/quern
```

The transform: the repo guide supplies the body, the site page keeps its own
Starlight frontmatter (the title and description drive the sidebar and meta
tags), and relative `foo.md` links become absolute routes `/section/foo/`.

Editing a page under `src/content/docs/` directly will work until the next sync
overwrites it. These pages went unsynced from March to August 2026, during which
the app-state page told readers that checkpoints could not capture the
keychain — months after that stopped being true. `--check` exists so that gap
is visible instead of silent.

`src/pages/index.astro` is the landing page and is *not* generated — edit it
directly. It carries claims that go stale (the tool count, the Node version
floor); the numbers of record live in the quern repo's README and
`mcp/package.json`.

## Local development

```bash
npm install
npm run dev          # astro dev — pages only, no worker
npx wrangler dev     # full worker + built assets; run npm run build first
npm run build        # → dist/
```

## Layout

| Path | |
|------|--|
| `src/pages/index.astro` | Landing page (hand-written) |
| `src/content/docs/` | Starlight docs (generated — see above) |
| `src/worker.js` | Worker: `/api/check-update`, `/install.sh`, asset serving |
| `public/_install.sh` | Install script, served at `/install.sh` via the worker |
| `scripts/sync-docs.py` | Docs sync + drift check |
| `quern-analytics/` | Local analytics tooling and the deploy token — gitignored |
