package com.medipharm.medref;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class MedRefDataRuntime {
    public interface ProgressListener { void onProgress(int percent, String message); }

    public static final class UpdatePlan {
        public final JSONObject remote;
        public final ArrayList<String> changedDatasets;
        public final boolean runtimeChanged;
        public final boolean mediaChanged;
        public final boolean fullHydrate;
        UpdatePlan(JSONObject remote,ArrayList<String> changedDatasets,boolean runtimeChanged,boolean mediaChanged,boolean fullHydrate){
            this.remote=remote;this.changedDatasets=changedDatasets;this.runtimeChanged=runtimeChanged;this.mediaChanged=mediaChanged;this.fullHydrate=fullHydrate;
        }
        public boolean hasChanges(){return fullHydrate||runtimeChanged||mediaChanged||!changedDatasets.isEmpty();}
        public int remoteCount(String key){JSONObject d=remote.optJSONObject("datasets");JSONObject x=d==null?null:d.optJSONObject(key);return x==null?-1:x.optInt("count",-1);}
        public boolean usesProtocolDelta(){
            JSONObject d=remote.optJSONObject("datasets");
            JSONObject p=d==null?null:d.optJSONObject("protocols");
            return p!=null&&"index-v1".equals(p.optString("delta_mode",""))&&!p.optString("index_url","").isEmpty()&&!p.optString("batch_url","").isEmpty();
        }
        public String summary(){
            ArrayList<String> labels=new ArrayList<>();
            for(String k:changedDatasets){
                if("protocols".equals(k))labels.add("Phác đồ / Quy trình");
                else if("icd".equals(k))labels.add("ICD-10");
                else if("pl3".equals(k))labels.add("Danh mục thuốc");
                else if("yhct".equals(k))labels.add("YHCT");
                else if("guides".equals(k))labels.add("Hướng dẫn mã hóa");
                else if("synonyms".equals(k))labels.add("Từ đồng nghĩa");
                else labels.add(k);
            }
            if(runtimeChanged)labels.add("Dữ liệu giao diện");
            if(mediaChanged)labels.add("Hình / Bảng nguồn");
            if(labels.isEmpty())return "Không có dữ liệu mới.";
            StringBuilder b=new StringBuilder();
            for(int i=0;i<labels.size();i++){if(i>0)b.append("\n");b.append("• ").append(labels.get(i));}
            return b.toString();
        }
    }

    public static final String REMOTE_ROOT = "https://www.sachyhoc.com";
    public static final String OFFLINE_BASE = REMOTE_ROOT + "/wp-json/medipharm-reference/v1/offline/";
    public static final String MCR_BASE = REMOTE_ROOT + "/wp-json/medipharm-reference/v1/";
    public static final String MTP_BASE = REMOTE_ROOT + "/wp-json/medipharm-protocols/v1/";
    public static final String ICD_BASE = REMOTE_ROOT + "/wp-json/nah-icd10/v1/";
    public static final long MAX_OFFLINE_MS = 30L * 24L * 60L * 60L * 1000L;

    private static final String PREFS = "medref_session";
    private static final String PREF_LAST_AUTH = "last_auth_verified_at";

    private final Context context;
    private final File root;
    private final File active;
    private final File staging;
    private final File previous;
    private final File mediaCache;
    private final SharedPreferences prefs;

    public MedRefDataRuntime(Context context) {
        this.context = context.getApplicationContext();
        this.root = new File(this.context.getFilesDir(), "medref-data");
        this.active = new File(root, "active");
        this.staging = new File(root, "staging");
        this.previous = new File(root, "previous-good");
        this.mediaCache = new File(root, "verified-media-cache");
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void ensureReady() throws Exception {
        if (!root.exists() && !root.mkdirs()) throw new IOException("Không thể tạo thư mục dữ liệu MedRef.");
        if (!mediaCache.exists() && !mediaCache.mkdirs()) throw new IOException("Không thể tạo bộ nhớ đệm media MedRef.");
        if (active.exists() && !isValidDataset(active)) {
            if (previous.exists() && isValidDataset(previous)) {
                deleteRecursively(active);
                moveDirectory(previous, active);
            } else {
                deleteRecursively(active);
            }
        }
    }

    public boolean hasActiveData() { return isValidDataset(active); }
    public File getActiveDir() { return active; }
    public File getActiveDatabaseFile() { return new File(active, "medref.db"); }
    public boolean hasRollback() { return isValidDataset(previous); }

    public long lastAuthVerifiedAt() { return prefs.getLong(PREF_LAST_AUTH, 0L); }
    public boolean hasValidOfflineSession() {
        long last=lastAuthVerifiedAt();
        return hasActiveData() && last>0L && (System.currentTimeMillis()-last)<=MAX_OFFLINE_MS;
    }
    public void markAuthVerified() { prefs.edit().putLong(PREF_LAST_AUTH,System.currentTimeMillis()).apply(); }
    public void clearSession() { prefs.edit().remove(PREF_LAST_AUTH).apply(); }

    public String getDataVersion() {
        try { JSONObject m=readJson(new File(active,"data-manifest.json")); return m.optString("data_version","none"); }
        catch (Exception e) { return "none"; }
    }

    public JSONObject fetchRemoteManifest(String cookie, String nonce) throws Exception {
        return fetchJson(new URL(OFFLINE_BASE+"manifest"),cookie,nonce);
    }

    public synchronized JSONObject reauthenticate(String cookie,String nonce) throws Exception {
        JSONObject session=fetchJson(new URL(OFFLINE_BASE+"session"),cookie,nonce);
        if(!session.optBoolean("authenticated",false)) throw new SecurityException("Phiên MEDIPHARM chưa được xác thực.");
        markAuthVerified();
        return session;
    }

    public synchronized UpdatePlan checkForUpdates(String cookie,String nonce)throws Exception{
        JSONObject remote=fetchRemoteManifest(cookie,nonce);
        markAuthVerified();
        ArrayList<String> changed=new ArrayList<>();
        if(!hasActiveData()){
            for(String k:new String[]{"protocols","icd","pl3","yhct","guides","synonyms"})changed.add(k);
            return new UpdatePlan(remote,changed,true,true,true);
        }
        JSONObject local=readJson(new File(active,"data-manifest.json"));
        MedRefDatabase db=MedRefDatabase.openReadWrite(getActiveDatabaseFile());
        try{
            JSONObject remoteDs=remote.optJSONObject("datasets");
            JSONObject localDs=local.optJSONObject("datasets");
            for(String key:new String[]{"protocols","icd","pl3","yhct","guides","synonyms"}){
                JSONObject rd=remoteDs==null?null:remoteDs.optJSONObject(key);
                JSONObject ld=localDs==null?null:localDs.optJSONObject(key);
                if(rd==null)continue;
                String rr=rd.optString("revision","");
                String lr=ld==null?"":ld.optString("revision","");
                boolean different;
                if(!rr.isEmpty()&&!lr.isEmpty())different=!rr.equals(lr);
                else{
                    String compat=rd.optString("compat_signature","");
                    String localCompat=db.compatSignature(key);
                    if(!compat.isEmpty()&&!localCompat.isEmpty())different=!compat.equals(localCompat);
                    else different=rd.optInt("count",-1)!=db.datasetCount(key);
                }
                if(different)changed.add(key);
            }
        }finally{db.close();}
        String remoteMedia=remote.optString("media_catalog_sha256","");
        String localMedia=local.optString("media_catalog_sha256","");
        boolean mediaChanged=!remoteMedia.isEmpty()&&!remoteMedia.equals(localMedia);
        String remoteRuntime=remote.optString("runtime_revision","");
        String localRuntime=local.optString("runtime_revision","");
        boolean runtimeChanged;
        if(!remoteRuntime.isEmpty()&&!localRuntime.isEmpty())runtimeChanged=!remoteRuntime.equals(localRuntime);
        else runtimeChanged=changed.contains("protocols")||changed.contains("icd");
        UpdatePlan plan=new UpdatePlan(remote,changed,runtimeChanged,mediaChanged,false);
        if(!plan.hasChanges())mergeRemoteManifestMetadata(local,remote);
        return plan;
    }

    public synchronized boolean applyUpdate(UpdatePlan plan,String cookie,String nonce,ProgressListener listener)throws Exception{
        if(plan==null)return false;
        if(plan.fullHydrate){hydrateWithManifest(plan.remote,cookie,nonce,listener);return true;}
        if(!plan.hasChanges()){markAuthVerified();return false;}
        if(!plan.changedDatasets.isEmpty())refreshDatasetsWithManifest(plan.remote,plan.changedDatasets,cookie,nonce,listener);
        if(plan.runtimeChanged)refreshRuntimeFiles(cookie,nonce);
        if(plan.mediaChanged)refreshMediaWithManifest(plan.remote,cookie,nonce,listener);
        JSONObject local=readJson(new File(active,"data-manifest.json"));
        mergeRemoteManifestMetadata(local,plan.remote);
        markAuthVerified();
        return true;
    }

    public synchronized boolean syncIfChanged(String cookie,String nonce,ProgressListener listener)throws Exception{
        UpdatePlan plan=checkForUpdates(cookie,nonce);
        return applyUpdate(plan,cookie,nonce,listener);
    }

    public synchronized void fullHydrate(String cookie, String nonce, ProgressListener listener) throws Exception {
        JSONObject remote=fetchRemoteManifest(cookie,nonce);
        markAuthVerified();
        hydrateWithManifest(remote,cookie,nonce,listener);
    }

    private static int datasetCount(JSONObject manifest,String key,int fallback){
        JSONObject ds=manifest.optJSONObject("datasets");
        JSONObject item=ds==null?null:ds.optJSONObject(key);
        return item==null?fallback:item.optInt("count",fallback);
    }

    private void migrateLocalManifestVersion(JSONObject local,JSONObject remote,String wanted,String previousVersion)throws Exception{
        JSONObject migrated=new JSONObject(local.toString());
        migrated.put("data_version",wanted);
        migrated.put("legacy_migrated_from",previousVersion);
        migrated.put("manifest_migrated_at",System.currentTimeMillis());
        if(remote.has("media_catalog_sha256"))migrated.put("media_catalog_sha256",remote.optString("media_catalog_sha256",""));
        if(remote.has("media_catalog_version"))migrated.put("media_catalog_version",remote.optInt("media_catalog_version",0));
        if(remote.has("sync_mode"))migrated.put("sync_mode",remote.optString("sync_mode",""));
        writeJson(new File(active,"data-manifest.json"),migrated);
    }

    private void refreshDatasetsWithManifest(JSONObject remote,List<String> changed,String cookie,String nonce,ProgressListener listener)throws Exception{
        if(changed==null||changed.isEmpty())return;
        ArrayList<String> snapshot=new ArrayList<>(changed);
        if(snapshot.contains("protocols")){
            JSONObject datasets=remote.optJSONObject("datasets");
            JSONObject p=datasets==null?null:datasets.optJSONObject("protocols");
            if(p!=null&&"index-v1".equals(p.optString("delta_mode",""))&&!p.optString("index_url","").isEmpty()&&!p.optString("batch_url","").isEmpty()){
                refreshProtocolsDelta(remote,p,cookie,nonce,listener);
                snapshot.remove("protocols");
            }
        }
        if(snapshot.isEmpty())return;
        MedRefDatabase db=MedRefDatabase.openReadWrite(getActiveDatabaseFile());
        Progress progress=new Progress(remote,listener,snapshot);
        try{
            db.begin();
            for(String key:snapshot){
                db.clearDataset(key);
                if("protocols".equals(key))hydrateDataset(remote,key,cookie,nonce,progress,(row)->db.insertProtocol(row));
                else if("icd".equals(key))hydrateDataset(remote,key,cookie,nonce,progress,(row)->db.insertIcd(row));
                else if("pl3".equals(key))hydrateDataset(remote,key,cookie,nonce,progress,(row)->db.insertPl3(row));
                else if("yhct".equals(key))hydrateDataset(remote,key,cookie,nonce,progress,(row)->db.insertYhct(row));
                else if("guides".equals(key))hydrateDataset(remote,key,cookie,nonce,progress,(row)->db.insertGuide(row));
                else if("synonyms".equals(key))hydrateDataset(remote,key,cookie,nonce,progress,(row)->db.insertSynonym(row));
                int expected=datasetCount(remote,key,-1),actual=db.datasetCount(key);
                if(expected>=0&&expected!=actual)throw new IOException("Count mismatch "+key+": "+actual+"/"+expected);
            }
            db.success();
        }finally{db.end();db.close();}
    }

    private void refreshProtocolsDelta(JSONObject remote,JSONObject descriptor,String cookie,String nonce,ProgressListener listener)throws Exception{
        Map<String,String> remoteIndex=fetchProtocolIndex(descriptor,cookie,nonce);
        MedRefDatabase db=MedRefDatabase.openReadWrite(getActiveDatabaseFile());
        Map<String,String> localIndex;
        try{localIndex=db.protocolRevisionMap();}finally{db.close();}

        ArrayList<String> changedSlugs=new ArrayList<>();
        ArrayList<String> removedSlugs=new ArrayList<>();
        for(Map.Entry<String,String> e:remoteIndex.entrySet()){
            String localUpdated=localIndex.get(e.getKey());
            if(localUpdated==null||!e.getValue().equals(localUpdated))changedSlugs.add(e.getKey());
        }
        for(String slug:localIndex.keySet())if(!remoteIndex.containsKey(slug))removedSlugs.add(slug);

        int totalOps=changedSlugs.size()+removedSlugs.size();
        if(totalOps==0)return;
        if(listener!=null)listener.onProgress(1,"Đang chuẩn bị cập nhật "+totalOps+" phác đồ/quy trình thay đổi…");

        int batchSize=Math.max(1,Math.min(30,descriptor.optInt("batch_size",20)));
        ArrayList<JSONObject> details=new ArrayList<>();
        for(int offset=0;offset<changedSlugs.size();offset+=batchSize){
            int end=Math.min(changedSlugs.size(),offset+batchSize);
            List<String> chunk=changedSlugs.subList(offset,end);
            JSONArray rows=fetchProtocolBatch(descriptor,chunk,cookie,nonce);
            for(int i=0;i<rows.length();i++){
                JSONObject row=rows.optJSONObject(i);
                if(row!=null&&!row.optString("slug","").isEmpty())details.add(row);
            }
            int pct=Math.min(70,(int)Math.floor(end*70.0/Math.max(1,changedSlugs.size())));
            if(listener!=null)listener.onProgress(Math.max(2,pct),"Đã nhận "+end+"/"+changedSlugs.size()+" phác đồ/quy trình thay đổi…");
        }
        if(details.size()!=changedSlugs.size())throw new IOException("Protocol delta thiếu dữ liệu: "+details.size()+"/"+changedSlugs.size());

        db=MedRefDatabase.openReadWrite(getActiveDatabaseFile());
        try{
            db.begin();
            int done=0;
            for(String slug:removedSlugs){
                db.deleteProtocol(slug);done++;
                if(listener!=null)listener.onProgress(70+(int)Math.floor(done*29.0/Math.max(1,totalOps)),"Đang loại bỏ nội dung không còn hiệu lực…");
            }
            for(JSONObject row:details){
                db.insertProtocol(row);done++;
                if(listener!=null)listener.onProgress(70+(int)Math.floor(done*29.0/Math.max(1,totalOps)),"Đang ghi phác đồ/quy trình mới vào thiết bị…");
            }
            int expected=datasetCount(remote,"protocols",-1),actual=db.datasetCount("protocols");
            if(expected>=0&&expected!=actual)throw new IOException("Count mismatch protocols delta: "+actual+"/"+expected);
            db.success();
        }finally{db.end();db.close();}
        if(listener!=null)listener.onProgress(99,"Đã cập nhật "+details.size()+" mục và loại bỏ "+removedSlugs.size()+" mục.");
    }

    private Map<String,String> fetchProtocolIndex(JSONObject descriptor,String cookie,String nonce)throws Exception{
        String url=descriptor.optString("index_url","");
        if(!url.startsWith("https://"))throw new IOException("Protocol delta index URL không hợp lệ.");
        int limit=500,offset=0;
        HashMap<String,String> out=new HashMap<>();
        do{
            JSONObject page=fetchJson(new URL(url+(url.contains("?")?"&":"?")+"limit="+limit+"&offset="+offset),cookie,nonce);
            JSONArray rows=page.optJSONArray("results");if(rows==null)rows=new JSONArray();
            for(int i=0;i<rows.length();i++){
                JSONObject row=rows.optJSONObject(i);if(row==null)continue;
                String slug=row.optString("slug",""),updated=row.optString("updated_at","");
                if(!slug.isEmpty())out.put(slug,updated);
            }
            offset=page.optInt("next_offset",offset+rows.length());
            if(!page.optBoolean("has_more",false))break;
            if(rows.length()==0)throw new IOException("Protocol delta index trả về trang rỗng trước khi hoàn tất.");
        }while(true);
        int expected=descriptor.optInt("count",-1);
        if(expected>=0&&out.size()!=expected)throw new IOException("Protocol index count mismatch: "+out.size()+"/"+expected);
        return out;
    }

    private JSONArray fetchProtocolBatch(JSONObject descriptor,List<String> slugs,String cookie,String nonce)throws Exception{
        String base=descriptor.optString("batch_url","");
        if(!base.startsWith("https://"))throw new IOException("Protocol delta batch URL không hợp lệ.");
        StringBuilder joined=new StringBuilder();
        for(String slug:slugs){if(joined.length()>0)joined.append(',');joined.append(slug);}
        String url=base+(base.contains("?")?"&":"?")+"slugs="+URLEncoder.encode(joined.toString(),StandardCharsets.UTF_8.name());
        JSONObject payload=fetchJson(new URL(url),cookie,nonce);
        JSONArray rows=payload.optJSONArray("results");return rows==null?new JSONArray():rows;
    }

    private void refreshRuntimeFiles(String cookie,String nonce)throws Exception{
        writeJson(new File(active,"dashboard.json"),fetchJson(new URL(MCR_BASE+"dashboard"),cookie,nonce));
        writeJson(new File(active,"specialties-protocol.json"),fetchJson(new URL(MTP_BASE+"specialties?content_type=protocol"),cookie,nonce));
        writeJson(new File(active,"specialties-procedure.json"),fetchJson(new URL(MTP_BASE+"specialties?content_type=procedure"),cookie,nonce));
        writeJson(new File(active,"status.json"),fetchJson(new URL(MTP_BASE+"status"),cookie,nonce));
        writeJson(new File(active,"icd-stats.json"),fetchJson(new URL(ICD_BASE+"stats"),cookie,nonce));
    }

    private void mergeRemoteManifestMetadata(JSONObject local,JSONObject remote)throws Exception{
        for(String k:new String[]{"schema","snapshot_schema","data_version","legacy_data_version","web_version","media_catalog_version","media_catalog_sha256","media_content_drifted_count","minimum_app_version_code","max_offline_days","sync_mode","dataset_revision_schema","runtime_revision","future_delta_schema"}){
            if(remote.has(k))local.put(k,remote.opt(k));
        }
        if(remote.has("dataset_revisions"))local.put("dataset_revisions",new JSONObject(remote.getJSONObject("dataset_revisions").toString()));
        if(remote.has("datasets"))local.put("datasets",new JSONObject(remote.getJSONObject("datasets").toString()));
        MedRefDatabase db=MedRefDatabase.openReadWrite(getActiveDatabaseFile());
        try{local.put("counts_effective",db.counts());}finally{db.close();}
        local.put("app_version",BuildConfig.VERSION_NAME);
        local.put("app_version_code",BuildConfig.VERSION_CODE);
        local.put("last_checked_at",System.currentTimeMillis());
        writeJson(new File(active,"data-manifest.json"),local);
    }

    private void refreshMediaWithManifest(JSONObject remote,String cookie,String nonce,ProgressListener listener)throws Exception{
        File activeMedia=new File(active,"media");
        if(!activeMedia.exists()&&!activeMedia.mkdirs())throw new IOException("Không tạo được thư mục media.");
        JSONObject ds=remote.getJSONObject("datasets").getJSONObject("media");
        List<JSONObject> items=fetchMediaCatalog(ds,cookie,nonce);
        List<JSONObject> changed=new ArrayList<>();
        for(JSONObject item:items){
            MediaDescriptor d=mediaDescriptor(item);
            File target=new File(activeMedia,d.fileName);
            if(!(target.isFile()&&d.sha.equals(sha256(target))))changed.add(item);
        }
        if(changed.isEmpty())return;
        Progress progress=new Progress(remote,listener,changed.size());
        hydrateMediaParallel(changed,cookie,nonce,activeMedia,progress);
        progress.done();
    }

    private void hydrateWithManifest(JSONObject manifest,String cookie,String nonce,ProgressListener listener)throws Exception{
        if(!"medref-offline-manifest/v1".equals(manifest.optString("schema"))) throw new IllegalArgumentException("Máy chủ chưa cung cấp manifest MedRef tương thích.");
        if(manifest.optInt("minimum_app_version_code",10000)>BuildConfig.VERSION_CODE) throw new IllegalStateException("Cần cập nhật ứng dụng MedRef trước khi đồng bộ dữ liệu.");
        deleteRecursively(staging); if(!staging.mkdirs()) throw new IOException("Không tạo được staging.");
        File mediaDir=new File(staging,"media"); if(!mediaDir.mkdirs()) throw new IOException("Không tạo được media staging.");
        MedRefDatabase db=MedRefDatabase.create(new File(staging,"medref.db"));
        Progress progress=new Progress(manifest,listener);
        try{
            db.begin();
            hydrateDataset(manifest,"protocols",cookie,nonce,progress,(row)->db.insertProtocol(row));
            hydrateDataset(manifest,"icd",cookie,nonce,progress,(row)->db.insertIcd(row));
            hydrateDataset(manifest,"pl3",cookie,nonce,progress,(row)->db.insertPl3(row));
            hydrateDataset(manifest,"yhct",cookie,nonce,progress,(row)->db.insertYhct(row));
            hydrateDataset(manifest,"guides",cookie,nonce,progress,(row)->db.insertGuide(row));
            hydrateDataset(manifest,"synonyms",cookie,nonce,progress,(row)->db.insertSynonym(row));
            db.success();
        } finally { db.end(); }

        saveRuntimeJson("dashboard.json",fetchJson(new URL(MCR_BASE+"dashboard"),cookie,nonce));
        saveRuntimeJson("specialties-protocol.json",fetchJson(new URL(MTP_BASE+"specialties?content_type=protocol"),cookie,nonce));
        saveRuntimeJson("specialties-procedure.json",fetchJson(new URL(MTP_BASE+"specialties?content_type=procedure"),cookie,nonce));
        saveRuntimeJson("status.json",fetchJson(new URL(MTP_BASE+"status"),cookie,nonce));
        saveRuntimeJson("icd-stats.json",fetchJson(new URL(ICD_BASE+"stats"),cookie,nonce));

        hydrateMedia(manifest,cookie,nonce,mediaDir,progress);

        JSONObject counts=db.counts();
        db.close();
        validateCounts(manifest,counts);
        JSONObject local=new JSONObject(manifest.toString());
        local.put("installed_at",System.currentTimeMillis());
        local.put("app_version",BuildConfig.VERSION_NAME);
        local.put("app_version_code",BuildConfig.VERSION_CODE);
        local.put("counts_effective",counts);
        local.put("media_complete",true);
        writeJson(new File(staging,"data-manifest.json"),local);
        if(!isValidDataset(staging)) throw new IOException("Staging dataset không hợp lệ.");
        activateStaging();
        progress.done();
    }

    private interface RowConsumer { void accept(JSONObject row) throws Exception; }

    private void hydrateDataset(JSONObject manifest,String key,String cookie,String nonce,Progress progress,RowConsumer consumer)throws Exception{
        JSONObject ds=manifest.getJSONObject("datasets").getJSONObject(key);
        String url=ds.getString("url");int page=Math.max(1,ds.optInt("page_size",100)),offset=0;
        do{
            JSONObject payload=fetchJson(new URL(url+(url.contains("?")?"&":"?")+"limit="+page+"&offset="+offset),cookie,nonce);
            JSONArray rows=payload.optJSONArray("results"); if(rows==null)rows=new JSONArray();
            for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null){consumer.accept(row);progress.advance(key);}}
            offset=payload.optInt("next_offset",offset+rows.length());
            if(!payload.optBoolean("has_more",false))break;
            if(rows.length()==0)throw new IOException("Dataset "+key+" trả về trang rỗng trước khi hoàn tất.");
        }while(true);
    }

    private void hydrateMedia(JSONObject manifest,String cookie,String nonce,File mediaDir,Progress progress)throws Exception{
        JSONObject ds=manifest.getJSONObject("datasets").getJSONObject("media");
        List<JSONObject> items=fetchMediaCatalog(ds,cookie,nonce);
        String bundleUrl=ds.optString("bundle_url","");
        int bundleSize=Math.max(1,Math.min(100,ds.optInt("bundle_page_size",50)));
        if(bundleUrl.startsWith("https://") && !items.isEmpty()){
            hydrateMediaBundles(items,bundleUrl,bundleSize,cookie,nonce,mediaDir,progress);
            return;
        }
        hydrateMediaParallel(items,cookie,nonce,mediaDir,progress);
    }

    private List<JSONObject> fetchMediaCatalog(JSONObject ds,String cookie,String nonce)throws Exception{
        String url=ds.getString("url");int page=Math.max(1,ds.optInt("page_size",250)),offset=0;
        List<JSONObject> items=new ArrayList<>();
        do{
            JSONObject payload=fetchJson(new URL(url+(url.contains("?")?"&":"?")+"limit="+page+"&offset="+offset),cookie,nonce);
            JSONArray rows=payload.optJSONArray("results");if(rows==null)rows=new JSONArray();
            for(int i=0;i<rows.length();i++){JSONObject item=rows.optJSONObject(i);if(item!=null)items.add(item);}
            offset=payload.optInt("next_offset",offset+rows.length());
            if(!payload.optBoolean("has_more",false))break;
            if(rows.length()==0)throw new IOException("Media catalog trả về trang rỗng trước khi hoàn tất.");
        }while(true);
        return items;
    }

    private void hydrateMediaBundles(List<JSONObject> items,String bundleUrl,int bundleSize,String cookie,String nonce,File mediaDir,Progress progress)throws Exception{
        for(int offset=0;offset<items.size();offset+=bundleSize){
            int end=Math.min(items.size(),offset+bundleSize);
            List<JSONObject> chunk=items.subList(offset,end);
            boolean allReusable=true;
            for(JSONObject item:chunk){
                MediaDescriptor d=mediaDescriptor(item);
                File target=new File(mediaDir,d.fileName);
                if(target.isFile()&&d.sha.equals(sha256(target)))continue;
                File reusable=findReusableMedia(d.fileName,d.sha);
                if(reusable!=null)copyFile(reusable,target); else allReusable=false;
            }
            if(allReusable){
                for(JSONObject item:chunk)progress.advance("media");
                continue;
            }

            File bundleDir=new File(mediaCache,"bundles");if(!bundleDir.exists()&&!bundleDir.mkdirs())throw new IOException("Không tạo được bộ nhớ đệm bundle.");
            File bundle=new File(bundleDir,"media-"+offset+"-"+(end-offset)+".zip");
            String u=bundleUrl+(bundleUrl.contains("?")?"&":"?")+"offset="+offset+"&limit="+(end-offset);
            downloadToFileWithRetry(new URL(u),bundle,cookie,nonce,3,300000);
            extractMediaBundle(bundle,chunk,cookie,nonce,mediaDir,progress);
            if(bundle.exists())bundle.delete();
        }
    }

    private void extractMediaBundle(File bundle,List<JSONObject> chunk,String cookie,String nonce,File mediaDir,Progress progress)throws Exception{
        Map<String,MediaDescriptor> expected=new HashMap<>();
        Set<String> counted=new HashSet<>();
        for(JSONObject item:chunk){MediaDescriptor d=mediaDescriptor(item);expected.put(d.fileName,d);}
        try(ZipInputStream zin=new ZipInputStream(new BufferedInputStream(new FileInputStream(bundle)))){
            ZipEntry entry;
            while((entry=zin.getNextEntry())!=null){
                String name=entry.getName();
                if(entry.isDirectory()||"bundle-manifest.json".equals(name)){zin.closeEntry();continue;}
                if(name.contains("/")||name.contains("\\")||name.contains(".."))throw new SecurityException("Media bundle chứa đường dẫn không hợp lệ.");
                MediaDescriptor d=expected.get(name);if(d==null){zin.closeEntry();continue;}
                File target=new File(mediaDir,d.fileName);
                if(target.isFile()&&d.sha.equals(sha256(target))){
                    counted.add(d.fileName);progress.advance("media");zin.closeEntry();continue;
                }
                File cacheTarget=new File(mediaCache,d.fileName);
                boolean valid=cacheTarget.isFile()&&d.sha.equals(sha256(cacheTarget));
                if(!valid){
                    File tmp=new File(mediaCache,d.fileName+".part");
                    try(FileOutputStream raw=new FileOutputStream(tmp);BufferedOutputStream out=new BufferedOutputStream(raw)){
                        byte[] buf=new byte[128*1024];int n;while((n=zin.read(buf))!=-1)out.write(buf,0,n);out.flush();raw.getFD().sync();
                    }
                    if(!d.sha.equals(sha256(tmp))){tmp.delete();throw new SecurityException("SHA-256 media không khớp: "+d.fileName);}
                    Files.move(tmp.toPath(),cacheTarget.toPath(),StandardCopyOption.REPLACE_EXISTING);
                }
                copyFile(cacheTarget,target);
                counted.add(d.fileName);progress.advance("media");
                zin.closeEntry();
            }
        }
        for(JSONObject item:chunk){
            MediaDescriptor d=mediaDescriptor(item);
            if(counted.contains(d.fileName))continue;
            File target=new File(mediaDir,d.fileName);
            if(target.isFile()&&d.sha.equals(sha256(target))){progress.advance("media");continue;}
            downloadMediaItem(d,cookie,nonce,mediaDir,progress);
        }
    }

    private void hydrateMediaParallel(List<JSONObject> items,String cookie,String nonce,File mediaDir,Progress progress)throws Exception{
        int workers=Math.max(1,Math.min(4,items.size()));
        ExecutorService pool=Executors.newFixedThreadPool(workers);
        List<Future<?>> futures=new ArrayList<>();
        try{
            for(JSONObject item:items){
                final MediaDescriptor d=mediaDescriptor(item);
                futures.add(pool.submit(()->{
                    try{downloadMediaItem(d,cookie,nonce,mediaDir,progress);}
                    catch(Exception e){throw new RuntimeException(e);}
                }));
            }
            for(Future<?> f:futures){
                try{f.get();}
                catch(ExecutionException e){Throwable c=e.getCause();if(c instanceof RuntimeException&&c.getCause()!=null)c=c.getCause();if(c instanceof Exception)throw (Exception)c;throw new IOException("Không thể tải media.",c);}
            }
        }finally{pool.shutdownNow();}
    }

    private void downloadMediaItem(MediaDescriptor d,String cookie,String nonce,File mediaDir,Progress progress)throws Exception{
        File target=new File(mediaDir,d.fileName);
        if(target.isFile()&&d.sha.equals(sha256(target))){progress.advance("media");return;}
        File reusable=findReusableMedia(d.fileName,d.sha);
        if(reusable!=null){copyFile(reusable,target);progress.advance("media");return;}
        File cacheTarget=new File(mediaCache,d.fileName);
        downloadToFileWithRetry(new URL(d.remote),cacheTarget,cookie,nonce,3,180000);
        if(!d.sha.equals(sha256(cacheTarget))){cacheTarget.delete();throw new SecurityException("SHA-256 media không khớp: "+d.fileName);}
        copyFile(cacheTarget,target);progress.advance("media");
    }

    private MediaDescriptor mediaDescriptor(JSONObject item)throws Exception{
        String sha=item.optString("sha256","").toLowerCase(Locale.ROOT),remote=item.optString("url",""),fileName=item.optString("file_name","");
        if(!sha.matches("[a-f0-9]{64}")||!remote.startsWith("https://")||fileName.isEmpty()||fileName.contains("/")||fileName.contains(".."))throw new SecurityException("Media descriptor không hợp lệ.");
        return new MediaDescriptor(sha,remote,fileName,item.optLong("bytes",-1L));
    }

    private static final class MediaDescriptor{
        final String sha,remote,fileName;final long bytes;
        MediaDescriptor(String sha,String remote,String fileName,long bytes){this.sha=sha;this.remote=remote;this.fileName=fileName;this.bytes=bytes;}
    }

    private File findReusableMedia(String name,String sha)throws Exception{
        File f=new File(new File(active,"media"),name);if(f.isFile()&&sha.equals(sha256(f)))return f;
        f=new File(new File(previous,"media"),name);if(f.isFile()&&sha.equals(sha256(f)))return f;
        f=new File(mediaCache,name);if(f.isFile()){if(sha.equals(sha256(f)))return f;else f.delete();}
        return null;
    }

    private void saveRuntimeJson(String name,JSONObject json)throws Exception{writeJson(new File(staging,name),json);}

    private void validateCounts(JSONObject manifest,JSONObject counts)throws Exception{
        JSONObject ds=manifest.getJSONObject("datasets");
        for(String key:new String[]{"protocols","icd","pl3","yhct","guides","synonyms"}){
            int expected=ds.getJSONObject(key).optInt("count",-1),actual=counts.optInt(key,-2);
            if(expected>=0&&expected!=actual)throw new IOException("Count mismatch "+key+": "+actual+"/"+expected);
        }
    }

    public synchronized void rollback() throws Exception {
        if(!isValidDataset(previous))throw new IllegalStateException("Không có dữ liệu previous-good.");
        File temp=new File(root,"rollback-temp");deleteRecursively(temp);if(active.exists())moveDirectory(active,temp);moveDirectory(previous,active);if(temp.exists())moveDirectory(temp,previous);
    }

    private void activateStaging()throws Exception{
        deleteRecursively(previous);if(active.exists())moveDirectory(active,previous);try{moveDirectory(staging,active);}catch(Exception e){if(previous.exists()&&!active.exists())moveDirectory(previous,active);throw e;}
    }

    private boolean isValidDataset(File dir){return dir!=null&&dir.isDirectory()&&new File(dir,"medref.db").isFile()&&new File(dir,"data-manifest.json").isFile();}

    public JSONObject fetchJson(URL url,String cookie,String nonce)throws Exception{
        HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setConnectTimeout(12000);c.setReadTimeout(60000);c.setInstanceFollowRedirects(true);c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","MedRefAndroid/"+BuildConfig.VERSION_NAME);
        if(cookie!=null&&!cookie.trim().isEmpty())c.setRequestProperty("Cookie",cookie);if(nonce!=null&&!nonce.trim().isEmpty())c.setRequestProperty("X-WP-Nonce",nonce);
        try{int status=c.getResponseCode();InputStream in=status>=200&&status<300?c.getInputStream():c.getErrorStream();String body=in==null?"":new String(readAll(in),StandardCharsets.UTF_8);if(status<200||status>=300)throw new IOException("HTTP "+status+" "+body.substring(0,Math.min(240,body.length())));return new JSONObject(body);}finally{c.disconnect();}
    }

    private void downloadToFile(URL url,File target,String cookie,String nonce)throws Exception{
        downloadToFileWithRetry(url,target,cookie,nonce,1,180000);
    }

    private void downloadToFileWithRetry(URL url,File target,String cookie,String nonce,int maxAttempts,int readTimeoutMs)throws Exception{
        Exception last=null;
        for(int attempt=1;attempt<=Math.max(1,maxAttempts);attempt++){
            try{downloadToFileOnce(url,target,cookie,nonce,readTimeoutMs);return;}
            catch(Exception e){last=e;if(attempt>=maxAttempts)break;try{Thread.sleep(700L*(1L<<(attempt-1)));}catch(InterruptedException ie){Thread.currentThread().interrupt();throw ie;}}
        }
        throw last==null?new IOException("Media download failed"):last;
    }

    private void downloadToFileOnce(URL url,File target,String cookie,String nonce,int readTimeoutMs)throws Exception{
        File parent=target.getParentFile();if(parent!=null&&!parent.exists()&&!parent.mkdirs())throw new IOException("Không tạo được thư mục media.");
        File tmp=new File(parent,target.getName()+".part");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setConnectTimeout(20000);c.setReadTimeout(Math.max(60000,readTimeoutMs));c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent","MedRefAndroid/"+BuildConfig.VERSION_NAME);c.setRequestProperty("Accept-Encoding","identity");c.setRequestProperty("Connection","keep-alive");
        if(cookie!=null&&!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);if(nonce!=null&&!nonce.isEmpty())c.setRequestProperty("X-WP-Nonce",nonce);
        try{
            int status=c.getResponseCode();if(status<200||status>=300)throw new IOException("Media HTTP "+status);
            try(InputStream in=new BufferedInputStream(c.getInputStream());FileOutputStream raw=new FileOutputStream(tmp);BufferedOutputStream out=new BufferedOutputStream(raw)){
                byte[]buf=new byte[128*1024];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);out.flush();raw.getFD().sync();
            }
        }finally{c.disconnect();}
        Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);
    }

    private static byte[] readAll(InputStream in)throws IOException{try(InputStream x=in;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[]b=new byte[16384];int n;while((n=x.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
    private static JSONObject readJson(File f)throws Exception{try(InputStream in=new FileInputStream(f)){return new JSONObject(new String(readAll(in),StandardCharsets.UTF_8));}}
    private static void writeJson(File f,JSONObject j)throws Exception{File p=f.getParentFile();if(p!=null&&!p.exists()&&!p.mkdirs())throw new IOException("mkdir failed");try(FileOutputStream raw=new FileOutputStream(f);BufferedOutputStream out=new BufferedOutputStream(raw)){out.write((j.toString()+"\n").getBytes(StandardCharsets.UTF_8));out.flush();raw.getFD().sync();}}
    private static void copyFile(File src,File dst)throws Exception{File p=dst.getParentFile();if(p!=null&&!p.exists()&&!p.mkdirs())throw new IOException("mkdir failed");Files.copy(src.toPath(),dst.toPath(),StandardCopyOption.REPLACE_EXISTING);}
    private static String sha256(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new BufferedInputStream(new FileInputStream(f))){byte[]b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte x:d.digest())s.append(String.format(Locale.ROOT,"%02x",x&0xff));return s.toString();}
    private static void moveDirectory(File src,File dst)throws Exception{if(dst.exists())deleteRecursively(dst);File p=dst.getParentFile();if(p!=null&&!p.exists())p.mkdirs();try{Files.move(src.toPath(),dst.toPath(),StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(src.toPath(),dst.toPath(),StandardCopyOption.REPLACE_EXISTING);}}
    private static void deleteRecursively(File f)throws IOException{if(f==null||!f.exists())return;if(f.isDirectory()){File[]kids=f.listFiles();if(kids!=null)for(File k:kids)deleteRecursively(k);}if(!f.delete()&&f.exists())throw new IOException("Không xóa được "+f);}

    private static final class Progress{
        final ProgressListener listener;final int total;final int mediaTotal;int done=0;int mediaDone=0;
        Progress(JSONObject m,ProgressListener l){this(m,l,(List<String>)null);}
        Progress(JSONObject m,ProgressListener l,boolean mediaOnly){this(m,l,mediaOnly?Math.max(0,datasetCount(m,"media",0)):-1);}
        Progress(JSONObject m,ProgressListener l,int mediaWork){listener=l;mediaTotal=Math.max(0,mediaWork);total=Math.max(1,mediaTotal);emit(0,"Đang cập nhật hình/bảng nguồn…");}
        Progress(JSONObject m,ProgressListener l,List<String> only){
            listener=l;int t=0;JSONObject d=m.optJSONObject("datasets");
            if(only==null){if(d!=null)for(String k:new String[]{"protocols","icd","pl3","yhct","guides","synonyms","media"})t+=d.optJSONObject(k)==null?0:d.optJSONObject(k).optInt("count",0);}
            else if(d!=null)for(String k:only)t+=d.optJSONObject(k)==null?0:d.optJSONObject(k).optInt("count",0);
            mediaTotal=d!=null&&d.optJSONObject("media")!=null?d.optJSONObject("media").optInt("count",0):0;
            total=Math.max(1,t);emit(0,only==null?"Đang chuẩn bị dữ liệu offline…":"Đang cập nhật dữ liệu mới…");
        }
        synchronized void advance(String key){done++;String label;if("media".equals(key)){mediaDone++;label="Đang tải hình/bảng nguồn "+mediaDone+"/"+Math.max(mediaTotal,mediaDone)+"…";}else label="Đang cập nhật "+datasetLabel(key)+"…";emit(Math.min(99,(int)Math.floor(done*100.0/total)),label);}
        synchronized void done(){emit(100,"Dữ liệu MedRef đã được cập nhật.");}
        void emit(int p,String m){if(listener!=null)listener.onProgress(p,m);}
        static String datasetLabel(String k){if("protocols".equals(k))return"phác đồ / quy trình";if("icd".equals(k))return"ICD-10";if("pl3".equals(k))return"danh mục thuốc";if("yhct".equals(k))return"YHCT";if("guides".equals(k))return"hướng dẫn";if("synonyms".equals(k))return"từ đồng nghĩa";return k;}
    }}
