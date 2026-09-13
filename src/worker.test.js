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
});

test("unparseable versions answer null rather than guessing", () => {
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(compareVersions("", "0.16.1"), null);
  assert.equal(compareVersions("0.16", "0.16.1"), null);
  assert.equal(compareVersions("0.16.1", undefined), null);
});

test("a leading v and build metadata are tolerated", () => {
  assert.equal(compareVersions("v0.13.2", "0.16.1"), -1);
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
