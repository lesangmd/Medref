#!/usr/bin/env python3
from pathlib import Path
import json, hashlib, re, sys
R=Path(__file__).resolve().parents[1]
checks=[]
def ck(name, cond, detail=''):
    checks.append((name,bool(cond),detail))
    if not cond: print('FAIL',name,detail)

manifest=(R/'app/src/main/AndroidManifest.xml').read_text(encoding='utf-8')
build=(R/'app/build.gradle').read_text(encoding='utf-8')
main=(R/'app/src/main/java/com/medipharm/medref/MainActivity.java').read_text(encoding='utf-8')
runtime=(R/'app/src/main/java/com/medipharm/medref/MedRefDataRuntime.java').read_text(encoding='utf-8')
server=(R/'app/src/main/java/com/medipharm/medref/LocalContentServer.java').read_text(encoding='utf-8')
db=(R/'app/src/main/java/com/medipharm/medref/MedRefDatabase.java').read_text(encoding='utf-8')
html=(R/'app/src/main/assets/web/index.html').read_text(encoding='utf-8')
boot=(R/'app/src/main/assets/web/assets/offline-bootstrap.js').read_text(encoding='utf-8')
ck('package', "applicationId 'com.medipharm.medref'" in build)
ck('app_name', '<string name="app_name">MedRef</string>' in (R/'app/src/main/res/values/strings.xml').read_text())
ck('min_sdk_31', 'minSdk 31' in build)
ck('target_sdk_35', 'targetSdk 35' in build and 'compileSdk 35' in build)
ck('version_1_0_0', "versionName '1.0.0'" in build and 'versionCode 10000' in build)
ck('local_origin', 'app.medref.local' in server and 'app.medref.local' in boot)
ck('sqlite_runtime', 'SQLiteDatabase' in db and 'medref.db' in runtime)
ck('slots', all(x in runtime for x in ['active','staging','previous-good']))
ck('30_day_session', '30L * 24L * 60L * 60L * 1000L' in runtime)
ck('authenticated_snapshot', '/wp-json/medipharm-reference/v1/offline/' in runtime and 'X-WP-Nonce' in runtime)
ck('sha_media', 'SHA-256 media không khớp' in runtime and 'MessageDigest.getInstance("SHA-256")' in runtime)
ck('native_actions', all(x in main for x in ['"medref".equals(scheme)','data-update','rollback-data','check-update']))
ck('web_assets', all((R/'app/src/main/assets/web/assets'/x).is_file() for x in ['mcr-app.css','mcr-app.js','mtp-app.css','mtp-app.js','nah-icd10.css','nah-icd10.js','offline-bootstrap.js']))
ck('web_roots', all(x in html for x in ['id="mcr-app"','id="mtp-app"','data-nah-icd10-app']))
ck('no_cleartext', 'usesCleartextTraffic="false"' in manifest)
ck('no_mdict_package_residue', 'com.medipharm.mdict' not in ''.join([main,runtime,server,db,build,manifest,boot]))
summary={'release':'MedRef Android v1.0.0','checks':len(checks),'passed':sum(x[1] for x in checks),'failed':[x[0] for x in checks if not x[1]],'status':'PASS' if all(x[1] for x in checks) else 'FAIL'}
(R/'QA-v1.0.0.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
sys.exit(0 if summary['status']=='PASS' else 1)
