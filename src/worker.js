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
/**
 * Parse a semver string into comparable parts, or null if it isn't one.
 *
 * Build metadata (`+sha`) is dropped: semver says it carries no precedence.
 */
export function parseVersion(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
    .exec(String(version || "").trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
  };
}

/**
 * Semver precedence. Returns -1, 0, 1, or null if either side won't parse.
 *
 * The prerelease rules matter here rather than being pedantry: this project
 * ships `-beta.N` versions, so "0.14.1-beta.2 is older than 0.14.1" and
 * "beta.2 is newer than beta.1" both have to come out right, and neither
 * falls out of a string comparison.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  for (const part of ["major", "minor", "patch"]) {
    if (pa[part] !== pb[part]) return pa[part] < pb[part] ? -1 : 1;
  }
  // A version with a prerelease suffix precedes the same version without one.
  if (pa.pre.length === 0 && pb.pre.length > 0) return 1;
  if (pa.pre.length > 0 && pb.pre.length === 0) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;  // fewer fields precede more
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;         // numeric identifiers precede alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Whether the client should be told an update exists.
 *
 * Two ways to answer, and the SHA is the better one: it is exact, and it is
 * what a git install can supply. A tarball install has no `.git`, so
 * `_get_head_sha()` returns null and the client sends only `version=`.
 *
 * That case used to answer "no update", always, because the comparison
 * required a SHA. Tarball installs therefore never learned about any release:
 * one user sat on 0.13.2 from late May to 11 September, across three minor
 * versions, with nothing telling them otherwise. They could not be fixed by
 * shipping a new quern either — the broken check is what would have told them
 * to upgrade. Same shape as the beta downgrade prompt `channelFromVersion`
 * was added for, and the same reason it had to be fixed here rather than in
 * the client.
 *
 * Strictly older, not merely different. A client ahead of the channel head --
 * someone on a dev build, or on beta while asking about stable -- gets `false`
 * rather than being invited to downgrade.
 *
 * A version that does not parse answers `false`. There is no safe guess, and
 * a wrong "yes" sends someone into an update they did not need.
 */
export function isUpdateAvailable({ clientSha, latestSha, clientVersion, latestVersion }) {
  if (!latestSha) return false;
  if (clientSha) return clientSha !== latestSha;
  if (!latestVersion || !clientVersion) return false;
  return compareVersions(clientVersion, latestVersion) === -1;
}

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
  const clientVersion = url.searchParams.get("version") || "";

  const requested =
    url.searchParams.get("channel") || channelFromVersion(clientVersion);
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
    update_available: isUpdateAvailable({
      clientSha,
      latestSha,
      clientVersion,
      latestVersion,
    }),
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
