"use strict";

const { applyLinuxStatsigWorkspaceTypePatch } = require("../../../../webview-assets.js");

module.exports = [
  {
    id: "linux-statsig-workspace-type-shape",
    phase: "webview-asset",
    order: 1042,
    ciPolicy: "optional",
    pattern: /^(app-main|index)-.*\.js$/,
    missingDescription: "webview app main bundle",
    skipDescription: "Statsig workspace type compatibility patch",
    apply: applyLinuxStatsigWorkspaceTypePatch,
  },
];
