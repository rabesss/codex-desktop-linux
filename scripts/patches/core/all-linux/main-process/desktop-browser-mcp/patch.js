"use strict";

const {
  applyLinuxDesktopBrowserMcpDefaultsPatch,
} = require("../../../../main-process.js");

module.exports = [
  {
    id: "linux-desktop-browser-mcp-defaults",
    phase: "main-bundle",
    order: 125,
    ciPolicy: "required-upstream",
    apply: applyLinuxDesktopBrowserMcpDefaultsPatch,
  },
];
