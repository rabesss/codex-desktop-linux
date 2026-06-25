#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readLockFile, validateLock } = require("./validate-upstream-dmg-lock.js");

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const APP_VERSION_PATTERN = /^[0-9]+[.][0-9]+[.][0-9]+$/u;

function usage() {
  return [
    "Usage: promote-upstream-dmg-lock.js <release/upstream-dmg-lock.json> [options]",
    "",
    "Options:",
    "  --from-candidate-manifest <json>",
    "                            Import CI upstream-dmg-candidate.json before promotion",
    "  --wrapper-min-commit <sha> Override imported candidate wrapper minimum",
    "  --approved-at <iso-utc>   Approval timestamp (default: current UTC time)",
    "  --approved-by <label>     Public-safe approver label (default: manual)",
    "  --notes <text>            Approved-record notes",
    "  --repo-dir <path>         Repository path for wrapper commit validation",
    "  --dry-run                 Print the promoted lock instead of writing it",
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    approvedBy: "manual",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--approved-at":
        options.approvedAt = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--from-candidate-manifest":
        options.fromCandidateManifest = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--wrapper-min-commit":
        options.wrapperMinCommit = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--approved-by":
        options.approvedBy = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--notes":
        options.notes = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--repo-dir":
        options.repoDir = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        positional.push(arg);
        break;
    }
  }
  if (!options.help && positional.length !== 1) {
    throw new Error(usage());
  }
  return { ...options, lockPath: positional[0] };
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function isoNowSeconds() {
  return new Date().toISOString().replace(/[.]\d{3}Z$/u, "Z");
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireString(object, field, pointer) {
  const value = object?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${pointer}.${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireSha256(object, field, pointer) {
  const value = requireString(object, field, pointer).toLowerCase();
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${pointer}.${field} must be a lowercase 64-character SHA256 hex digest`);
  }
  return value;
}

function requireAppVersion(object, field, pointer) {
  const value = requireString(object, field, pointer);
  if (!APP_VERSION_PATTERN.test(value)) {
    throw new Error(`${pointer}.${field} must use the upstream app version form like 26.616.71553`);
  }
  return value;
}

function requirePositiveInteger(object, field, pointer) {
  const value = object?.[field];
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${pointer}.${field} must be a positive integer`);
  }
  return value;
}

function optionalNullableString(object, field) {
  const value = object?.[field];
  if (value == null) {
    return null;
  }
  return String(value).trim() || null;
}

function candidateFromManifest(manifest, options = {}) {
  if (!isPlainObject(manifest)) {
    throw new Error("candidate manifest must be a JSON object");
  }
  if (manifest.kind !== "upstream-dmg-candidate") {
    throw new Error("candidate manifest kind must be upstream-dmg-candidate");
  }
  if (!isPlainObject(manifest.upstream)) {
    throw new Error("candidate manifest upstream must be an object");
  }
  if (!isPlainObject(manifest.validation)) {
    throw new Error("candidate manifest validation must be an object");
  }
  if (!isPlainObject(manifest.workflow)) {
    throw new Error("candidate manifest workflow must be an object");
  }
  if (manifest.validation.status !== "passed") {
    throw new Error(`candidate manifest validation.status is ${manifest.validation.status}`);
  }

  const wrapperMinCommit = options.wrapperMinCommit || optionalNullableString(manifest.workflow, "sha");
  if (!wrapperMinCommit || !COMMIT_PATTERN.test(wrapperMinCommit)) {
    throw new Error("wrapper_min_commit is required; pass --wrapper-min-commit or use a CI manifest with workflow.sha");
  }

  return {
    upstream_app_version: requireAppVersion(manifest.upstream, "upstream_app_version", "manifest.upstream"),
    dmg_url: requireString(manifest.upstream, "url", "manifest.upstream"),
    sha256: requireSha256(manifest.upstream, "sha256", "manifest.upstream"),
    size: requirePositiveInteger(manifest.upstream, "size_bytes", "manifest.upstream"),
    etag: optionalNullableString(manifest.upstream, "etag"),
    last_modified: optionalNullableString(manifest.upstream, "last_modified"),
    detected_at: requireString(manifest, "generated_at", "manifest"),
    ci_status: "passed",
    workflow_run_url: requireString(manifest.workflow, "run_url", "manifest.workflow"),
    patch_report_artifact: requireString(manifest.validation, "patch_report_artifact", "manifest.validation"),
    wrapper_min_commit: wrapperMinCommit,
    notes: "Imported from a metadata-only CI candidate manifest.",
  };
}

function promoteLock(lock, options = {}) {
  const promotionLock = options.candidateManifest
    ? { ...lock, candidate: candidateFromManifest(options.candidateManifest, options) }
    : lock;
  const validationOptions = {
    repoDir: options.repoDir,
    checkGit: options.checkGit,
  };
  const currentFailures = validateLock(promotionLock, validationOptions);
  if (currentFailures.length > 0) {
    throw new Error(`Cannot promote invalid lock:\n${currentFailures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  const candidate = promotionLock.candidate;
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Cannot promote: candidate is null");
  }
  if (candidate.ci_status !== "passed") {
    throw new Error(`Cannot promote: candidate.ci_status is ${candidate.ci_status}`);
  }

  const promoted = {
    schema_version: lock.schema_version,
    approved: {
      upstream_app_version: candidate.upstream_app_version,
      dmg_url: candidate.dmg_url,
      sha256: candidate.sha256,
      size: candidate.size,
      etag: candidate.etag,
      last_modified: candidate.last_modified,
      approved_at: options.approvedAt || isoNowSeconds(),
      approved_by: options.approvedBy || "manual",
      wrapper_min_commit: candidate.wrapper_min_commit,
      patch_report: candidate.patch_report_artifact,
      notes: options.notes || candidate.notes || "Promoted from a validated upstream DMG candidate.",
    },
    candidate: null,
  };

  const promotedFailures = validateLock(promoted, validationOptions);
  if (promotedFailures.length > 0) {
    throw new Error(`Promotion would write an invalid lock:\n${promotedFailures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  return promoted;
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function run(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    const lockPath = path.resolve(parsed.lockPath);
    const lock = readLockFile(lockPath);
    const candidateManifest = parsed.fromCandidateManifest
      ? readJsonFile(path.resolve(parsed.fromCandidateManifest))
      : null;
    const promoted = promoteLock(lock, {
      approvedAt: parsed.approvedAt,
      approvedBy: parsed.approvedBy,
      notes: parsed.notes,
      repoDir: parsed.repoDir,
      wrapperMinCommit: parsed.wrapperMinCommit,
      candidateManifest,
    });
    if (parsed.dryRun) {
      stdout.write(`${JSON.stringify(promoted, null, 2)}\n`);
    } else {
      writeJsonFile(lockPath, promoted);
      stdout.write(`promoted: ${lockPath}\n`);
    }
    return 0;
  } catch (error) {
    stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = {
  candidateFromManifest,
  parseArgs,
  promoteLock,
  run,
};
