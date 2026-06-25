#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_EXACT_SEGMENTS = new Set([
  "codex-app",
  "app.asar.unpacked",
  "payload",
  "payloads",
]);
const FORBIDDEN_SUFFIXES = [
  ".dmg",
  ".appimage",
  ".asar",
  ".deb",
  ".rpm",
  ".pkg",
  ".pkg.tar.zst",
  ".tar",
  ".tar.gz",
  ".tar.xz",
  ".tar.zst",
  ".tgz",
  ".txz",
  ".zip",
  ".7z",
  ".gz",
  ".xz",
  ".zst",
];

function usage() {
  return "Usage: validate-no-payload-artifacts.js [--max-bytes 10485760] [--private-path /runner/private/path] <artifact-file-or-dir>...";
}

function parseArgs(argv) {
  const options = {
    maxBytes: DEFAULT_MAX_BYTES,
    paths: [],
    privatePath: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--max-bytes") {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(usage());
      }
      options.maxBytes = value;
      index += 1;
    } else if (arg === "--private-path" || arg === "--forbidden-text") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(usage());
      }
      options.privatePath.push(value);
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(usage());
    } else {
      options.paths.push(arg);
    }
  }

  if (options.paths.length === 0) {
    throw new Error(usage());
  }
  return options;
}

function splitPath(value) {
  return String(value).replace(/\\/g, "/").split("/").filter(Boolean);
}

function isForbiddenPayloadPath(value) {
  const lowerSegments = splitPath(value).map((segment) => segment.toLowerCase());
  for (const segment of lowerSegments) {
    if (FORBIDDEN_EXACT_SEGMENTS.has(segment) || segment.endsWith(".app")) {
      return true;
    }
  }

  const lower = lowerSegments.join("/");
  return FORBIDDEN_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function looksBinary(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

function normalizePrivatePaths(privatePaths) {
  return [...new Set((privatePaths ?? [])
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0))];
}

function scanForbiddenText(filePath, privatePaths) {
  if (privatePaths.length === 0) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf8");
  return privatePaths.filter((privatePath) => content.includes(privatePath));
}

function inspectNoPayloadArtifacts(targets, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const privatePaths = normalizePrivatePaths(options.privatePath);
  const violations = [];
  const files = [];

  function visit(target, root) {
    if (!fs.existsSync(target)) {
      violations.push(`${target}: path does not exist`);
      return;
    }

    const stat = fs.lstatSync(target);
    const relativePath = path.relative(root, target) || path.basename(target);

    if (isForbiddenPayloadPath(relativePath)) {
      violations.push(`${target}: artifact path looks like a redistributable payload`);
      if (stat.isDirectory()) {
        return;
      }
    }

    if (stat.isSymbolicLink()) {
      violations.push(`${target}: symbolic links are not allowed in CI metadata artifacts`);
      return;
    }

    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(target).sort()) {
        visit(path.join(target, child), root);
      }
      return;
    }

    if (!stat.isFile()) {
      violations.push(`${target}: unsupported artifact entry type`);
      return;
    }

    files.push({ path: target, size: stat.size });
    if (stat.size > maxBytes) {
      violations.push(`${target}: file is ${stat.size} bytes, above metadata artifact limit ${maxBytes}`);
    }
    if (looksBinary(target)) {
      violations.push(`${target}: binary files are not allowed in CI metadata artifacts`);
      return;
    }
    for (const privatePath of scanForbiddenText(target, privatePaths)) {
      violations.push(`${target}: contains private path ${privatePath}`);
    }
  }

  for (const target of targets) {
    const root = fs.existsSync(target) && fs.lstatSync(target).isDirectory()
      ? target
      : path.dirname(target);
    visit(target, root);
  }

  if (files.length === 0) {
    violations.push("No artifact files were found");
  }

  return {
    ok: violations.length === 0,
    files,
    violations,
  };
}

function run(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const result = inspectNoPayloadArtifacts(args.paths, {
      maxBytes: args.maxBytes,
      privatePath: args.privatePath,
    });
    if (!result.ok) {
      stderr.write("No-payload artifact validation failed:\n");
      for (const violation of result.violations) {
        stderr.write(`- ${violation}\n`);
      }
      return 1;
    }

    stdout.write(`No-payload artifact validation passed for ${result.files.length} file(s).\n`);
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
  DEFAULT_MAX_BYTES,
  inspectNoPayloadArtifacts,
  isForbiddenPayloadPath,
  parseArgs,
  run,
};
