# Security and privacy

This is a single-user, loopback-only local tool, not a remotely hosted multi-user service. Do not expose its port through a reverse proxy, public tunnel or LAN binding. Local processes running as your user may access local files and the service; it is not an isolation boundary against malware on the same machine.

The server validates its Host header. Mutating requests require a CSRF token and reject foreign Origins. Values rendered from logs are escaped, and CSV exports protect spreadsheet formula cells. SSH uses configured hosts and existing host verification rather than accepting arbitrary shell commands.

Source logs are read-only. Local indexes, quota history, configuration, CSV exports and screenshots can contain titles, paths, server addresses and account metadata. Keep them private. Never attach `auth.json`, tokens, SSH keys, actual reset-card identifiers or full logs to public issues.

Network features are documented in the [English user guide](../docs/USER_GUIDE.en.md#data--privacy) and [中文使用指南](../docs/USER_GUIDE.md#数据与隐私). Language translation is local and sends no content to translation services.

## Reporting

Please do not disclose exploitable details or private data in public issues. If GitHub's **Report a vulnerability** option is available in this repository's Security tab, use it. Otherwise open an issue asking for a private reporting channel **without exploit details or sensitive attachments**. We do not claim a staffed security response SLA.

Include the release version, operating system, a sanitized reproduction and impact. Use synthetic fixtures. Security maintenance targets the latest stable web release; older desktop builds are not covered by the v1.3.0 web release validation.
