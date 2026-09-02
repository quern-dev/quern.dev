/**
 * Cloudflare Worker entry point.
 *
 * Static assets are served automatically via [assets] in wrangler.toml.
 * This worker handles API routes that don't match a static file
 * (configured via not_found_handling = "none").
 */

const GIT_REFS_URL = "https://github.com/quern-dev/quern.git/info/refs?service=git-upload-pack";
const CACHE_TTL = 3600; // 1 hour

// Channels map to the reserved pointer branches the release procedure
// fast-forwards. Comparing against `main` (as this endpoint used to) tells a
// fully up-to-date stable user that an update is available the moment any
// commit lands on main — while `quern update`, which compares against
// release/stable, correctly refuses to apply anything. Same data, opposite
// answers. See docs/release-channels.md in the quern repo.
const CHANNEL_BRANCHES = {
  stable: "refs/heads/release/stable",
  beta: "refs/heads/release/beta",
};
const DEFAULT_CHANNEL = "stable";

/**
 * Infer the channel from the client's version string.
 *
 * Clients only started sending `channel=` after v0.14.1-beta.2, so every beta
 * client already in the field omits it and gets compared against
 * release/stable. That produced a live downgrade prompt: a user on
 * 0.14.1-beta.2 was told "Update available (v0.14.0)". Those clients cannot be
 * fixed by shipping a new quern, because the broken check is what would have
 * told them to upgrade.
 *
 * A prerelease suffix is the only channel signal such a client sends, so use
 * it. Explicit `channel=` always wins — this is a fallback for clients that
 * cannot express the answer, not a second opinion about clients that can.
 */
function channelFromVersion(version) {
  return /-(?:beta|rc|alpha)\b/i.test(version) ? "beta" : DEFAULT_CHANNEL;
}

/**
 * Parse a git smart-HTTP ref advertisement into a ref -> sha map.
 *
 * Annotated tags appear twice: `refs/tags/v1.2.3` is the tag object and
 * `refs/tags/v1.2.3^{}` is the commit it points at. Only the peeled form is
 * comparable to a branch head, and every Quern release tag is annotated.
 */
function parseRefs(body) {
  const refs = new Map();
  const pattern = /([0-9a-f]{40}) (refs\/[^\s\0\n]+)/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    refs.set(match[2], match[1]);
  }
  return refs;
}

/** Tag name whose commit is `sha`, or null. Prefers the peeled form. */
function versionForSha(refs, sha) {
  if (!sha) return null;
  for (const [ref, target] of refs) {
    if (!ref.startsWith("refs/tags/") || target !== sha) continue;
    const name = ref.slice("refs/tags/".length);
    if (name.endsWith("^{}")) return name.slice(0, -3).replace(/^v/, "");
  }
  // Lightweight tag fallback — no peeled entry exists for these.
  for (const [ref, target] of refs) {
    if (ref.startsWith("refs/tags/") && !ref.endsWith("^{}") && target === sha) {
      return ref.slice("refs/tags/".length).replace(/^v/, "");
    }
  }
  return null;
}

/** Fetch and cache the ref advertisement at the edge. */
async function fetchRefs() {
  const cache = caches.default;
  const cacheKey = new Request("https://quern.dev/_internal/github-refs-cache");

  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Map(await cached.json());
  }

  try {
    const resp = await fetch(GIT_REFS_URL, {
      headers: { "User-Agent": "git/2.0 quern-update-check" },
    });
    if (!resp.ok) return null;
    const refs = parseRefs(await resp.text());
    if (refs.size === 0) return null;

    await cache.put(
      cacheKey,
      new Response(JSON.stringify([...refs]), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`,
        },
      })
    );
    return refs;
  } catch {
    return null;
  }
}

async function handleCheckUpdate(request) {
  const url = new URL(request.url);
  const clientSha = url.searchParams.get("sha") || "";

  const requested =
    url.searchParams.get("channel") ||
    channelFromVersion(url.searchParams.get("version") || "");
  // Unknown channel falls back to stable rather than erroring: a client from a
  // future version naming a channel this worker doesn't know should still get a
  // conservative, useful answer.
  const channel = requested in CHANNEL_BRANCHES ? requested : DEFAULT_CHANNEL;

  const refs = await fetchRefs();
  let latestSha = null;
  let latestVersion = null;

  if (refs) {
    // Fall back to main only if the pointer branch is missing entirely, so a
    // mis-bootstrapped repo degrades to the old behaviour instead of 500ing.
    latestSha = refs.get(CHANNEL_BRANCHES[channel]) || refs.get("refs/heads/main") || null;
    latestVersion = versionForSha(refs, latestSha);
  }

  const body = {
    latest_sha: latestSha,
    latest_version: latestVersion,
    channel,
    update_available: latestSha !== null && clientSha !== "" && clientSha !== latestSha,
  };

  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function getUid(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(hash.slice(0, 4))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/check-update") {
      const uid = await getUid(request);
      console.log(`[endpoint] /api/check-update sha=${url.searchParams.get("sha") || ""} channel=${url.searchParams.get("channel") || "stable"} uid=${uid}`);
      return handleCheckUpdate(request);
    }

    if (url.pathname === "/install.sh") {
      const uid = await getUid(request);
      console.log(`[endpoint] /install.sh uid=${uid}`);
      // Fetch the renamed asset (/_install.sh) so the CDN can't serve
      // /install.sh directly and bypass the worker.
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/_install.sh";
      const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
      const response = new Response(assetResponse.body, assetResponse);
      response.headers.set("Content-Type", "text/plain; charset=utf-8");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    // Serve static assets via the ASSETS binding
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    // No matching route or asset — return 404
    return new Response("Not Found", { status: 404 });
  },
};
