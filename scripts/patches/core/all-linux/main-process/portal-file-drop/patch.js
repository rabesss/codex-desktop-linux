"use strict";

const { applyLinuxPortalFileDropMainPatch } = require("../../../../../patches/portal-file-drop.js");

module.exports = {
  id: "linux-portal-file-drop-main",
  phase: "main-bundle",
  order: 1895,
  ciPolicy: "required-upstream",
  apply: applyLinuxPortalFileDropMainPatch,
};
