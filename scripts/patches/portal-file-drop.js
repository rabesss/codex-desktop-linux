"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CHANNEL = "codex_linux:retrieve-portal-files";

function applyLinuxPortalFileDropPreloadPatch(source) {
  if (source.includes("codexLinuxRetrievePortalFiles")) {
    return source;
  }

  const needle = "getPathForFile:t=>e.webUtils.getPathForFile(t)||null,";
  const patch =
    "getPathForFile:t=>e.webUtils.getPathForFile(t)||null,codexLinuxRetrievePortalFiles:async t=>e.ipcRenderer.invoke(`codex_linux:retrieve-portal-files`,t),";
  if (!source.includes(needle)) {
    console.warn("WARN: Could not find preload file-path bridge — skipping Linux portal file-drop preload patch");
    return source;
  }

  return source.replace(needle, patch);
}

function applyLinuxPortalFileDropMainPatch(source) {
  if (source.includes("codexLinuxRetrievePortalFiles(")) {
    return source;
  }

  const helperNeedle = "function tu(e){return`codex_desktop:worker:${e}:for-view`}var nu=";
  const helperPatch =
    "function tu(e){return`codex_desktop:worker:${e}:for-view`}function codexLinuxPortalFileDescriptor(e){if(typeof e!==`string`)return null;let t=e.trim();if(!t.startsWith(`/`))return null;let n=t.split(`/`).filter(Boolean).pop()||t;return{label:n,path:t,fsPath:t}}function codexLinuxParsePortalFileOutput(e){let t=[],n=new Set,r=/'((?:[^'\\\\]|\\\\.)*)'/gu,i;for(;(i=r.exec(String(e)))!=null;){let e=i[1].replace(/\\\\'/g,`'`).replace(/\\\\\\\\/g,`\\\\`),r=codexLinuxPortalFileDescriptor(e);r&&!n.has(r.fsPath)&&(n.add(r.fsPath),t.push(r))}return t}async function codexLinuxRetrievePortalFiles(e){if(process.platform!==`linux`||typeof e!==`string`)return[];let t=e.trim();if(!t||t.length>4096||t.includes(`\\0`))return[];return await new Promise(e=>{f.execFile(`gdbus`,[`call`,`--session`,`--dest`,`org.freedesktop.portal.Documents`,`--object-path`,`/org/freedesktop/portal/documents`,`--method`,`org.freedesktop.portal.FileTransfer.RetrieveFiles`,t,`{}`],{encoding:`utf8`,timeout:3e3,maxBuffer:1048576},(t,n)=>{t?e([]):e(codexLinuxParsePortalFileOutput(n))})})}var codexLinuxPortalFileDropChannel=`codex_linux:retrieve-portal-files`;function codexLinuxRegisterPortalFileDropHandler(e,t){try{e.handle(codexLinuxPortalFileDropChannel,async(e,n)=>t(e)?await codexLinuxRetrievePortalFiles(n):[])}catch{}}var nu=";
  if (!source.includes(helperNeedle)) {
    console.warn("WARN: Could not find main-process portal helper insertion point — skipping Linux portal file-drop main patch");
    return source;
  }
  let patched = source.replace(helperNeedle, helperPatch);

  const handlerNeedle = "U2(l,k),z2(k);let A=!1;";
  const handlerPatch = "U2(l,k),z2(k),codexLinuxRegisterPortalFileDropHandler(a.ipcMain,k);let A=!1;";
  if (!patched.includes(handlerNeedle)) {
    console.warn("WARN: Could not find trusted IPC setup — skipping Linux portal file-drop main patch");
    return source;
  }

  return patched.replace(handlerNeedle, handlerPatch);
}

function patchLinuxPortalFileDropPreload(extractedDir) {
  const preload = path.join(extractedDir, ".vite", "build", "preload.js");
  if (!fs.existsSync(preload)) {
    console.warn(
      `WARN: Could not find preload bundle in ${path.dirname(preload)} — skipping Linux portal file-drop preload patch`,
    );
    return { matched: 0, changed: 0 };
  }

  const source = fs.readFileSync(preload, "utf8");
  const patched = applyLinuxPortalFileDropPreloadPatch(source);
  if (patched !== source) {
    fs.writeFileSync(preload, patched, "utf8");
    return { matched: 1, changed: 1 };
  }
  return { matched: 1, changed: 0 };
}

module.exports = {
  CHANNEL,
  applyLinuxPortalFileDropMainPatch,
  applyLinuxPortalFileDropPreloadPatch,
  patchLinuxPortalFileDropPreload,
};
