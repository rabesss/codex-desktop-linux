//! Upstream DMG metadata and download helpers.

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use reqwest::{header, Client};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{fs::File, io::AsyncWriteExt};

#[derive(Debug, Clone, PartialEq, Eq)]
/// Selected HTTP metadata used to detect upstream DMG changes.
pub struct RemoteMetadata {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_length: Option<u64>,
    pub headers_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Result of downloading the current upstream DMG snapshot.
pub struct DownloadedDmg {
    pub path: PathBuf,
    pub sha256: String,
    pub candidate_version: String,
}

/// Fetches the upstream DMG headers used to detect candidate updates.
pub async fn fetch_remote_metadata(client: &Client, dmg_url: &str) -> Result<RemoteMetadata> {
    let response = client
        .head(dmg_url)
        .send()
        .await
        .with_context(|| format!("Failed HEAD request for {dmg_url}"))?
        .error_for_status()
        .with_context(|| format!("HEAD request for {dmg_url} returned an error status"))?;

    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let last_modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let content_length = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());

    let headers_fingerprint = format!(
        "etag={}|last_modified={}|content_length={}",
        etag.as_deref().unwrap_or(""),
        last_modified.as_deref().unwrap_or(""),
        content_length
            .map(|value| value.to_string())
            .as_deref()
            .unwrap_or("")
    );

    Ok(RemoteMetadata {
        etag,
        last_modified,
        content_length,
        headers_fingerprint,
    })
}

/// Downloads the upstream DMG and derives a package version from its hash.
pub async fn download_dmg(
    client: &Client,
    dmg_url: &str,
    destination_dir: &Path,
    version_timestamp: DateTime<Utc>,
) -> Result<DownloadedDmg> {
    download_dmg_to_cache(client, dmg_url, destination_dir, version_timestamp, None).await
}

async fn download_dmg_to_cache(
    client: &Client,
    dmg_url: &str,
    destination_dir: &Path,
    version_timestamp: DateTime<Utc>,
    expected_sha256: Option<&str>,
) -> Result<DownloadedDmg> {
    tokio::fs::create_dir_all(destination_dir)
        .await
        .with_context(|| format!("Failed to create {}", destination_dir.display()))?;

    let destination = destination_dir.join("Codex.dmg");
    let temp_destination = temporary_download_path(&destination);

    let result = download_dmg_to_temp(
        client,
        dmg_url,
        &destination,
        &temp_destination,
        version_timestamp,
        expected_sha256,
    )
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_destination).await;
    }

    result
}

async fn download_dmg_to_temp(
    client: &Client,
    dmg_url: &str,
    destination: &Path,
    temp_destination: &Path,
    version_timestamp: DateTime<Utc>,
    expected_sha256: Option<&str>,
) -> Result<DownloadedDmg> {
    let response = client
        .get(dmg_url)
        .send()
        .await
        .with_context(|| format!("Failed GET request for {dmg_url}"))?
        .error_for_status()
        .with_context(|| format!("GET request for {dmg_url} returned an error status"))?;

    let mut file = File::create(temp_destination)
        .await
        .with_context(|| format!("Failed to create {}", temp_destination.display()))?;

    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("Failed downloading {dmg_url}"))?;
        file.write_all(&chunk)
            .await
            .with_context(|| format!("Failed writing {}", temp_destination.display()))?;
        hasher.update(&chunk);
    }

    file.flush()
        .await
        .with_context(|| format!("Failed flushing {}", temp_destination.display()))?;
    drop(file);

    let sha256 = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if let Some(expected_sha256) = expected_sha256 {
        anyhow::ensure!(
            sha256 == expected_sha256,
            "Downloaded upstream DMG hash {} did not match approved hash {}",
            sha256,
            expected_sha256
        );
    }

    let candidate_version = derive_candidate_version(&sha256, version_timestamp)?;
    tokio::fs::rename(temp_destination, destination)
        .await
        .with_context(|| {
            format!(
                "Failed to move {} to {}",
                temp_destination.display(),
                destination.display()
            )
        })?;

    Ok(DownloadedDmg {
        path: destination.to_path_buf(),
        sha256,
        candidate_version,
    })
}

fn temporary_download_path(destination: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    destination.with_file_name(format!(".Codex.dmg.{}.{}.tmp", process::id(), nonce))
}

/// Downloads a DMG and rejects it unless the SHA256 matches the approved pin.
pub async fn download_dmg_with_expected_sha256(
    client: &Client,
    dmg_url: &str,
    destination_dir: &Path,
    version_timestamp: DateTime<Utc>,
    expected_sha256: &str,
) -> Result<DownloadedDmg> {
    download_dmg_to_cache(
        client,
        dmg_url,
        destination_dir,
        version_timestamp,
        Some(expected_sha256),
    )
    .await
}

/// Computes the SHA256 for an existing DMG or cached package input.
pub fn sha256_file(path: &Path) -> Result<String> {
    let bytes =
        std::fs::read(path).with_context(|| format!("Failed to read {}", path.display()))?;
    Ok(sha256_bytes(&bytes))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

/// Derives a local package version from the DMG hash and download timestamp.
pub fn derive_candidate_version(sha256: &str, timestamp: DateTime<Utc>) -> Result<String> {
    let short_hash = sha256
        .get(0..8)
        .ok_or_else(|| anyhow!("sha256 is too short to derive candidate version"))?;
    Ok(format!(
        "{}+{}",
        timestamp.format("%Y.%m.%d.%H%M%S"),
        short_hash
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use chrono::TimeZone;
    use tempfile::tempdir;
    use wiremock::{
        matchers::{method, path},
        Mock, MockServer, ResponseTemplate,
    };

    #[tokio::test]
    async fn fetches_remote_metadata_from_head() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("HEAD"))
            .and(path("/Codex.dmg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("ETag", "\"abc\"")
                    .insert_header("Last-Modified", "Tue, 25 Mar 2026 00:00:00 GMT")
                    .insert_header("Content-Length", "42"),
            )
            .mount(&server)
            .await;

        let client = Client::builder().build()?;
        let metadata =
            fetch_remote_metadata(&client, &format!("{}/Codex.dmg", server.uri())).await?;
        assert_eq!(metadata.etag.as_deref(), Some("\"abc\""));
        assert_eq!(
            metadata.last_modified.as_deref(),
            Some("Tue, 25 Mar 2026 00:00:00 GMT")
        );
        assert_eq!(metadata.content_length, Some(42));
        assert!(metadata.headers_fingerprint.contains("etag=\"abc\""));
        Ok(())
    }

    #[tokio::test]
    async fn downloads_dmg_and_hashes_contents() -> Result<()> {
        let server = MockServer::start().await;
        let body = b"codex-dmg-test-payload";
        Mock::given(method("GET"))
            .and(path("/Codex.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body.to_vec()))
            .mount(&server)
            .await;

        let client = Client::builder().build()?;
        let temp = tempdir()?;
        let downloaded = download_dmg(
            &client,
            &format!("{}/Codex.dmg", server.uri()),
            temp.path(),
            Utc.with_ymd_and_hms(2026, 3, 24, 12, 0, 0).unwrap(),
        )
        .await?;

        assert_eq!(downloaded.path, temp.path().join("Codex.dmg"));
        assert_eq!(
            downloaded.sha256,
            "678cd508ffe0071e217020a7a4eecbebe25362c022ac78c13a5ae87b7a3a0c92"
        );
        assert_eq!(downloaded.candidate_version, "2026.03.24.120000+678cd508");
        Ok(())
    }

    #[tokio::test]
    async fn download_with_expected_hash_rejects_mismatch() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/Codex.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"payload".to_vec()))
            .mount(&server)
            .await;

        let client = Client::builder().build()?;
        let temp = tempdir()?;
        let error = download_dmg_with_expected_sha256(
            &client,
            &format!("{}/Codex.dmg", server.uri()),
            temp.path(),
            Utc.with_ymd_and_hms(2026, 3, 24, 12, 0, 0).unwrap(),
            "0000000000000000000000000000000000000000000000000000000000000000",
        )
        .await
        .expect_err("hash mismatch should fail");

        assert!(error.to_string().contains("did not match approved hash"));
        assert!(
            !temp.path().join("Codex.dmg").exists(),
            "hash mismatch must not publish Codex.dmg"
        );
        assert!(
            std::fs::read_dir(temp.path())?.next().is_none(),
            "hash mismatch should clean up temporary downloads"
        );
        Ok(())
    }

    #[tokio::test]
    async fn download_with_expected_hash_rejects_mismatch_without_replacing_existing_cache(
    ) -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/Codex.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"new-wrong-payload".to_vec()))
            .mount(&server)
            .await;

        let client = Client::builder().build()?;
        let temp = tempdir()?;
        let cached = temp.path().join("Codex.dmg");
        std::fs::write(&cached, b"existing-approved-cache")?;

        let error = download_dmg_with_expected_sha256(
            &client,
            &format!("{}/Codex.dmg", server.uri()),
            temp.path(),
            Utc.with_ymd_and_hms(2026, 3, 24, 12, 0, 0).unwrap(),
            "0000000000000000000000000000000000000000000000000000000000000000",
        )
        .await
        .expect_err("hash mismatch should fail");

        assert!(error.to_string().contains("did not match approved hash"));
        assert_eq!(std::fs::read(&cached)?, b"existing-approved-cache");
        assert_eq!(
            std::fs::read_dir(temp.path())?.count(),
            1,
            "hash mismatch should not leave temporary downloads"
        );
        Ok(())
    }

    #[tokio::test]
    async fn download_dmg_does_not_replace_existing_cache_when_request_fails() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/Codex.dmg"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = Client::builder().build()?;
        let temp = tempdir()?;
        let cached = temp.path().join("Codex.dmg");
        std::fs::write(&cached, b"existing-cache")?;

        let error = download_dmg(
            &client,
            &format!("{}/Codex.dmg", server.uri()),
            temp.path(),
            Utc.with_ymd_and_hms(2026, 3, 24, 12, 0, 0).unwrap(),
        )
        .await
        .expect_err("request failure should fail");

        assert!(error.to_string().contains("returned an error status"));
        assert_eq!(std::fs::read(&cached)?, b"existing-cache");
        assert_eq!(
            std::fs::read_dir(temp.path())?.count(),
            1,
            "request failure should not leave temporary downloads"
        );
        Ok(())
    }

    #[test]
    fn hashes_existing_file() -> Result<()> {
        let temp = tempdir()?;
        let path = temp.path().join("Codex.dmg");
        std::fs::write(&path, b"payload")?;

        assert_eq!(
            sha256_file(&path)?,
            "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5"
        );
        Ok(())
    }

    #[test]
    fn derive_candidate_version_rejects_short_hashes() {
        let error = derive_candidate_version("short", Utc::now()).expect_err("hash should fail");
        assert!(error.to_string().contains("sha256 is too short"));
    }
}
