"use strict";

const {
  CLOSE_GATE_PREFIX_LOOKBACK,
  HANDLER_PREFIX_LOOKBACK,
  escapeRegExp,
  findDisposableVar,
  findLastRegexMatch,
  findLinuxGlobalStateExpression,
  findMatchingBrace,
  inferModuleAlias,
  linuxSettingsKeys,
} = require("./shared.js");

// Launch-action patches keep second launches, hotkey windows, and persisted
// Linux settings coordinated with the generated launcher.
const linuxQuitStateHelpers =
  "let codexLinuxQuitInProgress=!1,codexLinuxExplicitQuitApproved=!1,codexLinuxMarkQuitInProgress=()=>{codexLinuxQuitInProgress=!0},codexLinuxPrepareForExplicitQuit=()=>{codexLinuxExplicitQuitApproved=!0,codexLinuxMarkQuitInProgress()},codexLinuxShouldBypassQuitPrompt=()=>codexLinuxExplicitQuitApproved===!0,codexLinuxIsQuitInProgress=()=>codexLinuxQuitInProgress===!0,";

function persistedLinuxSettingsKeysSource() {
  return `[${Object.values(linuxSettingsKeys).map((key) => `\`${key}\``).join(",")}]`;
}

function applyLinuxSettingsPersistencePatch(currentSource) {
  let patchedSource = currentSource;

  if (
    !patchedSource.includes('"set-global-state"') &&
    !patchedSource.includes(".codex-global-state.json")
  ) {
    return patchedSource;
  }

  if (!patchedSource.includes("function codexLinuxPersistSettingsState(")) {
    const pathVar = inferModuleAlias(patchedSource, "node:path");
    const fsVar = inferModuleAlias(patchedSource, "node:fs");
    const stateFileHelperSource =
      (stateFileVar) =>
        `${stateFileVar == null ? "" : `var ${stateFileVar}=\`.codex-global-state.json\`;`}function codexLinuxSettingsAppId(){let e=process.env.CODEX_LINUX_APP_ID||process.env.CODEX_APP_ID||\`codex-desktop\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`codex-desktop\`}function codexLinuxSettingsPath(){let e=process.env.CODEX_LINUX_SETTINGS_FILE;if(typeof e===\`string\`&&e.length>0)return e;let t=process.env.XDG_CONFIG_HOME||process.env.HOME&&${pathVar}.join(process.env.HOME,\`.config\`);return t?${pathVar}.join(t,codexLinuxSettingsAppId(),\`settings.json\`):null}function codexLinuxReadSettingsFile(){let e=codexLinuxSettingsPath();if(!e||!${fsVar}.existsSync(e))return{};try{let t=${fsVar}.readFileSync(e,\`utf8\`),n=JSON.parse(t);return n&&typeof n===\`object\`&&!Array.isArray(n)?n:{}}catch(e){return{}}}function codexLinuxPersistSettingsState(e,t){if(process.platform!==\`linux\`||!${persistedLinuxSettingsKeysSource()}.includes(e))return;try{let n=codexLinuxSettingsPath();if(!n)return;let r=codexLinuxReadSettingsFile();t===void 0?delete r[e]:r[e]=t,${fsVar}.mkdirSync(${pathVar}.dirname(n),{recursive:!0,mode:448}),${fsVar}.writeFileSync(n,JSON.stringify(r,null,2)+\`\\n\`,\`utf8\`)}catch(e){}}`;
    const stateFileCommaRegex = /var ([A-Za-z_$][\w$]*)=`\.codex-global-state\.json`,/;
    const stateFileSemicolonRegex = /var ([A-Za-z_$][\w$]*)=`\.codex-global-state\.json`;/;
    if (pathVar == null || fsVar == null) {
      console.warn("WARN: Could not find Linux settings state file marker — skipping settings persistence patch");
      return patchedSource;
    }
    if (stateFileCommaRegex.test(patchedSource)) {
      patchedSource = patchedSource.replace(
        stateFileCommaRegex,
        (_match, stateFileVar) => `${stateFileHelperSource(stateFileVar)}var `,
      );
    } else if (stateFileSemicolonRegex.test(patchedSource)) {
      patchedSource = patchedSource.replace(
        stateFileSemicolonRegex,
        (_match, stateFileVar) => stateFileHelperSource(stateFileVar),
      );
    } else {
      const strictDirective = '"use strict";';
      const helperInsertionIndex = patchedSource.startsWith(strictDirective)
        ? strictDirective.length
        : 0;
      patchedSource =
        patchedSource.slice(0, helperInsertionIndex) +
        stateFileHelperSource(null) +
        patchedSource.slice(helperInsertionIndex);
    }
  } else if (!patchedSource.includes("function codexLinuxSettingsAppId()")) {
    const legacySettingsPathRegex =
      /function codexLinuxSettingsPath\(\)\{let ([A-Za-z_$][\w$]*)=process\.env\.XDG_CONFIG_HOME\|\|process\.env\.HOME&&([A-Za-z_$][\w$]*)\.join\(process\.env\.HOME,`\.config`\);return \1\?\2\.join\(\1,`codex-desktop`,`settings\.json`\):null\}/;
    patchedSource = patchedSource.replace(
      legacySettingsPathRegex,
      (_match, _configVar, pathVar) =>
        `function codexLinuxSettingsAppId(){let e=process.env.CODEX_LINUX_APP_ID||process.env.CODEX_APP_ID||\`codex-desktop\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`codex-desktop\`}function codexLinuxSettingsPath(){let e=process.env.CODEX_LINUX_SETTINGS_FILE;if(typeof e===\`string\`&&e.length>0)return e;let t=process.env.XDG_CONFIG_HOME||process.env.HOME&&${pathVar}.join(process.env.HOME,\`.config\`);return t?${pathVar}.join(t,codexLinuxSettingsAppId(),\`settings.json\`):null}`,
    );
  }

  const settingsKeysGuard = `!${persistedLinuxSettingsKeysSource()}.includes(e)`;
  if (!patchedSource.includes(settingsKeysGuard)) {
    const oldSettingsKeysGuardRegex = /!\[[^\]]*`codex-linux-[^`]+`[^\]]*\]\.includes\(e\)/;
    patchedSource = patchedSource.replace(oldSettingsKeysGuardRegex, settingsKeysGuard);
  }

  if (/"set-global-state":async\(\{key:[A-Za-z_$][\w$]*,value:[A-Za-z_$][\w$]*,origin:[A-Za-z_$][\w$]*\}\)=>\([\s\S]{0,300}?codexLinuxPersistSettingsState\(/.test(patchedSource)) {
    return patchedSource;
  }
  if (/"set-global-state":async\(\{key:[A-Za-z_$][\w$]*,value:[A-Za-z_$][\w$]*,origin:[A-Za-z_$][\w$]*\}\)=>\(this\.setGlobalStateValue\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\),codexLinuxPersistSettingsState\(/.test(patchedSource)) {
    return patchedSource;
  }
  const setGlobalStateRegex =
    /"set-global-state":async\(\{key:([A-Za-z_$][\w$]*),value:([A-Za-z_$][\w$]*),origin:([A-Za-z_$][\w$]*)\}\)=>\((this\.(?:globalState\.set\(\1,\2\)|setGlobalStateValue\(\1,\2,\3\))),/;
  if (!setGlobalStateRegex.test(patchedSource)) {
    console.warn("WARN: Could not find Linux set-global-state needle — skipping settings persistence hook");
    return patchedSource;
  }

  return patchedSource.replace(
    setGlobalStateRegex,
    (_match, keyVar, valueVar, originVar, setterCall) =>
      `"set-global-state":async({key:${keyVar},value:${valueVar},origin:${originVar}})=>(${setterCall},codexLinuxPersistSettingsState(${keyVar},${valueVar}),`,
  );
}

const desktopReadinessHandlerName = "linux-desktop-readiness";
const desktopBuildInfoHandlerName = "linux-build-info";

function desktopReadinessHelperSource() {
  return [
    `function codexLinuxDesktopReadinessAppId(){let e=process.env.CODEX_LINUX_PACKAGE_NAME||process.env.CODEX_LINUX_APP_ID||process.env.CODEX_APP_ID||\`codex-desktop\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`codex-desktop\`}`,
    `function codexLinuxDesktopReadinessCommands(){let e=process.env.CODEX_DESKTOP_DOCTOR_PATH;if(typeof e===\`string\`&&e.trim().length>0)return[e.trim()];let t=codexLinuxDesktopReadinessAppId(),n=[\`/usr/bin/\${t}-doctor\`,\`\${t}-doctor\`];return t===\`codex-desktop\`?n:[...n,\`/usr/bin/codex-desktop-doctor\`,\`codex-desktop-doctor\`]}`,
    `function codexLinuxDesktopReadinessShort(e){let t=String(e||\`\`);return t.length>4e3?t.slice(0,4e3):t}`,
    `function codexLinuxDesktopReadinessSummary(e){let t=e?.readiness;if(t&&Array.isArray(t.blockers)&&t.blockers.length>0)return\`\${t.blockers.length} readiness blocker\${t.blockers.length===1?\`\`:\`s\`}\`;if(t&&Array.isArray(t.warnings)&&t.warnings.length>0)return\`\${t.warnings.length} warning\${t.warnings.length===1?\`\`:\`s\`}\`;if(t?.ready===!0)return\`All readiness checks passed\`;let n=e?.summary;if(n&&typeof n===\`object\`){let e=Number(n.fail||0),t=Number(n.warn||0);if(e>0)return\`\${e} failed check\${e===1?\`\`:\`s\`}\`;if(t>0)return\`\${t} warning\${t===1?\`\`:\`s\`}\`}return\`Readiness report available\`}`,
    `function codexLinuxDesktopReadiness(){if(process.platform!==\`linux\`)return{ok:!1,status:\`info\`,summary:\`Linux readiness is only available on Linux\`,checks:[]};let e=codexLinuxDesktopReadinessCommands(),t=require(\`node:child_process\`);for(let n of e)try{let r=t.spawnSync(n,[\`--json\`],{encoding:\`utf8\`,timeout:15e3,maxBuffer:4194304,env:process.env});if(r.error){if(r.error.code===\`ENOENT\`)continue;return{ok:!1,status:\`fail\`,summary:r.error.message||String(r.error),command:n,error:r.error.code||\`spawn-error\`}}let i=String(r.stdout||\`\`).trim(),a=null;try{a=i?JSON.parse(i):null}catch{}if(a&&typeof a===\`object\`&&!Array.isArray(a)){let e=a.readiness?.ready===!0;return{ok:e,status:e?\`pass\`:\`fail\`,summary:codexLinuxDesktopReadinessSummary(a),command:n,exitCode:r.status??null,report:a,stderr:codexLinuxDesktopReadinessShort(r.stderr)}}return{ok:!1,status:\`fail\`,summary:\`Doctor did not return JSON\`,command:n,exitCode:r.status??null,stdout:codexLinuxDesktopReadinessShort(i),stderr:codexLinuxDesktopReadinessShort(r.stderr)}}catch(r){return{ok:!1,status:\`fail\`,summary:r instanceof Error?r.message:String(r),command:n}}return{ok:!1,status:\`warn\`,summary:\`Installed doctor command was not found\`,commands:e}}`,
  ].join("");
}

function desktopReadinessHandlerSource() {
  return `"${desktopReadinessHandlerName}":async()=>{${desktopReadinessHelperSource()}return codexLinuxDesktopReadiness()}`;
}

function desktopBuildInfoHandlerSource() {
  return `"${desktopBuildInfoHandlerName}":async()=>{function codexLinuxBuildInfoShort(e){let t=String(e||\`\`);return t.length>4e3?t.slice(0,4e3):t}function codexLinuxBuildInfoCandidates(){let e=[],t=process.env.CODEX_LINUX_BUILD_INFO_PATH;if(typeof t===\`string\`&&t.trim().length>0)e.push(t.trim());let n=process.env.CODEX_ELECTRON_RESOURCES_PATH||process.resourcesPath;if(typeof n===\`string\`&&n.length>0){let t=require(\`node:path\`);e.push(t.join(n,\`codex-linux-build-info.json\`));e.push(t.join(t.dirname(n),\`.codex-linux\`,\`build-info.json\`))}return Array.from(new Set(e))}function codexLinuxBuildInfoRead(){if(process.platform!==\`linux\`)return{ok:!1,status:\`info\`,summary:\`Linux build metadata is only available on Linux\`,enabledFeatures:[]};let e=require(\`node:fs\`);for(let t of codexLinuxBuildInfoCandidates())try{if(!e.existsSync(t))continue;let n=JSON.parse(e.readFileSync(t,\`utf8\`)),r=Array.isArray(n?.linuxFeatures?.enabled)?n.linuxFeatures.enabled.filter(e=>typeof e===\`string\`):[];return{ok:!0,status:\`pass\`,summary:\`\${r.length} enabled Linux feature\${r.length===1?\`\`:\`s\`}\`,path:t,appIdentity:n?.appIdentity??null,upstreamAppVersion:n?.upstreamDmg?.appVersion??null,electronVersion:n?.electronVersion??null,linuxTarget:n?.linuxTarget?.summary??null,packageProfile:n?.packageProfile??null,source:n?.source?{branch:n.source.branch??null,commit:n.source.commit??null,shortCommit:n.source.shortCommit??null,dirty:n.source.dirty===!0}:null,enabledFeatures:r}}catch(n){return{ok:!1,status:\`fail\`,summary:n instanceof Error?n.message:String(n),path:t,error:\`read-failed\`,stderr:codexLinuxBuildInfoShort(n?.stack)}}return{ok:!1,status:\`warn\`,summary:\`Linux build metadata was not found\`,paths:codexLinuxBuildInfoCandidates(),enabledFeatures:[]}}return codexLinuxBuildInfoRead()}`;
}

function replaceHandlerSource(currentSource, handlerName, handlerSource) {
  const handlerRegex = new RegExp(`"${escapeRegExp(handlerName)}":async\\(\\)=>[A-Za-z_$][\\w$]*\\(\\)`);
  if (handlerRegex.test(currentSource)) {
    return currentSource.replace(handlerRegex, handlerSource);
  }

  if (currentSource.includes(`"${handlerName}":async()=>{`)) {
    return currentSource;
  }

  return null;
}

function applyLinuxDesktopReadinessHandlerPatch(currentSource) {
  const handlerNeedle = `"set-global-state":`;
  let patchedSource = currentSource;
  let changed = false;

  const readinessHandler = desktopReadinessHandlerSource();
  const migratedReadiness = replaceHandlerSource(patchedSource, desktopReadinessHandlerName, readinessHandler);
  if (migratedReadiness != null) {
    changed = migratedReadiness !== patchedSource;
    patchedSource = migratedReadiness;
  }

  const buildInfoHandler = desktopBuildInfoHandlerSource();
  const migratedBuildInfo = replaceHandlerSource(patchedSource, desktopBuildInfoHandlerName, buildInfoHandler);
  if (migratedBuildInfo != null) {
    changed = changed || migratedBuildInfo !== patchedSource;
    patchedSource = migratedBuildInfo;
  }

  const missingReadiness = !patchedSource.includes(`"${desktopReadinessHandlerName}"`);
  const missingBuildInfo = !patchedSource.includes(`"${desktopBuildInfoHandlerName}"`);
  if (!missingReadiness && !missingBuildInfo) {
    return patchedSource;
  }

  if (!patchedSource.includes(handlerNeedle)) {
    console.warn("WARN: Could not find Linux desktop readiness handler map needle — skipping readiness handler patch");
    return changed ? patchedSource : currentSource;
  }

  const additions = [
    missingReadiness ? readinessHandler : null,
    missingBuildInfo ? buildInfoHandler : null,
  ].filter(Boolean).join(",");
  return patchedSource.replace(
    handlerNeedle,
    `${additions},${handlerNeedle}`,
  );
}

function applyLinuxTrayCloseSettingPatch(currentSource) {
  let patchedSource = currentSource;

  const patchedCloseGateRegex = new RegExp(
    `canHideLastLocalWindowToTray:\\(\\)=>[A-Za-z_$][\\w$]*&&\\(process\\.platform!==\`linux\`\\|\\|[^,{}]+\\.get\\(\`${escapeRegExp(linuxSettingsKeys.systemTray)}\`\\)!==!1\\),disposables:[A-Za-z_$][\\w$]*`,
  );
  if (patchedCloseGateRegex.test(patchedSource)) {
    return patchedSource;
  }

  const closeGateRegex =
    /canHideLastLocalWindowToTray:\(\)=>([A-Za-z_$][\w$]*),disposables:([A-Za-z_$][\w$]*)/;
  const closeGateMatch = patchedSource.match(closeGateRegex);
  if (closeGateMatch != null) {
    const [, trayReadyVar, disposableVar] = closeGateMatch;
    const prefix = patchedSource.slice(
      Math.max(0, closeGateMatch.index - CLOSE_GATE_PREFIX_LOOKBACK),
      closeGateMatch.index,
    );
    const globalStateExpr = findLinuxGlobalStateExpression(prefix);
    if (globalStateExpr != null) {
      return patchedSource.replace(
        closeGateRegex,
        `canHideLastLocalWindowToTray:()=>${trayReadyVar}&&(process.platform!==\`linux\`||${globalStateExpr}.get(\`${linuxSettingsKeys.systemTray}\`)!==!1),disposables:${disposableVar}`,
      );
    }
  }

  if (patchedSource.includes("canHideLastLocalWindowToTray") && patchedSource.includes("Launching app")) {
    throw new Error("Required Linux tray settings patch failed: could not gate close-to-tray behavior");
  }

  return patchedSource;
}

function buildSemanticLinuxLaunchActionPatch({
  setterVar,
  deepLinksVar,
  fallbackFn,
  openerFn,
  windowManagerVar,
  hostExpr,
  getPrimaryWindowCall,
  createFreshWindowMethod,
  createFreshWindowCall,
  currentWindowVar,
  createdWindowVar,
  routeVar,
  focusFn,
  notificationVar,
  globalStateExpr,
  reporterVar,
  disposableVar,
  pathVar,
  fsVar,
  netVar,
  appVar,
}) {
  const freshWindowCall = createFreshWindowCall ?? `${windowManagerVar}.${createFreshWindowMethod}`;
  const notificationPrefix = notificationVar == null
    ? ""
    : `${notificationVar}.desktopNotificationManager.dismissByNavigationPath(e),`;
  const quitState = linuxQuitStateHelpers;
  const directHandler = appVar == null
    ? ""
    : `,codexLinuxSecondInstanceHandler=(e,t)=>{codexLinuxHandleLaunchActionArgsFallback(t,()=>{${fallbackFn}()})},codexLinuxBeforeQuitHandler=()=>{typeof codexLinuxMarkQuitInProgress===\`function\`&&codexLinuxMarkQuitInProgress()}`;
  const startup = appVar == null
    ? `process.platform===\`linux\`&&codexLinuxStartLaunchActionSocket();${setterVar}(e=>{codexLinuxHandleLaunchActionArgsFallback(e,()=>{${fallbackFn}()})});`
    : `process.platform===\`linux\`&&(${appVar}.app.on(\`before-quit\`,codexLinuxBeforeQuitHandler),${disposableVar}.add(()=>{${appVar}.app.off(\`before-quit\`,codexLinuxBeforeQuitHandler)}),codexLinuxStartLaunchActionSocket(),${appVar}.app.on(\`second-instance\`,codexLinuxSecondInstanceHandler),${disposableVar}.add(()=>{${appVar}.app.off(\`second-instance\`,codexLinuxSecondInstanceHandler)}));${setterVar}(e=>{codexLinuxHandleLaunchActionArgsFallback(e,()=>{${fallbackFn}()})});`;

  const ensureHostWindowCall = hostExpr == null ? `${windowManagerVar}.ensureHostWindow()` : `${windowManagerVar}.ensureHostWindow(${hostExpr})`;
  return `${quitState}codexLinuxGetSetting=e=>process.platform!==\`linux\`||${globalStateExpr}.get(e)!==!1,codexLinuxIsTrayEnabled=()=>codexLinuxGetSetting(\`${linuxSettingsKeys.systemTray}\`),codexLinuxIsWarmStartEnabled=()=>codexLinuxGetSetting(\`${linuxSettingsKeys.warmStart}\`),codexLinuxIsPromptWindowEnabled=()=>codexLinuxGetSetting(\`${linuxSettingsKeys.promptWindow}\`),codexLinuxLaunchActionAppId=()=>{let e=process.env.CODEX_LINUX_APP_ID||process.env.CODEX_APP_ID||\`codex-desktop\`;return/^[A-Za-z0-9._-]+$/.test(e)?e:\`codex-desktop\`},codexLinuxLaunchActionInstanceId=()=>{let e=process.env.CODEX_LINUX_INSTANCE_ID?.trim();return e&&/^[A-Za-z0-9._-]+$/.test(e)?e:null},codexLinuxDefaultLaunchActionSocket=()=>{let e=codexLinuxLaunchActionAppId(),t=codexLinuxLaunchActionInstanceId(),n=process.env.XDG_RUNTIME_DIR?.trim();if(n&&n.length>0)return t?${pathVar}.default.join(n,e,\`instances\`,t,\`launch-action.sock\`):${pathVar}.default.join(n,e,\`launch-action.sock\`);let r=process.env.XDG_STATE_HOME?.trim(),i=process.env.HOME?.trim();if((!r||r.length===0)&&i&&i.length>0)r=${pathVar}.default.join(i,\`.local\`,\`state\`);if(!r||r.length===0)return null;return t?${pathVar}.default.join(r,e,\`instances\`,t,\`launch-action.sock\`):${pathVar}.default.join(r,e,\`launch-action.sock\`)},${openerFn}=async(e,t)=>{${windowManagerVar}.hotkeyWindowLifecycleManager.hide();let ${currentWindowVar}=${getPrimaryWindowCall},${createdWindowVar}=${currentWindowVar}??await ${freshWindowCall}(e);${createdWindowVar}!=null&&(${notificationPrefix}${currentWindowVar}!=null&&t.navigateExistingWindow&&${routeVar}.navigateToRoute(${createdWindowVar},e),${focusFn}(${createdWindowVar}))},codexLinuxGetHotkeyWindowController=()=>typeof ${windowManagerVar}.hotkeyWindowLifecycleManager.ensureHotkeyWindowController===\`function\`?${windowManagerVar}.hotkeyWindowLifecycleManager.ensureHotkeyWindowController():${windowManagerVar}.hotkeyWindowLifecycleManager,codexLinuxShowHotkeyWindow=async()=>{let e=codexLinuxGetHotkeyWindowController();typeof e.openHome===\`function\`?await e.openHome():typeof e.show===\`function\`?await e.show():await ${ensureHostWindowCall}},codexLinuxOpenQuickChat=async()=>{${windowManagerVar}.hotkeyWindowLifecycleManager.hide();let e=${getPrimaryWindowCall},t=e??await ${freshWindowCall}(\`/\`);t!=null&&(${windowManagerVar}.windowManager.sendMessageToWindow(t,{type:\`new-quick-chat\`}),${focusFn}(t))},codexLinuxHasDeepLink=e=>Array.isArray(e)&&e.some(e=>typeof e===\`string\`&&(e.startsWith(\`codex://\`)||e.startsWith(\`codex-browser-sidebar://\`))),codexLinuxHandleLaunchActionArgs=async e=>(typeof codexLinuxIsQuitInProgress===\`function\`&&codexLinuxIsQuitInProgress())?!0:codexLinuxHasDeepLink(e)&&${deepLinksVar}.deepLinks.queueProcessArgs(e)?!0:Array.isArray(e)&&(e.includes(\`--prompt-chat\`)||e.includes(\`--hotkey-window\`))?(codexLinuxIsPromptWindowEnabled()?(await codexLinuxShowHotkeyWindow(),!0):!1):Array.isArray(e)&&e.includes(\`--quick-chat\`)?(await codexLinuxOpenQuickChat(),!0):Array.isArray(e)&&e.includes(\`--new-chat\`)?(await ${openerFn}(\`/\`,{navigateExistingWindow:!0}),!0):!1,codexLinuxHandleLaunchActionArgsFallback=(e,t)=>{if(typeof codexLinuxIsQuitInProgress===\`function\`&&codexLinuxIsQuitInProgress())return;codexLinuxHandleLaunchActionArgs(e).then(e=>{e||t()}).catch(e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to handle Linux launch action\`,{kind:\`linux-launch-action-failed\`}),t()})},codexLinuxPrewarmHotkeyWindow=()=>{if(!codexLinuxIsPromptWindowEnabled())return;try{let e=codexLinuxGetHotkeyWindowController();typeof e.prewarm===\`function\`&&e.prewarm()}catch(e){${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to prewarm Linux hotkey window\`,{kind:\`linux-hotkey-window-prewarm-failed\`})}},codexLinuxStartLaunchActionSocket=()=>{let e=process.env.CODEX_DESKTOP_LAUNCH_ACTION_SOCKET?.trim()||codexLinuxDefaultLaunchActionSocket();if(process.platform!==\`linux\`||!e||!codexLinuxIsWarmStartEnabled())return;try{${fsVar}.mkdirSync(${pathVar}.default.dirname(e),{recursive:!0,mode:448}),${fsVar}.rmSync(e,{force:!0});let t=${netVar}.default.createServer(t=>{let n=\`\`,r=!1,i=()=>{if(r)return;r=!0;let i=[];try{let e=JSON.parse(n.trim());Array.isArray(e.argv)&&(i=e.argv.filter(e=>typeof e===\`string\`))}catch(e){t.end?.(\`error\\n\`);return}codexLinuxHandleLaunchActionArgs(i).then(e=>e?void 0:${fallbackFn}()).then(()=>{t.end?.(\`ok\\n\`)}).catch(e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to handle Linux launch action socket\`,{kind:\`linux-launch-action-socket-failed\`}),t.end?.(\`error\\n\`)})};t.setEncoding?.(\`utf8\`),t.on(\`data\`,e=>{n+=e,n.includes(\`\\n\`)?i():n.length>65536&&t.destroy()}),t.on(\`end\`,i)});t.on(\`error\`,e=>{${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed Linux launch action socket\`,{kind:\`linux-launch-action-socket-error\`})}),t.listen(e),${disposableVar}.add(()=>{t.close(),${fsVar}.rmSync(e,{force:!0})})}catch(e){${reporterVar}.reportNonFatal(e instanceof Error?e:\`Failed to start Linux launch action socket\`,{kind:\`linux-launch-action-socket-start-failed\`})}}${directHandler};${startup}`;
}

function applyCurrentSemanticLinuxLaunchActionArgsPatch(currentSource) {
  const handlerRegex =
    /([A-Za-z_$][\w$]*)\(e=>\{let ([A-Za-z_$][\w$]*)=[^;{}]+;if\(([A-Za-z_$][\w$]*)\.deepLinks\.queueProcessArgs\(e\)\)\{\2&&([A-Za-z_$][\w$]*)\(\);return\}if\(\2\)\{\4\(\);return\}\4\(\)\}\);let ([A-Za-z_$][\w$]*)=async\(e,t\)=>\{/g;
  let match;
  while ((match = handlerRegex.exec(currentSource)) != null) {
    const [, setterVar, , deepLinksVar, fallbackFn, openerFn] = match;
    const openerBraceIndex = match.index + match[0].length - 1;
    const openerLetIndex = openerBraceIndex - `let ${openerFn}=async(e,t)=>`.length;
    const openerEnd = findMatchingBrace(currentSource, openerBraceIndex);
    if (openerEnd === -1) {
      continue;
    }

    const separator = currentSource[openerEnd + 1];
    if (separator !== ";" && separator !== ",") {
      continue;
    }

    const openerText = currentSource.slice(openerLetIndex, openerEnd + 1);
    const methodOpenerVars = openerText.match(
      /([A-Za-z_$][\w$]*)\.hotkeyWindowLifecycleManager\.hide\(\);let ([A-Za-z_$][\w$]*)=\1\.getPrimaryWindow(?:\(([^)]*)\))?,([A-Za-z_$][\w$]*)=\2\?\?await \1\.(createFreshLocalWindow|createFreshWindow)\(e\);/,
    );
    const functionOpenerVars = methodOpenerVars == null
      ? openerText.match(
        /([A-Za-z_$][\w$]*)\.hotkeyWindowLifecycleManager\.hide\(\);let ([A-Za-z_$][\w$]*)=\1\.getPrimaryWindow(?:\(([^)]*)\))?,([A-Za-z_$][\w$]*)=\2\?\?await ([A-Za-z_$][\w$]*)\(e\);/,
      )
      : null;
    const openerVars = methodOpenerVars ?? functionOpenerVars;
    if (openerVars == null) {
      continue;
    }

    const [, windowManagerVar, currentWindowVar, hostExprRaw, createdWindowVar, createFreshWindowTarget] = openerVars;
    const createFreshWindowMethod = methodOpenerVars == null ? null : createFreshWindowTarget;
    const createFreshWindowCall = methodOpenerVars == null ? createFreshWindowTarget : null;
    const routeVar = openerText.match(/([A-Za-z_$][\w$]*)\.navigateToRoute\([A-Za-z_$][\w$]*,e\)/)?.[1];
    const focusFn = openerText.match(new RegExp(`,([A-Za-z_$][\\w$]*)\\(${escapeRegExp(createdWindowVar)}\\)\\)\\}$`))?.[1];
    if (routeVar == null || focusFn == null) {
      continue;
    }

    const prefix = currentSource.slice(Math.max(0, match.index - HANDLER_PREFIX_LOOKBACK), match.index);
    const globalStateExpr = findLinuxGlobalStateExpression(prefix);
    const hostExpr =
      hostExprRaw?.trim() ||
      prefix.match(/localHost:([A-Za-z_$][\w$]*)/)?.[1] ||
      null;
    const getPrimaryWindowCall = hostExpr == null
      ? `${windowManagerVar}.getPrimaryWindow()`
      : `${windowManagerVar}.getPrimaryWindow(${hostExpr})`;
    const reporterVar = findLastRegexMatch(
      prefix,
      /([A-Za-z_$][\w$]*)\.reportNonFatal\(e instanceof Error\?e:`Failed to open window on second instance`/g,
    )?.[1] ?? findLastRegexMatch(prefix, /([A-Za-z_$][\w$]*)=\{reportNonFatal/g)?.[1];
    const disposableVar = findDisposableVar(prefix);
    const pathVar = inferModuleAlias(currentSource, "node:path");
    const fsVar = inferModuleAlias(currentSource, "node:fs");
    const netVar = inferModuleAlias(currentSource, "node:net");
    if (globalStateExpr == null || reporterVar == null || disposableVar == null || pathVar == null || fsVar == null || netVar == null) {
      continue;
    }

    const notificationVar = openerText.match(
      /([A-Za-z_$][\w$]*)\.desktopNotificationManager\.dismissByNavigationPath\(e\)/,
    )?.[1] ?? null;
    const replacement = buildSemanticLinuxLaunchActionPatch({
      setterVar,
      deepLinksVar,
      fallbackFn,
      openerFn,
      windowManagerVar,
      hostExpr,
      getPrimaryWindowCall,
      createFreshWindowMethod,
      createFreshWindowCall,
      currentWindowVar,
      createdWindowVar,
      routeVar,
      focusFn,
      notificationVar,
      globalStateExpr,
      reporterVar,
      disposableVar,
      pathVar,
      fsVar,
      netVar,
      appVar: null,
    });
    const suffix = separator === "," ? "let " : "";
    return currentSource.slice(0, match.index) + replacement + suffix + currentSource.slice(openerEnd + 2);
  }

  return currentSource;
}

function applyLinuxLaunchActionArgsPatch(currentSource) {
  let patchedSource = currentSource;

  if (
    patchedSource.includes("codexLinuxQuitInProgress=!1") &&
    patchedSource.includes("codexLinuxExplicitQuitApproved=!1") &&
    patchedSource.includes("codexLinuxMarkQuitInProgress=()=>{codexLinuxQuitInProgress=!0}") &&
    patchedSource.includes("codexLinuxPrepareForExplicitQuit=()=>{codexLinuxExplicitQuitApproved=!0,codexLinuxMarkQuitInProgress()}") &&
    patchedSource.includes("codexLinuxShouldBypassQuitPrompt=()=>codexLinuxExplicitQuitApproved===!0") &&
    patchedSource.includes("codexLinuxIsQuitInProgress=()=>codexLinuxQuitInProgress===!0") &&
    patchedSource.includes("codexLinuxGetSetting=e=>") &&
    patchedSource.includes("codexLinuxGetHotkeyWindowController=()=>") &&
    patchedSource.includes("codexLinuxPrewarmHotkeyWindow=()=>") &&
    patchedSource.includes("codexLinuxStartLaunchActionSocket=()=>") &&
    (
      patchedSource.includes("n.app.on(`before-quit`,codexLinuxBeforeQuitHandler)") ||
      /process\.platform===`linux`&&codexLinuxStartLaunchActionSocket\(\);[A-Za-z_$][\w$]*\(e=>\{codexLinuxHandleLaunchActionArgsFallback\(e,\(\)=>\{[A-Za-z_$][\w$]*\(\)\}\)\}\)/.test(patchedSource)
    ) &&
    !patchedSource.includes("codexLinuxOpenNewChat")
  ) {
    return patchedSource;
  }

  const currentSemanticLaunchActionPatch = applyCurrentSemanticLinuxLaunchActionArgsPatch(patchedSource);
  if (currentSemanticLaunchActionPatch !== patchedSource) {
    return currentSemanticLaunchActionPatch;
  }

  if (
    patchedSource.includes("Launching app") &&
    patchedSource.includes("deepLinks")
  ) {
    console.warn("WARN: Could not find Linux launch action handler - skipping --new-chat/--quick-chat/--prompt-chat patch");
    return patchedSource;
  }

  if (patchedSource.includes("Launching app") && !patchedSource.includes("codexLinuxGetSetting=e=>")) {
    console.warn("WARN: Linux launch action patch was not settings-gated - skipping --new-chat/--quick-chat/--prompt-chat patch");
  }

  return patchedSource;
}

function applyLinuxHotkeyWindowPrewarmPatch(currentSource) {
  let patchedSource = currentSource;

  if (!patchedSource.includes("codexLinuxPrewarmHotkeyWindow=()=>")) {
    return patchedSource;
  }

  if (
    /process\.platform===`linux`&&codexLinuxPrewarmHotkeyWindow\(\),[A-Za-z_$][\w$]*=Date\.now\(\),await [A-Za-z_$][\w$]*\.deepLinks\.flushPendingDeepLinks\(\)/.test(patchedSource)
  ) {
    return patchedSource;
  }

  const dynamicStartupPrewarmRegex =
    /(([A-Za-z_$][\w$]*)\(`(?:local )?window ensured`,([A-Za-z_$][\w$]*),\{(?:hostId:[^,{}]+,localWindowVisible:[^}]+|windowVisible:[^}]+)\}\),)\3=Date\.now\(\),await ([A-Za-z_$][\w$]*)\.deepLinks\.flushPendingDeepLinks\(\)/;
  const dynamicStartupPrewarmMatch = patchedSource.match(dynamicStartupPrewarmRegex);
  if (dynamicStartupPrewarmMatch != null) {
    const [, prefix, _traceVar, timeVar, deepLinksVar] = dynamicStartupPrewarmMatch;
    patchedSource = patchedSource.replace(
      dynamicStartupPrewarmRegex,
      `${prefix}process.platform===\`linux\`&&codexLinuxPrewarmHotkeyWindow(),${timeVar}=Date.now(),await ${deepLinksVar}.deepLinks.flushPendingDeepLinks()`,
    );
  } else {
    console.warn("WARN: Could not find Linux hotkey window prewarm insertion point — skipping startup prewarm patch");
  }

  return patchedSource;
}

module.exports = {
  applyLinuxDesktopReadinessHandlerPatch,
  applyLinuxHotkeyWindowPrewarmPatch,
  applyLinuxLaunchActionArgsPatch,
  applyLinuxSettingsPersistencePatch,
  applyLinuxTrayCloseSettingPatch,
};
