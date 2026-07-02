"use strict";

const {
  applyLinuxComposerFileDropPatch,
} = require("../../../../webview-assets.js");

module.exports = [
  {
    id: "linux-composer-file-drop",
    phase: "webview-asset",
    order: 1065,
    ciPolicy: "optional",
    pattern: /^app-initial~app-main~remote-conversation-page~new-thread-panel-page~appgen-library-page~hot~.*\.js$/,
    missingDescription: "composer attachment bundle",
    skipDescription: "Linux composer file drop patch",
    apply: applyLinuxComposerFileDropPatch,
  },
];
