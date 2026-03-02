/**
 * Cloudflare Pages Function: GET /api/check-update
 *
 * Compares a client's commit SHA against the latest on main.
 * Cloudflare analytics count requests automatically — no logging or storage.
 */

const GITHUB_API = "https://api.github.com/repos/quern-dev/quern/commits/main";
const CACHE_TTL = 3600; // 1 hour

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const clientSha = url.searchParams.get("sha") || "";

  // Fetch latest commit SHA from GitHub (cached at edge)
  const cache = caches.default;
  const cacheKey = new Request(GITHUB_API);
  let latestSha = null;

  let cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    latestSha = data.sha;
  } else {
    try {
      const resp = await fetch(GITHUB_API, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "quern-update-check/1.0",
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        latestSha = data.sha;

        // Cache the GitHub response at the edge
        const cacheResp = new Response(JSON.stringify({ sha: latestSha }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${CACHE_TTL}`,
          },
        });
        context.waitUntil(cache.put(cacheKey, cacheResp));
      }
    } catch {
      // GitHub fetch failed — return unknown
    }
  }

  const body = {
    latest_sha: latestSha,
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
