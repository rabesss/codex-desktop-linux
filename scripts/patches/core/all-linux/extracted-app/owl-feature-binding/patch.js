"use strict";

const { patchLinuxOwlFeatureBindingFallbackAssets } = require("../../../../main-process.js");

module.exports = {
  id: "linux-owl-feature-binding-fallback",
  phase: "extracted-app",
  order: 190,
  ciPolicy: "required-upstream",
  apply: patchLinuxOwlFeatureBindingFallbackAssets,
};
