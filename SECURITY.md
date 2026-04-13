# Security Policy

## Supported Versions

Security fixes are applied to the latest published version.

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Report security issues by email:
- Email: pratulmakar02@gmail.com
- Subject: [cross-connection] Security Report

Please include:
- A clear description of the vulnerability
- Reproduction steps or proof of concept
- Affected version(s)
- Potential impact

## Response Process

- Initial acknowledgment target: within 72 hours
- Triage and severity assessment: as soon as reproducible details are confirmed
- Coordinated disclosure: fix first, then public advisory and release notes

## Best Practices for Consumers

- Pin to trusted versions and keep dependencies updated
- Enable lockfiles and review dependency updates
- Use SSRF safeguards and allowlists in production config
- Avoid logging sensitive headers; use header redaction
