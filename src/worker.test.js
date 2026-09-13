// The version comparison behind `update_available`.
//
// Tested because the prerelease rules are the kind of thing that looks right
// and is not: this project ships `-beta.N` versions, so "0.14.1-beta.2 is
// older than 0.14.1" and "beta.2 is newer than beta.1" both have to come out
// right, and neither falls out of a string comparison.
//
//   node --test src/worker.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isUpdateAvailable, parseVersion } from "./worker.js";

test("compares the numeric parts", () => {
  assert.equal(compareVersions("0.13.2", "0.16.1"), -1);
  assert.equal(compareVersions("0.16.1", "0.13.2"), 1);
  assert.equal(compareVersions("0.16.1", "0.16.1"), 0);
  assert.equal(compareVersions("0.9.0", "0.10.0"), -1, "not a string compare");
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
});

test("a prerelease precedes the release it leads to", () => {
  assert.equal(compareVersions("0.14.1-beta.2", "0.14.1"), -1);
  assert.equal(compareVersions("0.14.1", "0.14.1-beta.2"), 1);
});

test("prerelease identifiers compare field by field", () => {
  assert.equal(compareVersions("0.14.1-beta.1", "0.14.1-beta.2"), -1);
  assert.equal(compareVersions("0.14.1-beta.10", "0.14.1-beta.9"), 1, "numeric, not lexical");
  assert.equal(compareVersions("0.14.1-alpha", "0.14.1-beta"), -1);
  assert.equal(compareVersions("0.14.1-beta", "0.14.1-beta.1"), -1, "fewer fields precede more");
  // semver §11: a numeric identifier always precedes an alphanumeric one.
  // Nothing else here puts the two in the same position, so inverting this
  // rule passed every other test.
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-1"), 1);
  assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
});

test("unparseable versions answer null rather than guessing", () => {
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(compareVersions("", "0.16.1"), null);
  assert.equal(compareVersions("0.16", "0.16.1"), null);
  assert.equal(compareVersions("0.16.1", undefined), null);
});

test("a leading v is tolerated", () => {
  assert.equal(compareVersions("v0.13.2", "0.16.1"), -1);
});

test("build metadata does not affect precedence", () => {
  // True of the comparison, and deliberately not asserted of the endpoint.
  // The client builds its query unencoded (`version={version}` in
  // update_check.py), and URLSearchParams decodes `+` as a space -- so
  // `?version=0.16.1+abc` arrives as "0.16.1 abc" and does not parse at all.
  // No shipped version has ever contained `+`; this documents the layer the
  // tolerance lives at rather than claiming the endpoint handles it.
  assert.equal(compareVersions("0.16.1+abc123", "0.16.1"), 0);
});

// --- what the endpoint actually answers ------------------------------------

const LATEST_SHA = "3b60d252578722eb74b19ffcd33b0ef8a35a3259";

test("a tarball install is told about a newer release", () => {
  // The reported bug: no `.git`, so no sha, so the old comparison said "no
  // update" forever. One user sat on 0.13.2 for three and a half months.
  assert.equal(
    isUpdateAvailable({
      clientSha: "",
      latestSha: LATEST_SHA,
      clientVersion: "0.13.2",
      latestVersion: "0.16.1",
    }),
    true,
  );
});

test("a tarball install on the current release is told nothing", () => {
  assert.equal(
    isUpdateAvailable({
      clientSha: "",
      latestSha: LATEST_SHA,
      clientVersion: "0.16.1",
      latestVersion: "0.16.1",
    }),
    false,
  );
});

test("a client ahead of the channel is never invited to downgrade", () => {
  // Someone on a dev build, or on beta asking about stable. The same mistake
  // `channelFromVersion` was added to stop, in the other direction.
  assert.equal(
    isUpdateAvailable({
      clientSha: "",
      latestSha: LATEST_SHA,
      clientVersion: "0.99.0",
      latestVersion: "0.16.1",
    }),
    false,
  );
});

test("a sha still wins when the client sends one", () => {
  // Exact, and what a git install can supply. The version is not consulted.
  assert.equal(
    isUpdateAvailable({
      clientSha: "deadbeef",
      latestSha: LATEST_SHA,
      clientVersion: "0.16.1",
      latestVersion: "0.16.1",
    }),
    true,
  );
  assert.equal(
    isUpdateAvailable({
      clientSha: LATEST_SHA,
      latestSha: LATEST_SHA,
      clientVersion: "0.1.0",
      latestVersion: "0.16.1",
    }),
    false,
  );
});

test("an unreadable request answers no rather than maybe", () => {
  // No sha and no version: an old client, or a probe. There is no safe guess,
  // and a wrong yes sends someone into an update they did not need.
  assert.equal(
    isUpdateAvailable({ clientSha: "", latestSha: LATEST_SHA, clientVersion: "", latestVersion: "0.16.1" }),
    false,
  );
  assert.equal(
    isUpdateAvailable({ clientSha: "", latestSha: LATEST_SHA, clientVersion: "garbage", latestVersion: "0.16.1" }),
    false,
  );
  // And when the worker itself could not resolve a head.
  assert.equal(
    isUpdateAvailable({ clientSha: "abc", latestSha: null, clientVersion: "0.1.0", latestVersion: null }),
    false,
  );
});

test("a beta client is told about a newer beta", () => {
  assert.equal(
    isUpdateAvailable({
      clientSha: "",
      latestSha: LATEST_SHA,
      clientVersion: "0.14.1-beta.1",
      latestVersion: "0.14.1-beta.2",
    }),
    true,
  );
});

// --- the endpoint itself ----------------------------------------------------
//
// The tests above cover the comparison; these cover the wiring around it.
// Without them the handler could be hardcoded to "no update", or could pass the
// client and latest versions the wrong way round, and every test still passed.

import { handleCheckUpdate } from "./worker.js";

const STABLE_HEAD = "3b60d252578722eb74b19ffcd33b0ef8a35a3259";
const UNTAGGED_HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** A ref advertisement shaped like the one fetchRefs returns. */
function refsWith({ stableHead = STABLE_HEAD, betaHead = STABLE_HEAD } = {}) {
  return new Map([
    ["refs/heads/main", UNTAGGED_HEAD],
    ["refs/heads/release/stable", stableHead],
    ["refs/heads/release/beta", betaHead],
    ["refs/tags/v0.16.1^{}", STABLE_HEAD],
    ["refs/tags/v0.15.0^{}", "1111111111111111111111111111111111111111"],
    ["refs/tags/v0.16.2-beta.1^{}", "2222222222222222222222222222222222222222"],
  ]);
}

async function ask(query, refs = refsWith()) {
  const res = await handleCheckUpdate(
    new Request(`https://quern.dev/api/check-update?${query}`),
    refs,
  );
  return res.json();
}

test("endpoint: a tarball install behind the release is told to update", async () => {
  const body = await ask("version=0.13.2&channel=stable");
  assert.equal(body.update_available, true);
  assert.equal(body.latest_version, "0.16.1");
});

test("endpoint: a tarball install on the release is told nothing", async () => {
  assert.equal((await ask("version=0.16.1&channel=stable")).update_available, false);
});

test("endpoint: the client and latest versions are not transposed", async () => {
  // Swapping them inverts every answer, and the comparison tests cannot see it.
  assert.equal((await ask("version=0.1.0&channel=stable")).update_available, true);
  assert.equal((await ask("version=9.9.9&channel=stable")).update_available, false);
});

test("endpoint: a sha still decides when the client sends one", async () => {
  assert.equal((await ask(`sha=${STABLE_HEAD}&version=0.1.0`)).update_available, false,
    "the sha matches the head, so no update regardless of the version");
  assert.equal((await ask("sha=deadbeef&version=0.16.1")).update_available, true);
});

test("endpoint: the channel is still inferred from the version", async () => {
  // The fix hoisted this call site. Nothing else would catch breaking it, and
  // breaking it reinstates the beta downgrade prompt channelFromVersion exists
  // to prevent.
  assert.equal((await ask("version=0.14.1-beta.2")).channel, "beta");
  assert.equal((await ask("version=0.14.1")).channel, "stable");
  assert.equal((await ask("version=0.14.1-beta.2&channel=stable")).channel, "stable",
    "an explicit channel still wins");
});

test("endpoint: an untagged channel head still names an installable release", async () => {
  // `git push origin main:refs/heads/release/beta` is a documented operation,
  // and it leaves the head with no tag on it. A tarball client has no sha, so
  // without a fallback it would be told "no update" however far behind it is.
  const refs = refsWith({ betaHead: UNTAGGED_HEAD });
  const body = await ask("version=0.15.0&channel=beta", refs);
  assert.equal(body.latest_version, "0.16.2-beta.1", "the newest beta tag");
  assert.equal(body.update_available, true);
});

test("endpoint: stable is never offered a prerelease", async () => {
  const refs = refsWith({ stableHead: UNTAGGED_HEAD });
  const body = await ask("version=0.15.0&channel=stable", refs);
  assert.equal(body.latest_version, "0.16.1", "not the newer 0.16.2-beta.1");
  assert.equal(body.update_available, true);
});

test("endpoint: no refs at all answers no rather than guessing", async () => {
  const body = await ask("version=0.1.0&channel=stable", new Map());
  assert.equal(body.latest_sha, null);
  assert.equal(body.update_available, false);
});
