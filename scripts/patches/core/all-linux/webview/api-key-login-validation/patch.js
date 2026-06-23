"use strict";

const {
  applyLinuxApiKeyLoginValidationPatch,
} = require("../../../../webview-assets.js");

module.exports = [
  {
    id: "linux-api-key-login-validation",
    phase: "webview-asset",
    order: 1040,
    ciPolicy: "required-upstream",
    pattern: /^app-main-.*\.js$/,
    missingDescription: "webview app main bundle",
    skipDescription: "API-key login validation patch",
    apply: applyLinuxApiKeyLoginValidationPatch,
  },
];
