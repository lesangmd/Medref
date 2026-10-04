# MedRef Android v1.0.0

Native Android Offline-First client for **MEDIPHARM Clinical Reference**.

## Runtime contract

- Application name: `MedRef`
- Package: `com.medipharm.medref`
- Android: minimum API 31 (Android 12), target/compile API 35
- Java: 17
- Local origin: `https://app.medref.local`
- Server companion: MEDIPHARM Clinical Reference **v3.5.25+**
- First use: online MEDIPHARM authentication is required, followed by full hydration.
- Subsequent use: launches from local SQLite + local source media immediately.
- Session: local offline entitlement expires 30 days after the last successful online authentication.
- Sync: silent manifest check when Internet and a valid WordPress member cookie are available; v1.0.0 applies a full snapshot only when `data_version` changes.
- Safety: `active` / `staging` / `previous-good` data slots with SHA-256 verification of source media and rollback.
- App and data versions are independent.

## Server install order

1. Upgrade MEDIPHARM Clinical Reference to `v3.5.25 — MedRef Android Offline Hydration API`.
2. Build/sign/install MedRef Android v1.0.0.
3. Sign in with a MEDIPHARM account. The first successful sign-in hydrates the current published Clinical Reference corpus.

## Build

The project is dependency-free and uses Android Gradle Plugin 8.7.3. A GitHub Actions build/sign template is included under `github-actions/`.

Release signing variables:

- `MEDREF_KEYSTORE_PATH`
- `MEDREF_KEYSTORE_PASSWORD`
- `MEDREF_KEY_ALIAS`
- `MEDREF_KEY_PASSWORD`

A new package should use a dedicated MedRef production signing key. Do not reuse a different application's key unless deliberate signing policy requires it.
