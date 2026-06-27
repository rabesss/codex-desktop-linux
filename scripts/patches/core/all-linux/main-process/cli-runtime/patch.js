"use strict";

const {
  patchLinuxBundledCodexCliResolverAssets,
} = require("../../../../main-process.js");

module.exports = [
  {
    id: "linux-bundled-codex-cli-resolver",
    phase: "extracted-app",
    order: 126,
    ciPolicy: "required-upstream",
    apply: patchLinuxBundledCodexCliResolverAssets,
  },
];
