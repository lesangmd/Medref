# MedRef v1.0.10 — publication sequence

**Do not merge release metadata into `main` before APK hosting and on-device QA.**

1. Verify APK signer SHA-256 `f3d869689d9c93b20b5259459bbf2895801c9b07a59dc65e414522db2d6bcd13`, `versionCode=10010`, and APK file SHA-256 `52725477d38401acf46e30f758a98ba1bfcb8045577f15f155c4e780ecf2d803` (342295 bytes).
2. Upgrade MEDIPHARM Clinical Reference from v3.5.36 to the prepared v3.5.37 plugin ZIP, which embeds the verified `MedRef-v1.0.10.apk` and changes `/medref/app-version` to v1.0.10. Do not uninstall or wipe prior data.
3. Verify **both** the site API and actual APK download URL. Require HTTP 200, correct JSON version, APK bytes, and SHA-256.
4. On-device upgrade test from original production-signed v1.0.8/v1.0.9: installed data and offline session preserved, no repeated startup update dialog, interrupted download resumes.
5. Merge the corrective PR and copy the **candidate JSON** at `release-candidates/medref-update-v1.0.10.json` to repository-root `medref-update.json` **in a separate commit after steps 1–4 succeed**. Changing the root manifest triggers `publish-medref-apk.yml`, which downloads the APK from the website and must verify SHA-256 and the original signer before creating the GitHub release.
6. Verify GitHub Release `medref-v1.0.10`, asset `MedRef-latest.apk`, and `https://github.com/lesangmd/Medref/releases/latest`. Do not claim a release succeeded until these checks pass.

**Current verified state (2026-10-17):** compiled signed APK and PHP patch ZIP are prepared and linted; website v3.5.36 still announces MedRef v1.0.8; GitHub Latest is v1.0.6; direct WordPress plugin upload is not supported by the available connected WP API (WPVibe helper plugin is not installed).