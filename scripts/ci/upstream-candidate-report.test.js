#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCandidateManifest,
  buildIssueBody,
  issueTitleFor,
  redactPrivatePaths,
  run,
  sanitizedMetadataForArtifact,
} = require("./write-upstream-candidate-report.js");

const VALID_SHA = "a".repeat(64);

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-upstream-candidate-"));
}

function metadata(overrides = {}) {
  return {
    upstream_app_version: "26.617.10000",
    url: "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg",
    path: "/tmp/codex-upstream-ci/Codex.dmg",
    last_modified: "Thu, 25 Jun 2026 06:00:00 GMT",
    etag: "\"candidate-etag\"",
    content_length: "42",
    sha256: VALID_SHA,
    size_bytes: "42",
    tested_at_utc: "2026-06-25T06:30:00Z",
    cache_schema_version: "v1",
    ...overrides,
  };
}

function patchReport() {
  return {
    generatedAt: "2026-06-25T06:29:00Z",
    target: "/tmp/codex-build/Codex.app/Contents/Resources/app/.vite/build/main.js",
    patches: [
      { name: "main-process-ui", status: "applied" },
      { name: "linux-app-sunset-gate", status: "already-applied" },
    ],
  };
}

test("buildCandidateManifest emits metadata without payload paths", () => {
  const root = tempDir();
  try {
    const patchReportPath = path.join(root, "patch-report.json");
    fs.writeFileSync(patchReportPath, `${JSON.stringify(patchReport())}\n`, "utf8");

    const candidate = buildCandidateManifest({
      metadata: metadata(),
      patchReport: patchReport(),
      patchReportPath,
      artifactName: "candidate-artifact",
      env: {
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "rabesss/codex-linux",
        GITHUB_RUN_ID: "123",
      },
    });

    assert.equal(candidate.kind, "upstream-dmg-candidate");
    assert.equal(candidate.upstream.upstream_app_version, "26.617.10000");
    assert.equal(candidate.upstream.sha256, VALID_SHA);
    assert.equal(candidate.upstream.size_bytes, 42);
    assert.equal(candidate.workflow.run_url, "https://github.com/rabesss/codex-linux/actions/runs/123");
    assert.deepEqual(candidate.validation.patch_summary.by_status, {
      "already-applied": 1,
      applied: 1,
    });

    const serialized = JSON.stringify(candidate);
    assert.doesNotMatch(serialized, /\/tmp\/codex-upstream-ci\/Codex\.dmg/);
    assert.doesNotMatch(serialized, /Codex\.app/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildIssueBody includes manual promotion checklist and no-payload boundary", () => {
  const root = tempDir();
  try {
    const patchReportPath = path.join(root, "patch-report.json");
    fs.writeFileSync(patchReportPath, `${JSON.stringify(patchReport())}\n`, "utf8");
    const candidate = buildCandidateManifest({
      metadata: metadata(),
      patchReport: patchReport(),
      patchReportPath,
      artifactName: "candidate-artifact",
      env: {},
    });
    candidate.promotion.issue_title = issueTitleFor(candidate);

    const body = buildIssueBody(candidate);
    assert.match(body, /Manual Dogfood Checklist/);
    assert.match(body, /No-Payload Boundary/);
    assert.match(body, new RegExp(VALID_SHA));
    assert.match(body, /not an approval/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sanitizedMetadataForArtifact strips runner-only metadata fields", () => {
  const sanitized = sanitizedMetadataForArtifact(metadata());
  assert.equal(sanitized.kind, "upstream-dmg-metadata");
  assert.equal(sanitized.upstream_app_version, "26.617.10000");
  assert.equal(sanitized.sha256, VALID_SHA);
  assert.equal(Object.hasOwn(sanitized, "path"), false);
});

test("redactPrivatePaths removes runner paths from patch reports", () => {
  const report = patchReport();
  const redacted = redactPrivatePaths(report, [
    "/tmp/codex-build",
    "/tmp/codex-upstream-ci/Codex.dmg",
  ]);

  assert.doesNotMatch(JSON.stringify(redacted), /\/tmp\/codex-build/);
  assert.match(redacted.target, /\[redacted-path\]/);
});

test("run writes candidate, issue, summary, and GitHub outputs", () => {
  const root = tempDir();
  try {
    const metadataPath = path.join(root, "upstream-dmg-metadata.json");
    const patchReportPath = path.join(root, "patch-report.json");
    const candidatePath = path.join(root, "upstream-dmg-candidate.json");
    const issueBodyPath = path.join(root, "upstream-dmg-candidate-issue.md");
    const summaryPath = path.join(root, "upstream-dmg-candidate-summary.md");
    const metadataOutPath = path.join(root, "out", "upstream-dmg-metadata.json");
    const patchReportOutPath = path.join(root, "out", "patch-report.json");
    const githubOutputPath = path.join(root, "github-output");
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata())}\n`, "utf8");
    fs.writeFileSync(patchReportPath, `${JSON.stringify(patchReport())}\n`, "utf8");

    let stdout = "";
    let stderr = "";
    const code = run([
      "--metadata", metadataPath,
      "--patch-report", patchReportPath,
      "--candidate", candidatePath,
      "--issue-body", issueBodyPath,
      "--summary", summaryPath,
      "--metadata-out", metadataOutPath,
      "--patch-report-out", patchReportOutPath,
      "--private-path", "/tmp/codex-build",
      "--github-output", githubOutputPath,
    ], {
      env: {},
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    });

    assert.equal(code, 0, stderr);
    assert.match(stdout, /Wrote upstream candidate manifest/);
    assert.equal(JSON.parse(fs.readFileSync(candidatePath, "utf8")).upstream.sha256, VALID_SHA);
    assert.match(fs.readFileSync(issueBodyPath, "utf8"), /metadata only/);
    assert.match(fs.readFileSync(summaryPath, "utf8"), /Upstream DMG Candidate/);
    assert.match(fs.readFileSync(githubOutputPath, "utf8"), /issue_title=Upstream Codex DMG candidate aaaaaaaaaaaa/);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(metadataOutPath, "utf8")), "path"), false);
    assert.doesNotMatch(fs.readFileSync(patchReportOutPath, "utf8"), /\/tmp\/codex-build/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("run rejects malformed candidate metadata", () => {
  const root = tempDir();
  try {
    const metadataPath = path.join(root, "upstream-dmg-metadata.json");
    const patchReportPath = path.join(root, "patch-report.json");
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata({ sha256: "not-a-sha" }))}\n`, "utf8");
    fs.writeFileSync(patchReportPath, `${JSON.stringify(patchReport())}\n`, "utf8");

    let stderr = "";
    const code = run([
      "--metadata", metadataPath,
      "--patch-report", patchReportPath,
      "--candidate", path.join(root, "candidate.json"),
      "--issue-body", path.join(root, "issue.md"),
      "--summary", path.join(root, "summary.md"),
    ], {
      stderr: { write: (chunk) => { stderr += chunk; } },
      stdout: { write: () => {} },
    });

    assert.equal(code, 1);
    assert.match(stderr, /sha256/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
