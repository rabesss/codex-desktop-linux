#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ARTIFACT_NAME = "upstream-dmg-candidate-metadata";
const NULL_MARKERS = new Set(["", "unknown", "no-etag", "null"]);
const APP_VERSION_PATTERN = /^[0-9]+[.][0-9]+[.][0-9]+$/u;

function usage() {
  return [
    "Usage: write-upstream-candidate-report.js",
    "--metadata upstream-dmg-metadata.json",
    "--patch-report patch-report.json",
    "--candidate upstream-dmg-candidate.json",
    "--issue-body upstream-dmg-candidate-issue.md",
    "--summary upstream-dmg-candidate-summary.md",
    "[--metadata-out upstream-dmg-metadata.json]",
    "[--patch-report-out patch-report.json]",
    "[--artifact-name upstream-dmg-candidate-metadata]",
    "[--github-output $GITHUB_OUTPUT]",
    "[--private-path /runner/private/path]",
  ].join(" ");
}

function parseArgs(argv) {
  const options = {
    artifactName: DEFAULT_ARTIFACT_NAME,
    githubOutput: null,
    privatePath: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (!arg.startsWith("--")) {
      throw new Error(usage());
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(usage());
    }
    if (key === "privatePath") {
      options.privatePath.push(value);
    } else {
      options[key] = value;
    }
    index += 1;
  }

  for (const key of ["metadata", "patchReport", "candidate", "issueBody", "summary"]) {
    if (!options[key]) {
      throw new Error(usage());
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeNullable(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return NULL_MARKERS.has(text.toLowerCase()) ? null : text;
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function validateMetadata(metadata) {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Upstream DMG metadata must be an object");
  }
  if (typeof metadata.url !== "string" || !/^https:\/\//.test(metadata.url)) {
    throw new Error("Upstream DMG metadata url must be an https URL");
  }
  if (typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
    throw new Error("Upstream DMG metadata sha256 must be a 64-character hex digest");
  }
  if (typeof metadata.upstream_app_version !== "string" || !APP_VERSION_PATTERN.test(metadata.upstream_app_version)) {
    throw new Error("Upstream DMG metadata upstream_app_version must use the upstream app version form like 26.616.71553");
  }

  return {
    upstream_app_version: metadata.upstream_app_version,
    url: metadata.url,
    sha256: metadata.sha256.toLowerCase(),
    size_bytes: parsePositiveInteger(metadata.size_bytes, "Upstream DMG metadata size_bytes"),
    etag: normalizeNullable(metadata.etag),
    last_modified: normalizeNullable(metadata.last_modified),
    content_length: normalizeNullable(metadata.content_length),
    cache_schema_version: normalizeNullable(metadata.cache_schema_version),
    tested_at_utc: normalizeNullable(metadata.tested_at_utc),
  };
}

function validatePatchReport(report) {
  if (report == null || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Patch report must be an object");
  }
  if (!Array.isArray(report.patches)) {
    throw new Error("Patch report must contain a patches array");
  }
  for (const patch of report.patches) {
    if (patch == null || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("Patch report patches must be objects");
    }
    if (typeof patch.name !== "string" || patch.name.length === 0) {
      throw new Error("Patch report patch entries must include a name");
    }
    if (typeof patch.status !== "string" || patch.status.length === 0) {
      throw new Error("Patch report patch entries must include a status");
    }
  }
}

function normalizePrivatePaths(privatePaths) {
  return [...new Set((privatePaths ?? [])
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0))]
    .sort((left, right) => right.length - left.length);
}

function redactPrivatePaths(value, privatePaths) {
  const normalizedPaths = normalizePrivatePaths(privatePaths);
  if (typeof value === "string") {
    let redacted = value;
    for (const privatePath of normalizedPaths) {
      redacted = redacted.split(privatePath).join("[redacted-path]");
    }
    return redacted;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPrivatePaths(item, normalizedPaths));
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactPrivatePaths(item, normalizedPaths)]),
    );
  }
  return value;
}

function sanitizePatchReport(report, privatePaths = []) {
  validatePatchReport(report);
  return redactPrivatePaths(report, privatePaths);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function summarizePatchReport(report) {
  const byStatus = {};
  for (const patch of report.patches) {
    byStatus[patch.status] = (byStatus[patch.status] ?? 0) + 1;
  }
  return {
    total: report.patches.length,
    by_status: Object.fromEntries(Object.entries(byStatus).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function workflowContext(env = process.env) {
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : null;

  return {
    repository: env.GITHUB_REPOSITORY || null,
    event_name: env.GITHUB_EVENT_NAME || null,
    ref: env.GITHUB_REF || null,
    sha: env.GITHUB_SHA || null,
    run_id: env.GITHUB_RUN_ID || null,
    run_number: env.GITHUB_RUN_NUMBER || null,
    run_attempt: env.GITHUB_RUN_ATTEMPT || null,
    run_url: runUrl,
  };
}

function issueTitleFor(candidate) {
  return `Upstream Codex DMG candidate ${candidate.upstream.sha256.slice(0, 12)}`;
}

function buildCandidateManifest({ metadata, patchReport, patchReportPath, artifactName, env = process.env }) {
  const upstream = validateMetadata(metadata);
  validatePatchReport(patchReport);
  const validatedAt = upstream.tested_at_utc ?? new Date().toISOString();
  const patchSummary = summarizePatchReport(patchReport);

  return {
    schema_version: 1,
    kind: "upstream-dmg-candidate",
    generated_at: validatedAt,
    upstream,
    validation: {
      status: "passed",
      validated_at: validatedAt,
      required_patch_profile: "upstream-build",
      patch_report_artifact: "patch-report.json",
      patch_report_sha256: sha256File(patchReportPath),
      patch_summary: patchSummary,
    },
    workflow: workflowContext(env),
    artifacts: {
      artifact_name: artifactName || DEFAULT_ARTIFACT_NAME,
      files: [
        "upstream-dmg-metadata.json",
        "patch-report.json",
        "upstream-dmg-candidate.json",
        "upstream-dmg-candidate-issue.md",
        "upstream-dmg-candidate-summary.md",
      ],
      payload_policy: "metadata-and-reports-only",
    },
    promotion: {
      state: "candidate",
      issue_title: null,
      requires_manual_review: true,
      next_step: "Promote only by updating the approved upstream DMG lock in a separate reviewed change after local dogfood.",
    },
  };
}

function markdownValue(value) {
  if (value == null || value === "") {
    return "n/a";
  }
  return String(value).replace(/\|/g, "\\|");
}

function renderPatchStatus(summary) {
  return Object.entries(summary.by_status)
    .map(([status, count]) => `\`${status}\`: ${count}`)
    .join(", ");
}

function buildIssueBody(candidate) {
  return [
    "## Upstream Codex DMG Candidate",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| DMG URL | \`${markdownValue(candidate.upstream.url)}\` |`,
    `| App version | \`${candidate.upstream.upstream_app_version}\` |`,
    `| SHA-256 | \`${candidate.upstream.sha256}\` |`,
    `| Size | \`${candidate.upstream.size_bytes}\` bytes |`,
    `| Last-Modified | \`${markdownValue(candidate.upstream.last_modified)}\` |`,
    `| ETag | \`${markdownValue(candidate.upstream.etag)}\` |`,
    `| Validated at | \`${candidate.validation.validated_at}\` |`,
    `| Workflow run | ${candidate.workflow.run_url ? `[${candidate.workflow.run_id}](${candidate.workflow.run_url})` : "n/a"} |`,
    `| Artifact | \`${candidate.artifacts.artifact_name}\` |`,
    "",
    "## Patch Validation",
    "",
    `- Required patch profile: \`${candidate.validation.required_patch_profile}\``,
    `- Patch report SHA-256: \`${candidate.validation.patch_report_sha256}\``,
    `- Patch statuses: ${renderPatchStatus(candidate.validation.patch_summary) || "none"}`,
    "",
    "## Manual Dogfood Checklist",
    "",
    "- [ ] Download the official upstream DMG from the URL above.",
    "- [ ] Verify the local DMG SHA-256 matches this candidate.",
    "- [ ] Rebuild the Linux app/package locally from the verified DMG.",
    "- [ ] Run workstation smoke checks against the rebuilt app/package.",
    "- [ ] Confirm no public artifact contains a DMG, extracted app, `codex-app`, or native package payload.",
    "- [ ] Promote only through a reviewed approved-lock update after dogfood passes.",
    "",
    "## No-Payload Boundary",
    "",
    "This CI record is metadata only. It is not an approval, does not upload the upstream DMG, and does not redistribute extracted OpenAI app or rebuilt package payloads.",
    "",
  ].join("\n");
}

function buildSummary(candidate) {
  return [
    "## Upstream DMG Candidate",
    "",
    `- Candidate SHA-256: \`${candidate.upstream.sha256}\``,
    `- Candidate app version: \`${candidate.upstream.upstream_app_version}\``,
    `- Candidate size: \`${candidate.upstream.size_bytes}\` bytes`,
    `- Candidate artifact: \`${candidate.artifacts.artifact_name}\``,
    `- Patch statuses: ${renderPatchStatus(candidate.validation.patch_summary) || "none"}`,
    "- Public artifact policy: metadata and reports only; no DMG, extracted app, or package payload.",
    "",
  ].join("\n");
}

function sanitizedMetadataForArtifact(metadata) {
  const upstream = validateMetadata(metadata);
  return {
    schema_version: 1,
    kind: "upstream-dmg-metadata",
    ...upstream,
  };
}

function appendGitHubOutput(filePath, outputs) {
  if (!filePath) {
    return;
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, " ")}`);
  fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function run(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;

  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const metadata = readJson(args.metadata);
    const rawPatchReport = readJson(args.patchReport);
    const patchReport = sanitizePatchReport(rawPatchReport, args.privatePath);
    const metadataForArtifact = sanitizedMetadataForArtifact(metadata);
    const patchReportForCandidate = args.patchReportOut || args.patchReport;
    if (args.metadataOut) {
      writeJson(args.metadataOut, metadataForArtifact);
    }
    if (args.patchReportOut) {
      writeJson(args.patchReportOut, patchReport);
    }
    const candidate = buildCandidateManifest({
      metadata,
      patchReport,
      patchReportPath: patchReportForCandidate,
      artifactName: args.artifactName,
      env,
    });
    candidate.promotion.issue_title = issueTitleFor(candidate);

    writeJson(args.candidate, candidate);
    writeText(args.issueBody, buildIssueBody(candidate));
    writeText(args.summary, buildSummary(candidate));
    appendGitHubOutput(args.githubOutput, {
      issue_title: candidate.promotion.issue_title,
      candidate_sha256: candidate.upstream.sha256,
      candidate_sha_short: candidate.upstream.sha256.slice(0, 12),
      candidate_manifest: args.candidate,
      candidate_issue_body: args.issueBody,
      candidate_summary: args.summary,
    });

    stdout.write(`Wrote upstream candidate manifest: ${args.candidate}\n`);
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
  DEFAULT_ARTIFACT_NAME,
  buildCandidateManifest,
  buildIssueBody,
  buildSummary,
  issueTitleFor,
  parseArgs,
  redactPrivatePaths,
  run,
  sanitizePatchReport,
  sanitizedMetadataForArtifact,
  summarizePatchReport,
  validateMetadata,
};
