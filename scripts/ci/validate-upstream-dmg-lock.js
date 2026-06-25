#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REPO_DIR = path.resolve(__dirname, "..", "..");
const SCHEMA_VERSION = 1;
const OFFICIAL_DMG_HOST = "persistent.oaistatic.com";
const OFFICIAL_DMG_PATH = "/codex-app-prod/Codex.dmg";

const ROOT_KEYS = new Set(["schema_version", "approved", "candidate"]);
const APPROVED_KEYS = new Set([
  "upstream_app_version",
  "dmg_url",
  "sha256",
  "size",
  "etag",
  "last_modified",
  "approved_at",
  "approved_by",
  "wrapper_min_commit",
  "patch_report",
  "notes",
]);
const CANDIDATE_KEYS = new Set([
  "upstream_app_version",
  "dmg_url",
  "sha256",
  "size",
  "etag",
  "last_modified",
  "detected_at",
  "ci_status",
  "workflow_run_url",
  "patch_report_artifact",
  "wrapper_min_commit",
  "notes",
]);
const CANDIDATE_STATUSES = new Set(["pending", "passed", "failed", "manual_review"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const APP_VERSION_PATTERN = /^[0-9]+[.][0-9]+[.][0-9]+$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d{3})?Z$/u;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9._-]+$/u;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f]/u;
const PRIVATE_PATH_PATTERN = /(^|[\s"'=])(?:~[/\\]|\/(?:home|Users|var|tmp|private|run|opt|etc|root)(?:\/|\b)|[A-Za-z]:\\|\\\\|file:\/\/)/u;
const PAYLOAD_VALUE_PATTERN = /(?:[.]dmg\b|[.]app(?:\/|$)|[.]pkg[.]tar[.]zst\b|[.]deb\b|[.]rpm\b|[.]AppImage\b|[.]asar\b|codex-app(?:\/|$)|payload(?:\/|$)|extracted(?:\/|$))/iu;

function usage() {
  return "Usage: validate-upstream-dmg-lock.js <release/upstream-dmg-lock.json> [--repo-dir <path>]";
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-dir") {
      options.repoDir = argv[index + 1];
      if (!options.repoDir) {
        throw new Error(usage());
      }
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      positional.push(arg);
    }
  }
  if (!options.help && positional.length !== 1) {
    throw new Error(usage());
  }
  return { ...options, lockPath: positional[0] };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readLockFile(lockPath) {
  const raw = fs.readFileSync(lockPath, "utf8");
  const lock = JSON.parse(raw);
  if (!isPlainObject(lock)) {
    throw new Error(`Lock must be a JSON object: ${lockPath}`);
  }
  return lock;
}

function assertNoExtraKeys(object, allowedKeys, pointer, failures) {
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      failures.push(`${pointer}.${key}: unexpected field`);
    }
  }
}

function requireField(object, field, pointer, failures) {
  if (!Object.prototype.hasOwnProperty.call(object, field)) {
    failures.push(`${pointer}.${field}: required`);
    return undefined;
  }
  return object[field];
}

function requireString(object, field, pointer, failures) {
  const value = requireField(object, field, pointer, failures);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${pointer}.${field}: must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}

function validateSha256(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value !== undefined && !SHA256_PATTERN.test(value)) {
    failures.push(`${pointer}.${field}: must be a lowercase 64-character SHA256 hex digest`);
  }
}

function validateAppVersion(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value !== undefined && !APP_VERSION_PATTERN.test(value)) {
    failures.push(`${pointer}.${field}: must use the upstream app version form like 26.616.71553`);
  }
}

function validateCommit(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value !== undefined && !COMMIT_PATTERN.test(value)) {
    failures.push(`${pointer}.${field}: must be a 40-character lowercase Git commit SHA`);
  }
}

function validateSize(object, field, pointer, failures) {
  const value = requireField(object, field, pointer, failures);
  if (!Number.isSafeInteger(value) || value < 1) {
    failures.push(`${pointer}.${field}: must be a positive integer byte size`);
  }
}

function validateNullableEtag(object, field, pointer, failures) {
  const value = requireField(object, field, pointer, failures);
  if (value == null) {
    return;
  }
  if (typeof value !== "string" || value.trim() === "" || /^(unknown|no-etag)$/iu.test(value.trim())) {
    failures.push(`${pointer}.${field}: must be null or a concrete ETag string`);
  }
}

function validateNullableHttpDate(object, field, pointer, failures) {
  const value = requireField(object, field, pointer, failures);
  if (value == null) {
    return;
  }
  if (typeof value !== "string" || value.trim() === "" || Number.isNaN(Date.parse(value)) || !/GMT$/u.test(value.trim())) {
    failures.push(`${pointer}.${field}: must be null or an HTTP Last-Modified date ending in GMT`);
  }
}

function validateIsoTimestamp(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value !== undefined && (!ISO_UTC_PATTERN.test(value) || Number.isNaN(Date.parse(value)))) {
    failures.push(`${pointer}.${field}: must be an ISO UTC timestamp`);
  }
}

function validateOfficialDmgUrl(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value === undefined) {
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    failures.push(`${pointer}.${field}: must be a valid URL`);
    return;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== OFFICIAL_DMG_HOST ||
    parsed.pathname !== OFFICIAL_DMG_PATH ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    failures.push(`${pointer}.${field}: must point to the official HTTPS Codex.dmg URL`);
  }
}

function validateSafeLabel(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value !== undefined && !SAFE_LABEL_PATTERN.test(value)) {
    failures.push(`${pointer}.${field}: must contain only letters, numbers, dot, underscore, or hyphen`);
  }
}

function validateWorkflowRunUrl(object, field, pointer, failures) {
  const value = requireString(object, field, pointer, failures);
  if (value === undefined) {
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    failures.push(`${pointer}.${field}: must be a valid URL`);
    return;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !/\/actions\/runs\/[0-9]+(?:\/|$)/u.test(parsed.pathname)) {
    failures.push(`${pointer}.${field}: must be a GitHub Actions run URL`);
  }
}

function validateSafeJsonReference(value, pointer, failures) {
  if (value == null) {
    return;
  }
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${pointer}: must be null or a non-empty string`);
    return;
  }
  const trimmed = value.trim();
  if (trimmed.includes("\\") || trimmed.split("/").includes("..") || path.isAbsolute(trimmed)) {
    failures.push(`${pointer}: must be a safe relative JSON reference or HTTPS URL`);
    return;
  }
  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:") {
        failures.push(`${pointer}: must use HTTPS when it is a URL`);
      }
    } catch {
      failures.push(`${pointer}: must be a valid HTTPS URL`);
    }
    return;
  }
  if (!/[.]json$/u.test(trimmed)) {
    failures.push(`${pointer}: must reference a JSON patch report`);
  }
}

function validateCommonRecord(record, pointer, failures) {
  validateAppVersion(record, "upstream_app_version", pointer, failures);
  validateOfficialDmgUrl(record, "dmg_url", pointer, failures);
  validateSha256(record, "sha256", pointer, failures);
  validateSize(record, "size", pointer, failures);
  validateNullableEtag(record, "etag", pointer, failures);
  validateNullableHttpDate(record, "last_modified", pointer, failures);
  validateCommit(record, "wrapper_min_commit", pointer, failures);
}

function validateApproved(record, failures) {
  const pointer = "approved";
  assertNoExtraKeys(record, APPROVED_KEYS, pointer, failures);
  validateCommonRecord(record, pointer, failures);
  validateIsoTimestamp(record, "approved_at", pointer, failures);
  validateSafeLabel(record, "approved_by", pointer, failures);
  validateSafeJsonReference(requireField(record, "patch_report", pointer, failures), `${pointer}.patch_report`, failures);
  if (Object.prototype.hasOwnProperty.call(record, "notes") && typeof record.notes !== "string") {
    failures.push(`${pointer}.notes: must be a string when present`);
  }
}

function validateCandidate(record, failures) {
  const pointer = "candidate";
  assertNoExtraKeys(record, CANDIDATE_KEYS, pointer, failures);
  validateCommonRecord(record, pointer, failures);
  validateIsoTimestamp(record, "detected_at", pointer, failures);
  const status = requireString(record, "ci_status", pointer, failures);
  if (status !== undefined && !CANDIDATE_STATUSES.has(status)) {
    failures.push(`${pointer}.ci_status: must be one of ${Array.from(CANDIDATE_STATUSES).join(", ")}`);
  }
  validateWorkflowRunUrl(record, "workflow_run_url", pointer, failures);
  validateSafeJsonReference(requireField(record, "patch_report_artifact", pointer, failures), `${pointer}.patch_report_artifact`, failures);
  if (Object.prototype.hasOwnProperty.call(record, "notes") && typeof record.notes !== "string") {
    failures.push(`${pointer}.notes: must be a string when present`);
  }
}

function scanMetadataOnly(value, pointer, failures, fieldName = "") {
  if (typeof value === "string") {
    if (CONTROL_CHAR_PATTERN.test(value)) {
      failures.push(`${pointer}: must not contain control characters`);
    }
    if (PRIVATE_PATH_PATTERN.test(value)) {
      failures.push(`${pointer}: must not contain private or local filesystem paths`);
    }
    if (fieldName !== "dmg_url" && PAYLOAD_VALUE_PATTERN.test(value)) {
      failures.push(`${pointer}: must not reference DMG, app, package, or extracted payload files`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanMetadataOnly(entry, `${pointer}[${index}]`, failures));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      scanMetadataOnly(entry, `${pointer}.${key}`, failures, key);
    }
  }
}

function gitCapture(repoDir, args) {
  const result = spawnSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function gitOk(repoDir, args) {
  const result = spawnSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function validateCommitReachability(repoDir, commit, pointer, head, failures) {
  if (!COMMIT_PATTERN.test(commit)) {
    return false;
  }
  if (!gitOk(repoDir, ["cat-file", "-e", `${commit}^{commit}`])) {
    failures.push(`${pointer}: commit does not exist in ${repoDir}`);
    return false;
  }
  if (!gitOk(repoDir, ["merge-base", "--is-ancestor", commit, head])) {
    failures.push(`${pointer}: commit must be reachable from current HEAD`);
    return false;
  }
  return true;
}

function validateWrapperCommits(lock, options, failures) {
  if (options.checkGit === false) {
    return;
  }
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const head = gitCapture(repoDir, ["rev-parse", "HEAD"]);
  if (!head) {
    failures.push(`wrapper_min_commit: unable to resolve HEAD in ${repoDir}`);
    return;
  }
  const approvedCommit = lock.approved?.wrapper_min_commit;
  const candidateCommit = lock.candidate?.wrapper_min_commit;
  const approvedOk = typeof approvedCommit === "string" &&
    validateCommitReachability(repoDir, approvedCommit, "approved.wrapper_min_commit", head, failures);
  const candidateOk = typeof candidateCommit === "string" &&
    validateCommitReachability(repoDir, candidateCommit, "candidate.wrapper_min_commit", head, failures);
  if (approvedOk && candidateOk && !gitOk(repoDir, ["merge-base", "--is-ancestor", approvedCommit, candidateCommit])) {
    failures.push("candidate.wrapper_min_commit: stale wrapper minimum; it must be the approved minimum or a descendant commit");
  }
}

function validateLock(lock, options = {}) {
  const failures = [];
  if (!isPlainObject(lock)) {
    return ["lock: must be a JSON object"];
  }
  assertNoExtraKeys(lock, ROOT_KEYS, "lock", failures);
  if (lock.schema_version !== SCHEMA_VERSION) {
    failures.push(`schema_version: must be ${SCHEMA_VERSION}`);
  }
  if (!isPlainObject(lock.approved)) {
    failures.push("approved: must be an object");
  } else {
    validateApproved(lock.approved, failures);
  }
  if (!Object.prototype.hasOwnProperty.call(lock, "candidate")) {
    failures.push("candidate: required; use null when no candidate is pending");
  } else if (lock.candidate !== null) {
    if (!isPlainObject(lock.candidate)) {
      failures.push("candidate: must be null or an object");
    } else {
      validateCandidate(lock.candidate, failures);
    }
  }
  scanMetadataOnly(lock, "lock", failures);
  validateWrapperCommits(lock, options, failures);
  return failures;
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
    const lock = readLockFile(parsed.lockPath);
    const failures = validateLock(lock, { repoDir: parsed.repoDir });
    if (failures.length > 0) {
      stderr.write(`Upstream DMG lock validation failed:\n`);
      for (const failure of failures) {
        stderr.write(`- ${failure}\n`);
      }
      return 1;
    }
    stdout.write(`Upstream DMG lock validation passed: ${parsed.lockPath}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = {
  CANDIDATE_STATUSES,
  readLockFile,
  run,
  validateLock,
};
