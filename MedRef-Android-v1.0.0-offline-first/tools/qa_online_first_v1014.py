#!/usr/bin/env python3
"""MedRef v1.0.15 online-first safety and regression contract."""
from pathlib import Path
import json

app = Path("app/src/main/java/com/medipharm/medref/MainActivity.java").read_text()
manifest = Path("app/src/main/AndroidManifest.xml").read_text()
gradle = Path("app/build.gradle").read_text()
tests = {
    "correct_version": "versionCode 10015" in gradle and "versionName '1.0.15'" in gradle,
    "online_website_only": 'START_URL="https://www.sachyhoc.com/medipharm/"' in app,
    "first_launch_no_bulk": "afterRuntimeReady()" in app and "dataRuntime" not in app,
    "no_rest_nonce_gate": "fetchRestNonce" not in app,
    "no_hydration_calls": all(x not in app for x in ("syncData(", "hydrateWithManifest(", "DataUpdateService.start(", "applyDataUpdate(")),
    "no_background_preflight": "scheduleBackgroundDataPreflight" not in app,
    "no_sqlite_activity": "MedRefDatabase" not in app and "LocalContentServer" not in app,
    "webview_http_cache_enabled": "WebSettings.LOAD_DEFAULT" in app and "WebSettings.LOAD_NO_CACHE" not in app,
    "remote_jsbridge_disabled": "addJavascriptInterface(" not in app,
    "no_cross_domain_webview_navigation": "openExternal(uri)" in app and 'path.startsWith("/medipharm/")' in app,
    "manual_retry_without_loop": "Máy chủ đang bận" in app and "Ứng dụng không tự thử lại liên tục" in app,
    "login_completion_coalesced": "loginTransitionPending" in app,
    "no_foreground_sync_service": 'android:name=".DataUpdateService"' not in manifest,
    "no_data_sync_permission": "FOREGROUND_SERVICE_DATA_SYNC" not in manifest,
    "app_update_kept": "AppUpdateJobService.schedule(this)" in app,
    "user_logout_preserved": "cm.setCookie(" in app and 'webView.clearCache(true)' in app,
    "login_gate_kept": "showEmbeddedLogin()" in app and "isMemberAuthenticated()" in app,
    "https_only": 'android:usesCleartextTraffic="false"' in manifest,
}
failed = [k for k, ok in tests.items() if not ok]
print(json.dumps({"release":"MedRef Android 1.0.15 Online First","checks":len(tests),"passed":len(tests)-len(failed),"failed":failed,"status":"FAIL" if failed else "PASS"},ensure_ascii=False))
raise SystemExit(1 if failed else 0)
