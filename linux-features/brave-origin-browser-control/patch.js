"use strict";

function warn(message) {
  console.warn(`WARN: ${message} - skipping Brave Origin browser-control settings patch`);
}

function applyBraveOriginChromeExtensionStatusPatch(source) {
  let patched = source;

  if (!patched.includes("`Brave-Origin-Nightly`")) {
    patched = patched.replace(
      /(\(0,([A-Za-z_$][\w$]*)\.join\)\(([A-Za-z_$][\w$]*),`\.config`,`BraveSoftware`,`Brave-Browser`\))/g,
      "(0,$2.join)($3,`.config`,`BraveSoftware`,`Brave-Origin-Nightly`),$1",
    );
  }

  if (!patched.includes("`brave-origin-nightly`")) {
    patched = patched.replace(
      /`brave-browser`,`brave`/g,
      "`brave-origin-nightly`,`brave-browser`,`brave`",
    );
  }

  patched = patched.replace(
    /Google Chrome, Brave, or Chromium is not installed/g,
    "Brave Origin Nightly, Google Chrome, Brave, or Chromium is not installed",
  );

  if (
    patched === source &&
    source.includes("codexLinuxChromeProfileRoots") &&
    !source.includes("Brave-Origin-Nightly")
  ) {
    warn("Could not find Linux Chrome extension status helper shape");
  }
  return patched;
}

module.exports = {
  patches: [
    {
      id: "chrome-extension-status",
      phase: "main-bundle",
      order: 20500,
      ciPolicy: "optional",
      apply: applyBraveOriginChromeExtensionStatusPatch,
    },
  ],
  applyBraveOriginChromeExtensionStatusPatch,
};
