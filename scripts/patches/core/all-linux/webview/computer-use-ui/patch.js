"use strict";

const {
  applyLinuxComputerUseDetailRouteFallbackPatch,
  applyLinuxComputerUseRendererAvailabilityPatch,
  applyLinuxComputerUseInstallFlowPatch,
} = require("../../../../computer-use.js");

module.exports = [
  {
    id: "linux-computer-use-ui-availability",
    phase: "webview-asset",
    order: 1100,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^(?:(?:app-initial~app-main~.*plug.*|app-initial~app-main~remote-conversation-page~pull-requests-page~onboarding-page~hotkey-win~.*)|(?:use-model-settings|apps|use-in-app-browser-use-availability|use-is-plugins-enabled|use-native-apps\.electron)-.*)\.js$/,
    missingDescription: "Computer Use availability bundle",
    skipDescription: "Linux Computer Use UI availability patch",
    apply: applyLinuxComputerUseRendererAvailabilityPatch,
  },
  {
    id: "linux-computer-use-install-flow",
    phase: "webview-asset",
    order: 1110,
    ciPolicy: "opt-in",
    enabled: (context) => context.enableComputerUseUi,
    pattern: /^(?:(?:app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~plug~.*)|(?:use-plugin-install-flow|plugins-availability)-.*)\.js$/,
    missingDescription: "plugin install flow bundle",
    skipDescription: "Linux Computer Use install flow patch",
    apply: applyLinuxComputerUseInstallFlowPatch,
  },
  {
    id: "linux-computer-use-detail-route-fallback",
    phase: "webview-asset",
    order: 1120,
    ciPolicy: "opt-in",
    pattern: /^(app-initial~app-main~.*plug.*|plugin-detail-page)-.*\.js$/,
    missingDescription: "plugin detail route bundle",
    skipDescription: "Linux Computer Use detail route fallback patch",
    apply: applyLinuxComputerUseDetailRouteFallbackPatch,
  },
];
