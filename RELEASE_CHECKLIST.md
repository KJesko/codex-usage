# v1.2.0 release verification

Scope: stable web/source distribution, with Simplified Chinese and English interfaces. No new desktop executable. This is a maintainer self-check, not an independent security audit.

## Completed locally

- 130 Python tests: parsing, accounting, quota history, resets, security boundaries, price refresh and localization.
- 52 JavaScript tests: heatmap, treemap, chart ranges, responsive geometry and interactions.
- 14 demo tests, including 72 filter combinations, exports, reset boundaries and allowlisted output files.
- JavaScript syntax checks for the application and generated English assets.
- Built wheel and source distribution; installed the wheel in a separate virtual environment. Verified version, Chinese/English assets, health endpoint and empty-data API without reading real logs.
- Browser checks of language switching, persistence and principal pages. English synthetic project and quota pages rendered without horizontal page overflow or console errors.
- Packaging includes translation resources. Public source and release assets exclude credentials, local databases, logs, private screenshots and virtual environments.
- Chinese installation/update instructions, English README, changelog, MIT attribution and security reporting guidance reviewed.

## Release gate

The GitHub Checks workflow tests Windows and Ubuntu with Python 3.10 and 3.12. Publish the stable release only after that commit passes. The Pages workflow separately builds and deploys the synthetic bilingual demo. Release downloads include SHA-256 checksums.

## Explicit limits

- macOS has source-install instructions but has not received native OS verification in this release.
- No code signing, PyPI upload, desktop rebuild or independent penetration test.
- Quota collection depends on Codex authentication, upstream services and the computer staying awake. Missing observations cannot be reconstructed.
- Reset causes and community forecasts are estimates. Price parsing can fail if upstream documentation changes; cached and custom prices remain available.
- Windows automatic startup requires the source installation and a signed-in user session. The service is intended for loopback use, not network hosting.
