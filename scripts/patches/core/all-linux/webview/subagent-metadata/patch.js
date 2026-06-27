"use strict";

const {
  applySubagentNicknameMetadataPatch,
} = require("../../../../webview-assets.js");

module.exports = [
  {
    id: "subagent-nickname-metadata-shape",
    phase: "webview-asset",
    order: 1050,
    ciPolicy: "required-upstream",
    pattern: /\.js$/,
    missingDescription: "app-server manager or thread context webview bundle",
    skipDescription: "subagent nickname metadata shape patch",
    apply: applySubagentNicknameMetadataPatch,
  },
];
