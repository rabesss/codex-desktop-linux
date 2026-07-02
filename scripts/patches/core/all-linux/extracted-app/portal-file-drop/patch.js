"use strict";

const { patchStatusFromChange } = require("../../../../../lib/patch-report.js");
const { patchLinuxPortalFileDropPreload } = require("../../../../../patches/portal-file-drop.js");

module.exports = {
  id: "linux-portal-file-drop-preload",
  phase: "extracted-app",
  order: 2010,
  ciPolicy: "required-upstream",
  apply: patchLinuxPortalFileDropPreload,
  status: (result, warnings) => {
    if (result?.matched === 0) {
      return {
        status: "failed-required",
        reason: warnings[0] ?? "no matching preload bundle found",
      };
    }
    return {
      status: patchStatusFromChange((result?.changed ?? 0) > 0, warnings),
      reason: warnings[0] ?? null,
    };
  },
};
