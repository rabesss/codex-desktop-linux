#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { validateLock } = require("./validate-upstream-dmg-lock.js");
const { run: promoteRun } = require("./promote-upstream-dmg-lock.js");

const OFFICIAL_DMG_URL = "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(repoDir, args) {
  const result = spawnSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitClone(args) {
  const result = spawnSync("git", ["clone", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createRepoWithTwoCommits() {
  const repoDir = tempDir("codex-upstream-dmg-lock-repo-");
  git(repoDir, ["init", "-q"]);
  git(repoDir, ["config", "user.email", "ci@example.invalid"]);
  git(repoDir, ["config", "user.name", "CI"]);
  fs.writeFileSync(path.join(repoDir, "marker.txt"), "one\n", "utf8");
  git(repoDir, ["add", "marker.txt"]);
  git(repoDir, ["commit", "-q", "-m", "one"]);
  const first = git(repoDir, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(repoDir, "marker.txt"), "two\n", "utf8");
  git(repoDir, ["commit", "-q", "-am", "two"]);
  const second = git(repoDir, ["rev-parse", "HEAD"]);
  return { repoDir, first, second };
}

function approvedRecord(wrapperCommit, overrides = {}) {
  return {
    upstream_app_version: "26.616.71553",
    dmg_url: OFFICIAL_DMG_URL,
    sha256: "a".repeat(64),
    size: 525051984,
    etag: null,
    last_modified: null,
    approved_at: "2026-06-24T00:00:00Z",
    approved_by: "manual",
    wrapper_min_commit: wrapperCommit,
    patch_report: null,
    notes: "Initial approval.",
    ...overrides,
  };
}

function candidateRecord(wrapperCommit, overrides = {}) {
  return {
    upstream_app_version: "26.617.10000",
    dmg_url: OFFICIAL_DMG_URL,
    sha256: "b".repeat(64),
    size: 525052000,
    etag: "candidate-etag",
    last_modified: "Tue, 23 Jun 2026 15:40:00 GMT",
    detected_at: "2026-06-25T01:02:03Z",
    ci_status: "passed",
    workflow_run_url: "https://github.com/rabesss/codex-linux/actions/runs/1234567890",
    patch_report_artifact: "patch-report.json",
    wrapper_min_commit: wrapperCommit,
    notes: "Validated candidate.",
    ...overrides,
  };
}

function lockWithApproved(wrapperCommit, overrides = {}) {
  return {
    schema_version: 1,
    approved: approvedRecord(wrapperCommit, overrides.approved),
    candidate: overrides.candidate === undefined ? null : overrides.candidate,
  };
}

function capturePromote(args) {
  let stdout = "";
  let stderr = "";
  const code = promoteRun(args, {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } },
  });
  return { code, stdout, stderr };
}

test("validator rejects an approved record with a missing hash", () => {
  const lock = lockWithApproved("1".repeat(40));
  delete lock.approved.sha256;

  const failures = validateLock(lock, { checkGit: false });

  assert.match(failures.join("\n"), /approved[.]sha256: required/);
});

test("validator rejects malformed upstream metadata", () => {
  const lock = lockWithApproved("1".repeat(40), {
    approved: {
      dmg_url: "http://example.invalid/Codex.dmg",
      size: "525051984",
      last_modified: "2026-06-23T15:40:00Z",
      etag: "unknown",
    },
  });

  const failures = validateLock(lock, { checkGit: false }).join("\n");

  assert.match(failures, /approved[.]dmg_url: must point to the official HTTPS Codex[.]dmg URL/);
  assert.match(failures, /approved[.]size: must be a positive integer byte size/);
  assert.match(failures, /approved[.]last_modified: must be null or an HTTP Last-Modified date ending in GMT/);
  assert.match(failures, /approved[.]etag: must be null or a concrete ETag string/);
});

test("validator rejects a candidate with a stale wrapper minimum", () => {
  const { repoDir, first, second } = createRepoWithTwoCommits();
  try {
    const lock = lockWithApproved(second, {
      candidate: candidateRecord(first),
    });

    const failures = validateLock(lock, { repoDir }).join("\n");

    assert.match(failures, /candidate[.]wrapper_min_commit: stale wrapper minimum/);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("validator explains shallow checkouts when wrapper commit history is missing", () => {
  const { repoDir, first } = createRepoWithTwoCommits();
  const shallowDir = tempDir("codex-upstream-dmg-lock-shallow-");
  try {
    fs.rmSync(shallowDir, { recursive: true, force: true });
    gitClone(["--depth", "1", `file://${repoDir}`, shallowDir]);
    assert.equal(git(shallowDir, ["rev-parse", "--is-shallow-repository"]), "true");

    const failures = validateLock(lockWithApproved(first), { repoDir: shallowDir }).join("\n");

    assert.match(failures, /approved[.]wrapper_min_commit: commit does not exist/);
    assert.match(failures, /fetch full history before validating wrapper_min_commit/);
    assert.match(failures, /fetch-depth: 0/);
  } finally {
    fs.rmSync(shallowDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("validator rejects payload and private path metadata", () => {
  const lock = lockWithApproved("1".repeat(40), {
    approved: {
      patch_report: "/home/user/Codex.app",
      notes: "do not upload dist/codex-desktop.pkg.tar.zst",
    },
  });

  const failures = validateLock(lock, { checkGit: false }).join("\n");

  assert.match(failures, /must not contain private or local filesystem paths/);
  assert.match(failures, /must not reference DMG, app, package, or extracted payload files/);
});

test("promotion copies a validated candidate into approved and clears candidate", () => {
  const { repoDir, first, second } = createRepoWithTwoCommits();
  const root = tempDir("codex-upstream-dmg-lock-promote-");
  try {
    const lockPath = path.join(root, "upstream-dmg-lock.json");
    const lock = lockWithApproved(first, {
      candidate: candidateRecord(second),
    });
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const result = capturePromote([
      lockPath,
      "--repo-dir",
      repoDir,
      "--approved-at",
      "2026-06-25T12:00:00Z",
      "--approved-by",
      "manual",
      "--notes",
      "Passed local dogfood.",
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /promoted:/);
    const promoted = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.equal(promoted.candidate, null);
    assert.equal(promoted.approved.sha256, "b".repeat(64));
    assert.equal(promoted.approved.upstream_app_version, "26.617.10000");
    assert.equal(promoted.approved.wrapper_min_commit, second);
    assert.equal(promoted.approved.patch_report, "patch-report.json");
    assert.equal(promoted.approved.approved_at, "2026-06-25T12:00:00Z");
    assert.equal(promoted.approved.notes, "Passed local dogfood.");
    assert.deepEqual(validateLock(promoted, { repoDir }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("promotion can import a metadata-only CI candidate manifest", () => {
  const { repoDir, first, second } = createRepoWithTwoCommits();
  const root = tempDir("codex-upstream-dmg-lock-promote-manifest-");
  try {
    const lockPath = path.join(root, "upstream-dmg-lock.json");
    const manifestPath = path.join(root, "upstream-dmg-candidate.json");
    const lock = lockWithApproved(first);
    const manifest = {
      schema_version: 1,
      kind: "upstream-dmg-candidate",
      generated_at: "2026-06-25T06:30:00Z",
      upstream: {
        upstream_app_version: "26.618.20000",
        url: OFFICIAL_DMG_URL,
        sha256: "c".repeat(64),
        size_bytes: 525052111,
        etag: "candidate-etag",
        last_modified: "Thu, 25 Jun 2026 06:00:00 GMT",
      },
      validation: {
        status: "passed",
        validated_at: "2026-06-25T06:30:00Z",
        patch_report_artifact: "patch-report.json",
      },
      workflow: {
        sha: second,
        run_url: "https://github.com/rabesss/codex-linux/actions/runs/1234567890",
      },
    };
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = capturePromote([
      lockPath,
      "--repo-dir",
      repoDir,
      "--from-candidate-manifest",
      manifestPath,
      "--approved-at",
      "2026-06-25T12:00:00Z",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const promoted = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.equal(promoted.candidate, null);
    assert.equal(promoted.approved.sha256, "c".repeat(64));
    assert.equal(promoted.approved.upstream_app_version, "26.618.20000");
    assert.equal(promoted.approved.wrapper_min_commit, second);
    assert.equal(promoted.approved.patch_report, "patch-report.json");
    assert.deepEqual(validateLock(promoted, { repoDir }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
