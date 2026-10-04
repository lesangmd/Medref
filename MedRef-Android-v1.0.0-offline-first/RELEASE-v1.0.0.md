# MedRef Android v1.0.0 — Full Offline Hydration

Initial Android release candidate for MEDIPHARM Clinical Reference.

Scope:
- Native Android shell named **MedRef**.
- Offline-first local WebApp and SQLite clinical runtime.
- Embedded MEDIPHARM login.
- First-login full hydration from Clinical Reference v3.5.25 authenticated snapshot API.
- 30-day local authenticated session.
- Silent version check and silent data-manifest check.
- Source-media SHA verification.
- `active / staging / previous-good` rollback architecture.
- Independent app/data versioning.
- Android 12+ / API 31 minimum; target API 35.

This source package is build-ready but is not itself a signed production APK. Production status starts only after Gradle compile, zipalign/signing and on-device hydration/runtime validation with the intended MedRef release key.
