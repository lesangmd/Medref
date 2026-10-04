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
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;

public final class MedRefDataRuntime {
    public interface ProgressListener { void onProgress(int percent, String message); }

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
    private final SharedPreferences prefs;

    public MedRefDataRuntime(Context context) {
        this.context = context.getApplicationContext();
        this.root = new File(this.context.getFilesDir(), "medref-data");
        this.active = new File(root, "active");
        this.staging = new File(root, "staging");
        this.previous = new File(root, "previous-good");
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void ensureReady() throws Exception {
        if (!root.exists() && !root.mkdirs()) throw new IOException("Không thể tạo thư mục dữ liệu MedRef.");
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

    public synchronized boolean syncIfChanged(String cookie, String nonce, ProgressListener listener) throws Exception {
        JSONObject remote=fetchRemoteManifest(cookie,nonce);
        markAuthVerified();
        String wanted=remote.optString("data_version","");
        if(hasActiveData() && wanted.equals(getDataVersion())) return false;
        hydrateWithManifest(remote,cookie,nonce,listener);
        return true;
    }

    public synchronized void fullHydrate(String cookie, String nonce, ProgressListener listener) throws Exception {
        JSONObject remote=fetchRemoteManifest(cookie,nonce);
        markAuthVerified();
        hydrateWithManifest(remote,cookie,nonce,listener);
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
        JSONObject ds=manifest.getJSONObject("datasets").getJSONObject("media");String url=ds.getString("url");int page=Math.max(1,ds.optInt("page_size",250)),offset=0;
        do{
            JSONObject payload=fetchJson(new URL(url+(url.contains("?")?"&":"?")+"limit="+page+"&offset="+offset),cookie,nonce);
            JSONArray rows=payload.optJSONArray("results");if(rows==null)rows=new JSONArray();
            for(int i=0;i<rows.length();i++){
                JSONObject item=rows.optJSONObject(i);if(item==null)continue;String sha=item.optString("sha256","").toLowerCase(Locale.ROOT),remote=item.optString("url",""),fileName=item.optString("file_name","");
                if(!sha.matches("[a-f0-9]{64}")||!remote.startsWith("https://")||fileName.contains("/")||fileName.contains(".."))throw new SecurityException("Media descriptor không hợp lệ.");
                File target=new File(mediaDir,fileName);File existing=findReusableMedia(fileName,sha);
                if(existing!=null)copyFile(existing,target);else downloadToFile(new URL(remote),target,cookie,nonce);
                if(!sha.equals(sha256(target)))throw new SecurityException("SHA-256 media không khớp: "+fileName);
                progress.advance("media");
            }
            offset=payload.optInt("next_offset",offset+rows.length());if(!payload.optBoolean("has_more",false))break;if(rows.length()==0)throw new IOException("Media catalog trả về trang rỗng trước khi hoàn tất.");
        }while(true);
    }

    private File findReusableMedia(String name,String sha)throws Exception{
        File f=new File(new File(active,"media"),name);if(f.isFile()&&sha.equals(sha256(f)))return f;
        f=new File(new File(previous,"media"),name);if(f.isFile()&&sha.equals(sha256(f)))return f;return null;
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
        File parent=target.getParentFile();if(parent!=null&&!parent.exists()&&!parent.mkdirs())throw new IOException("Không tạo được thư mục media.");File tmp=new File(parent,target.getName()+".part");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setConnectTimeout(12000);c.setReadTimeout(60000);c.setInstanceFollowRedirects(true);c.setRequestProperty("User-Agent","MedRefAndroid/"+BuildConfig.VERSION_NAME);if(cookie!=null&&!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);if(nonce!=null&&!nonce.isEmpty())c.setRequestProperty("X-WP-Nonce",nonce);
        try{int status=c.getResponseCode();if(status<200||status>=300)throw new IOException("Media HTTP "+status);try(InputStream in=new BufferedInputStream(c.getInputStream());FileOutputStream raw=new FileOutputStream(tmp);BufferedOutputStream out=new BufferedOutputStream(raw)){byte[]buf=new byte[64*1024];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);out.flush();raw.getFD().sync();}}finally{c.disconnect();}
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
        final ProgressListener listener;final int total;int done=0;
        Progress(JSONObject m,ProgressListener l){listener=l;int t=0;JSONObject d=m.optJSONObject("datasets");if(d!=null)for(String k:new String[]{"protocols","icd","pl3","yhct","guides","synonyms","media"})t+=d.optJSONObject(k)==null?0:d.optJSONObject(k).optInt("count",0);total=Math.max(1,t);emit(0,"Đang chuẩn bị dữ liệu offline…");}
        void advance(String key){done++;String label="media".equals(key)?"Đang tải hình/bảng nguồn…":"Đang đồng bộ "+key+"…";emit(Math.min(99,(int)Math.floor(done*100.0/total)),label);}
        void done(){emit(100,"Dữ liệu offline đã sẵn sàng.");}
        void emit(int p,String m){if(listener!=null)listener.onProgress(p,m);}
    }
}
