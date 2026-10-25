# v1.3.0 release verification

Scope: stable web/source distribution, with Simplified Chinese and English interfaces. No new desktop executable. This is a maintainer self-check, not an independent security audit.

## Completed locally

- 147 Python tests: parsing, accounting, quota history, resets, security boundaries, price refresh, localization, setup checks, browser login and background instance configuration.
- 55 JavaScript tests: heatmap, treemap, chart ranges, responsive geometry, interactions, first-launch routing and restart recovery.
- 14 demo tests, including 72 filter combinations, exports, reset boundaries and allowlisted output files.
- JavaScript syntax checks for the application and generated English assets.
- Built a wheel, source distribution and web-source ZIP. Installed the wheel in a clean virtual environment and launched the extracted ZIP using `run.ps1`, which created its own environment and installed dependencies. Both returned version 1.3.0 and served Chinese/English assets, health, setup and empty-data APIs.
- Restarted both isolated installations with a custom port and an app-data path containing spaces and Chinese characters. Verified first-run detection, settings persistence, selected sources/time zone and an unavailable quota connector without using real logs or credentials.
- Windows background runtime checks during implementation covered custom profiles, foreign-port conflicts, foreground takeover, crash recovery and disabling. Unit tests cover instance isolation and owned-process cleanup.
- Browser checks during implementation covered first-launch setup, folder correction, settings persistence, restart recovery, language switching, principal pages and responsive layouts.
- Packaging includes translation resources. Public source and release assets exclude credentials, local databases, logs, private screenshots and virtual environments.
- Both concise READMEs link directly to the v1.3.0 web ZIP. Updated bilingual installation/upgrade and Agent guides, changelog, MIT attribution and security reporting guidance. Checked 14 Markdown documents and 147 local links/anchors, including the packaged documentation.
- Existing desktop executable remains unchanged. Only web/source assets are released.

## Release gate

The GitHub Checks workflow tests Windows and Ubuntu with Python 3.10 and 3.12. Publish the stable release only after the release commit passes. The Pages workflow separately builds and deploys the synthetic bilingual demo. Mark v1.3.0 as the latest non-prerelease release and verify its public downloads against the local SHA-256 manifest.

Release assets:

- `codex-usage-1.3.0-web-source.zip` — recommended installation, includes launchers, background scripts and complete documentation.
- `codex_usage_local-1.3.0-py3-none-any.whl` — optional Python package; Windows background controls require the source installation.
- `codex_usage_local-1.3.0.tar.gz` — source distribution.
- `SHA256SUMS.txt` — hashes of the three packages.

## Explicit limits

- macOS has source-install instructions but has not received native OS verification in this release.
- No code signing, PyPI upload, desktop rebuild or independent penetration test.
- Quota collection depends on Codex authentication, upstream services and the computer staying awake. Missing observations cannot be reconstructed.
- Inferred reset causes are not official confirmation. Public reset announcements do not confirm an individual account reset. Price parsing can fail if upstream documentation changes; cached and custom prices remain available.
- Windows automatic startup requires the source installation and a signed-in user session. The service is intended for loopback use, not network hosting.
