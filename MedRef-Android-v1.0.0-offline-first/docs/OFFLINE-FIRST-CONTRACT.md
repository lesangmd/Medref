# MedRef Offline-First Contract v1

## Authentication

The Android application never bypasses WordPress authentication. First hydration requires an authenticated MEDIPHARM WordPress cookie and a current `wp_rest` nonce. The server companion's `/offline/*` routes use `is_user_logged_in()` as their permission callback.

After a successful authenticated manifest request, MedRef stores only the verification timestamp for offline entitlement. The maximum offline period is 30 days. Logout removes the local entitlement and WordPress authentication cookies but does not delete the downloaded clinical dataset.

## Hydration

Server schema: `medref-offline-manifest/v1`.
Snapshot schema: `medref-offline-snapshot/v1`.
Reserved future delta schema: `medref-offline-delta/v1`.

The snapshot contains published protocols and procedures, ICD-10, PL3, YHCT, coding guides, synonyms, dashboard/status metadata and all source media referenced by Clinical Desk sections. Clinical content is written to a staging SQLite database. Source media are downloaded by SHA-addressed filenames and verified against their descriptor SHA-256 before activation.

## Activation and rollback

Data slots:

- `active`: current local dataset
- `staging`: incomplete/new hydration workspace
- `previous-good`: immediately previous validated dataset

Activation happens only after dataset count validation and source-media verification. A failed hydration leaves `active` unchanged. A successful activation moves the former `active` dataset to `previous-good`.

## Offline APIs

The local WebView uses `https://app.medref.local` and the native interception layer emulates the REST surfaces required by the existing Clinical Reference frontend:

- unified dashboard/global search
- protocol/procedure search, specialties, status and detail
- protocol ↔ ICD links
- ICD search, code detail and primary-code checker
- PL3, YHCT and coding-guide search

This lets the accepted Clinical Reference Web UI render from local SQLite without changing clinical presentation logic.

## Sync policy v1.0.0

On app start, local data is shown immediately when the offline session is valid. If Internet and an authenticated MEDIPHARM cookie are available, the app checks the server manifest silently. When `data_version` is unchanged, no corpus download occurs. When it changes, v1.0.0 hydrates a new complete snapshot into staging, reusing unchanged media by SHA from `active` or `previous-good`.
