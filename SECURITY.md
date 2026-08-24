# Security policy

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability or an exposed credential. Use GitHub private vulnerability reporting for this repository. If private reporting is unavailable, contact the repository owner through a private channel listed on their GitHub profile.

Include affected versions, reproduction steps, expected impact and any suggested mitigation. Do not access data that is not yours and do not disrupt running services while testing.

## Secrets and local configuration

- Keep `.env`, `.monconfig`, `Data/`, `.eden-agent/` and generated capability tokens out of Git.
- Commit `.monconfig.example` only with empty credentials and generic location values.
- Treat any credential that has entered Git history as compromised: revoke or rotate it before publishing a replacement repository.
- Character and model assets belong in a separately governed resource repository, not the source repository.

## Supported versions

Until the first stable release, security fixes are provided on the latest `main` branch only.
