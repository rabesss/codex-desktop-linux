"use strict";

const { patchLinuxUiFontAlias } = require("../../../../webview-assets.js");

module.exports = {
  id: "linux-ui-font-alias",
  phase: "extracted-app",
  order: 2010,
  ciPolicy: "optional",
  apply: patchLinuxUiFontAlias,
};
