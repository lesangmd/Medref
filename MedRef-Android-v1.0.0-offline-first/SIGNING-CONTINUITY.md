# MedRef Android — signing continuity contract

- Android package/application ID: `com.medipharm.medref`
- Production certificate SHA-256 (v1.0.0 → v1.0.9):
  `f3d869689d9c93b20b5259459bbf2895801c9b07a59dc65e414522db2d6bcd13`
- Production signer: the **original** `medref-production.jks` from the MedRef v1.0.0 signing backup, alias `medref`.
- **Do not** sign subsequent MedRef APK releases with the replacement v1.0.9/new-signing-baseline certificate (SHA-256 `40d054945671b6c78c996f5a176c834ace560d97c70c8caea766ac28f4ff6838`).
- The original private key and its passwords are kept outside source control and release artifacts. Never upload the key/credentials to this repository or a public release.
- Never silently change `applicationId` or downgrade `versionCode`. v1.0.10 uses `versionCode=10010`.
- Before publishing, `apksigner verify --print-certs --min-sdk-version 31 <apk>` **must** report the original fingerprint. The `publish-medref-apk.yml` workflow includes a hard failure on signer mismatch.
- Only publish an APK after verifying signature, versionCode, application ID, SHA-256 and on-device install-over of the previously published MedRef APK. A successful source build alone does not prove on-device upgrade behavior.
- After hosting the verified signed APK at a stable HTTPS URL, update the WordPress MedRef `app-version` endpoint and the GitHub `medref-update.json` release metadata to the new version, signed APK URL, bytes and SHA-256. Without that release-channel update, the app's "Kiểm tra phiên bản mới" cannot discover the new version.
