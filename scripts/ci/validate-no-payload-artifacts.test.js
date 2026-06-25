#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  inspectNoPayloadArtifacts,
  isForbiddenPayloadPath,
  run,
} = require("./validate-no-payload-artifacts.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-no-payload-artifacts-"));
}

test("isForbiddenPayloadPath detects app, DMG, package, archive, and codex-app payloads", () => {
  assert.equal(isForbiddenPayloadPath("Codex.dmg"), true);
  assert.equal(isForbiddenPayloadPath("dist/codex-desktop.pkg.tar.zst"), true);
  assert.equal(isForbiddenPayloadPath("Codex.app/Contents/Resources/app.asar"), true);
  assert.equal(isForbiddenPayloadPath("codex-app/resources/bin/codex"), true);
  assert.equal(isForbiddenPayloadPath("upstream-dmg-candidate.json"), false);
  assert.equal(isForbiddenPayloadPath("patch-report.json"), false);
});

test("inspectNoPayloadArtifacts accepts metadata and report files", () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "upstream-dmg-candidate.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "patch-report.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "upstream-dmg-candidate-issue.md"), "# Candidate\n", "utf8");

    const result = inspectNoPayloadArtifacts([root]);
    assert.equal(result.ok, true, result.violations.join("\n"));
    assert.equal(result.files.length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("inspectNoPayloadArtifacts rejects payload-looking files and directories", () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "Codex.dmg"), "payload", "utf8");
    fs.mkdirSync(path.join(root, "codex-app", "resources"), { recursive: true });
    fs.writeFileSync(path.join(root, "codex-app", "resources", "metadata.json"), "{}\n", "utf8");

    const result = inspectNoPayloadArtifacts([root]);
    assert.equal(result.ok, false);
    assert.match(result.violations.join("\n"), /Codex\.dmg/);
    assert.match(result.violations.join("\n"), /codex-app/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("inspectNoPayloadArtifacts rejects oversized metadata files", () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "patch-report.json"), "1234567890", "utf8");
    const result = inspectNoPayloadArtifacts([root], { maxBytes: 4 });
    assert.equal(result.ok, false);
    assert.match(result.violations.join("\n"), /above metadata artifact limit/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("inspectNoPayloadArtifacts rejects binary files and forbidden private paths", () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "patch-report.json"), "/tmp/private-runner-path/main.js\n", "utf8");
    fs.writeFileSync(path.join(root, "binary.log"), Buffer.from([0, 1, 2, 3]));

    const result = inspectNoPayloadArtifacts([root], {
      privatePath: ["/tmp/private-runner-path"],
    });

    assert.equal(result.ok, false);
    assert.match(result.violations.join("\n"), /contains private path/);
    assert.match(result.violations.join("\n"), /binary files are not allowed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("run reports validation failures", () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, "codex-desktop.deb"), "payload", "utf8");
    let stderr = "";
    const code = run([root], {
      stdout: { write: () => {} },
      stderr: { write: (chunk) => { stderr += chunk; } },
    });

    assert.equal(code, 1);
    assert.match(stderr, /No-payload artifact validation failed/);
    assert.match(stderr, /codex-desktop\.deb/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
