//! Approved upstream DMG policy for the Linux updater.

use crate::{
    config::RuntimeConfig,
    state::{PersistedState, UnapprovedUpstreamCandidate},
    upstream::{self, RemoteMetadata},
    wrapper,
};
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

const LOCK_RELATIVE_PATH: &str = "release/upstream-dmg-lock.json";
const POLICY_ENV: &str = "CODEX_UPSTREAM_DMG_POLICY";
const PACKAGED_BUILDER_ROOT: &str = "/opt/codex-desktop/update-builder";
const OFFICIAL_DMG_URL: &str = "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpstreamDmgPolicy {
    Approved(ApprovedUpstreamDmg),
    Latest,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct UpstreamDmgLock {
    pub schema_version: u64,
    pub approved: ApprovedUpstreamDmg,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ApprovedUpstreamDmg {
    pub upstream_app_version: String,
    pub dmg_url: String,
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
    pub approved_at: String,
    pub approved_by: String,
    #[serde(default)]
    pub wrapper_min_commit: Option<String>,
    #[serde(default)]
    pub patch_report: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

impl ApprovedUpstreamDmg {
    pub fn short_sha(&self) -> &str {
        &self.sha256[..8]
    }

    pub fn package_version(&self) -> Result<String> {
        let approved_at = DateTime::parse_from_rfc3339(&self.approved_at)
            .with_context(|| {
                format!(
                    "approved upstream DMG lock has invalid approved_at: {}",
                    self.approved_at
                )
            })?
            .with_timezone(&Utc);
        upstream::derive_candidate_version(&self.sha256, approved_at)
    }
}

pub fn policy_for_config(config: &RuntimeConfig) -> Result<UpstreamDmgPolicy> {
    match std::env::var(POLICY_ENV) {
        Ok(value) if value.eq_ignore_ascii_case("latest") => return Ok(UpstreamDmgPolicy::Latest),
        Ok(value) if value.eq_ignore_ascii_case("approved") || value.trim().is_empty() => {}
        Ok(value) => {
            return Err(anyhow!(
                "{POLICY_ENV} must be unset, 'approved', or 'latest'; got {value:?}"
            ));
        }
        Err(_) => {}
    }

    let lock_path = lock_path(&config.builder_bundle_root);
    if lock_path.is_file() {
        return Ok(UpstreamDmgPolicy::Approved(load_lock(&lock_path)?.approved));
    }

    if config.builder_bundle_root == Path::new(PACKAGED_BUILDER_ROOT) {
        anyhow::bail!(
            "Packaged updater is missing {}; refusing to install latest upstream DMGs by default",
            lock_path.display()
        );
    }

    Ok(UpstreamDmgPolicy::Latest)
}

pub fn lock_path(builder_bundle_root: &Path) -> PathBuf {
    builder_bundle_root.join(LOCK_RELATIVE_PATH)
}

pub fn load_lock(path: &Path) -> Result<UpstreamDmgLock> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let lock = serde_json::from_str::<UpstreamDmgLock>(&content)
        .with_context(|| format!("Failed to parse {}", path.display()))?;
    validate_lock(&lock)
        .with_context(|| format!("Invalid upstream DMG lock {}", path.display()))?;
    Ok(lock)
}

fn validate_lock(lock: &UpstreamDmgLock) -> Result<()> {
    anyhow::ensure!(lock.schema_version == 1, "schema_version must be 1");
    validate_approved(&lock.approved)
}

fn validate_approved(approved: &ApprovedUpstreamDmg) -> Result<()> {
    anyhow::ensure!(
        is_allowed_approved_dmg_url(&approved.dmg_url),
        "approved dmg_url must point to the official Codex DMG URL"
    );
    anyhow::ensure!(
        approved.sha256.len() == 64 && approved.sha256.bytes().all(|b| b.is_ascii_hexdigit()),
        "approved sha256 must be 64 hexadecimal characters"
    );
    anyhow::ensure!(approved.size > 0, "approved size must be greater than zero");
    anyhow::ensure!(
        !approved.upstream_app_version.trim().is_empty(),
        "approved upstream_app_version is required"
    );
    anyhow::ensure!(
        !approved.approved_by.trim().is_empty(),
        "approved_by is required"
    );
    let _ = DateTime::parse_from_rfc3339(&approved.approved_at)
        .context("approved_at must be an RFC3339 timestamp")?;
    if let Some(wrapper_min_commit) = approved.wrapper_min_commit.as_deref() {
        anyhow::ensure!(
            wrapper_min_commit.len() >= 7
                && wrapper_min_commit.len() <= 40
                && wrapper_min_commit.bytes().all(|b| b.is_ascii_hexdigit()),
            "wrapper_min_commit must be a git hex commit prefix or SHA"
        );
    }
    for field in [approved.patch_report.as_deref(), approved.notes.as_deref()]
        .into_iter()
        .flatten()
    {
        reject_payload_or_private_path(field)?;
    }
    Ok(())
}

fn is_allowed_approved_dmg_url(url: &str) -> bool {
    if url == OFFICIAL_DMG_URL {
        return true;
    }

    #[cfg(test)]
    {
        url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:")
    }

    #[cfg(not(test))]
    {
        false
    }
}

fn reject_payload_or_private_path(value: &str) -> Result<()> {
    anyhow::ensure!(
        !value.contains("Codex.dmg") && !value.contains(".app") && !value.contains(".pkg.tar"),
        "lock metadata must not reference redistributed app payloads"
    );
    anyhow::ensure!(
        !value.contains("/home/") && !value.contains("/var/tmp/") && !value.contains("/tmp/"),
        "lock metadata must not contain private local paths"
    );
    Ok(())
}

pub fn metadata_indicates_unapproved_candidate(
    approved: &ApprovedUpstreamDmg,
    metadata: &RemoteMetadata,
) -> bool {
    if metadata
        .content_length
        .is_some_and(|content_length| content_length != approved.size)
    {
        return true;
    }
    if let (Some(remote), Some(approved)) = (metadata.etag.as_deref(), approved.etag.as_deref()) {
        if remote != approved {
            return true;
        }
    }
    if let (Some(remote), Some(approved)) = (
        metadata.last_modified.as_deref(),
        approved.last_modified.as_deref(),
    ) {
        if remote != approved {
            return true;
        }
    }
    false
}

pub fn record_unapproved_candidate(
    state: &mut PersistedState,
    approved: &ApprovedUpstreamDmg,
    metadata: &RemoteMetadata,
) {
    state.unapproved_upstream_candidate = Some(UnapprovedUpstreamCandidate {
        dmg_url: approved.dmg_url.clone(),
        etag: metadata.etag.clone(),
        last_modified: metadata.last_modified.clone(),
        content_length: metadata.content_length,
        headers_fingerprint: metadata.headers_fingerprint.clone(),
        detected_at: Utc::now(),
        reason: format!(
            "Live upstream DMG metadata differs from approved pin {} ({})",
            approved.upstream_app_version, approved.sha256
        ),
    });
}

pub fn approved_dmg_already_installed(
    config: &RuntimeConfig,
    state: &PersistedState,
    approved: &ApprovedUpstreamDmg,
) -> bool {
    state.dmg_sha256.as_deref() == Some(approved.sha256.as_str())
        || state
            .installed_version
            .contains(&format!("+{}", approved.short_sha()))
        || installed_app_dmg_sha256(config).as_deref() == Some(approved.sha256.as_str())
}

pub fn refresh_approved_installed_state(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    approved: &ApprovedUpstreamDmg,
) {
    if installed_app_dmg_sha256(config).as_deref() == Some(approved.sha256.as_str()) {
        state.dmg_sha256 = Some(approved.sha256.clone());
    }
}

fn installed_app_metadata_paths(app_executable_path: &Path) -> Vec<PathBuf> {
    let Some(app_root) = app_executable_path.parent() else {
        return Vec::new();
    };
    vec![
        app_root.join(".codex-linux/build-info.json"),
        app_root.join("resources/codex-linux-build-info.json"),
    ]
}

fn installed_app_dmg_sha256(config: &RuntimeConfig) -> Option<String> {
    installed_app_metadata_paths(&config.app_executable_path)
        .into_iter()
        .find_map(|path| {
            let content = std::fs::read_to_string(path).ok()?;
            let value = serde_json::from_str::<Value>(&content).ok()?;
            value
                .get("upstreamDmg")?
                .get("sha256")?
                .as_str()?
                .trim()
                .split('\0')
                .next()
                .filter(|sha256| {
                    sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit())
                })
                .map(str::to_string)
        })
}

pub fn ensure_wrapper_minimum(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    approved: &ApprovedUpstreamDmg,
) -> Result<()> {
    let Some(required) = approved
        .wrapper_min_commit
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    if state.installed_wrapper_commit.is_none() || state.installed_wrapper_version.is_none() {
        if let Some(installed) = wrapper::installed_wrapper_from_metadata(
            &config.app_executable_path,
            &config.builder_bundle_root,
        ) {
            state.installed_wrapper_version = installed.version;
            state.installed_wrapper_commit = Some(installed.commit);
        }
    }

    let Some(installed) = state.installed_wrapper_commit.as_deref() else {
        anyhow::bail!(
            "Approved upstream DMG requires wrapper commit {required}, but installed wrapper metadata is unavailable"
        );
    };

    if wrapper::commit_satisfies_minimum(&config.builder_bundle_root, installed, required)
        .unwrap_or_else(|| installed.starts_with(required) || required.starts_with(installed))
    {
        return Ok(());
    }

    anyhow::bail!(
        "Approved upstream DMG requires wrapper commit {required}; installed wrapper commit is {installed}. Update the Linux wrapper before applying this upstream app pin."
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approved() -> ApprovedUpstreamDmg {
        ApprovedUpstreamDmg {
            upstream_app_version: "26.616.71553".to_string(),
            dmg_url: "https://persistent.oaistatic.com/codex-app-prod/Codex.dmg".to_string(),
            sha256: "efedc6c8ffa8f9479ddded3fed40c5cad261c779b798fdd161847f48141985c2".to_string(),
            size: 10,
            etag: Some("abc".to_string()),
            last_modified: Some("Thu, 25 Jun 2026 00:00:00 GMT".to_string()),
            approved_at: "2026-06-25T00:00:00Z".to_string(),
            approved_by: "manual".to_string(),
            wrapper_min_commit: Some("63a7377".to_string()),
            patch_report: Some("docs/release-reports/upstream-26.616.71553.json".to_string()),
            notes: Some("Passed local dogfood.".to_string()),
        }
    }

    fn config_with_app_executable(app_executable_path: PathBuf) -> RuntimeConfig {
        RuntimeConfig {
            dmg_url: OFFICIAL_DMG_URL.to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            workspace_root: app_executable_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("cache"),
            builder_bundle_root: app_executable_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("builder"),
            app_executable_path,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
        }
    }

    #[test]
    fn validates_approved_lock() {
        let lock = UpstreamDmgLock {
            schema_version: 1,
            approved: approved(),
        };

        validate_lock(&lock).expect("valid lock");
    }

    #[test]
    fn rejects_payload_references() {
        let mut approved = approved();
        approved.patch_report = Some("docs/Codex.dmg".to_string());
        let error = validate_approved(&approved).expect_err("payload path rejected");

        assert!(error
            .to_string()
            .contains("must not reference redistributed app payloads"));
    }

    #[test]
    fn detects_live_metadata_drift() {
        let approved = approved();
        let metadata = RemoteMetadata {
            etag: Some("def".to_string()),
            last_modified: approved.last_modified.clone(),
            content_length: Some(approved.size),
            headers_fingerprint:
                "etag=def|last_modified=Thu, 25 Jun 2026 00:00:00 GMT|content_length=10".to_string(),
        };

        assert!(metadata_indicates_unapproved_candidate(
            &approved, &metadata
        ));
    }

    #[test]
    fn installed_version_suffix_counts_as_approved() {
        let approved = approved();
        let temp = tempfile::tempdir().expect("tempdir");
        let config = config_with_app_executable(temp.path().join("app/electron"));
        let mut state = PersistedState::new(true);
        state.installed_version = "2026.06.23.154809+efedc6c8-1".to_string();

        assert!(approved_dmg_already_installed(&config, &state, &approved));
    }

    #[test]
    fn installed_build_info_sha_counts_as_approved() {
        let approved = approved();
        let temp = tempfile::tempdir().expect("tempdir");
        let app_root = temp.path().join("app");
        std::fs::create_dir_all(app_root.join("resources")).expect("resources");
        std::fs::write(
            app_root.join("resources/codex-linux-build-info.json"),
            serde_json::json!({
                "upstreamDmg": {
                    "sha256": approved.sha256,
                }
            })
            .to_string(),
        )
        .expect("build info");
        let config = config_with_app_executable(app_root.join("electron"));
        let state = PersistedState::new(true);

        assert!(approved_dmg_already_installed(&config, &state, &approved));
    }
}
