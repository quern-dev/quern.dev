/**
 * Cloudflare Worker entry point.
 *
 * Static assets are served automatically via [assets] in wrangler.toml.
 * This worker handles API routes that don't match a static file
 * (configured via not_found_handling = "none").
 */

const GIT_REFS_URL = "https://github.com/quern-dev/quern.git/info/refs?service=git-upload-pack";
const CACHE_TTL = 3600; // 1 hour

/**
 * Parse the main branch SHA from git smart HTTP protocol response.
 * Format: "003d<sha> refs/heads/main\n"
 */
function parseMainSha(body) {
  const match = body.match(/([0-9a-f]{40}) refs\/heads\/main/);
  return match ? match[1] : null;
}

async function handleCheckUpdate(request) {
  const url = new URL(request.url);
  const clientSha = url.searchParams.get("sha") || "";

  // Fetch latest commit SHA from GitHub (cached at edge)
  const cache = caches.default;
  const cacheKey = new Request("https://quern.dev/_internal/github-sha-cache");
  let latestSha = null;

  let cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    latestSha = data.sha;
  } else {
    try {
      const resp = await fetch(GIT_REFS_URL, {
        headers: {
          "User-Agent": "git/2.0 quern-update-check",
        },
      });
      if (resp.ok) {
        const text = await resp.text();
        latestSha = parseMainSha(text);

        if (latestSha) {
          // Cache at the edge
          const cacheResp = new Response(JSON.stringify({ sha: latestSha }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${CACHE_TTL}`,
            },
          });
          await cache.put(cacheKey, cacheResp);
        }
      }
    } catch {
      // Fetch failed — return unknown
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/check-update") {
      return handleCheckUpdate(request);
    }

    // No matching route — return 404
    return new Response("Not Found", { status: 404 });
  },
};
