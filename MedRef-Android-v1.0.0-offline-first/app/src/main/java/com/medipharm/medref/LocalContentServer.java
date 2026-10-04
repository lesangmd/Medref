package com.medipharm.medref;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class LocalContentServer {
    public static final String HOST="app.medref.local";
    public static final String ORIGIN="https://"+HOST;
    private static final Pattern SOURCE_MEDIA_PATTERN=Pattern.compile("(?i)mcr-source-([a-f0-9]{64})(?:-(?:\\d+x\\d+|scaled|rotated|\\d+))*\\.(png|jpe?g|gif|webp)$");
    private final Context context;
    private final MedRefDataRuntime runtime;
    private MedRefDatabase database;

    public LocalContentServer(Context context,MedRefDataRuntime runtime)throws Exception{this.context=context.getApplicationContext();this.runtime=runtime;reload();}
    public synchronized void reload()throws Exception{if(database!=null)database.close();database=runtime.hasActiveData()?MedRefDatabase.openReadWrite(runtime.getActiveDatabaseFile()):null;}
    public synchronized void close(){if(database!=null){database.close();database=null;}}

    public synchronized WebResourceResponse intercept(Uri uri){
        if(uri==null||uri.getHost()==null)return null;
        try{
            String host=uri.getHost().toLowerCase(Locale.ROOT);
            File localMedia=resolveLocalSourceMedia(uri);
            if(localMedia!=null)return response(200,"OK",mime(localMedia.getName()),null,new FileInputStream(localMedia));
            if(!HOST.equalsIgnoreCase(host))return null;
            String path=normalize(uri.getPath());if(path==null)return notFound();
            if(path.equals("/")||path.equals("/index.html")||path.equals("/medipharm/")||path.startsWith("/medipharm/?"))return asset("web/index.html","text/html");
            if(path.startsWith("/assets/"))return asset("web"+path,mime(path));
            if(path.startsWith("/wp-json/"))return api(path,uri);
            return notFound();
        }catch(Exception e){return json(error("offline_error",e.getMessage()),500,"Offline Error");}
    }

    private WebResourceResponse api(String path,Uri uri)throws Exception{
        if(database==null)return json(error("no_offline_data","Dữ liệu offline chưa sẵn sàng."),503,"Unavailable");
        if(path.equals("/wp-json/medipharm-reference/v1/dashboard"))return fileJson("dashboard.json");
        if(path.equals("/wp-json/medipharm-reference/v1/search"))return json(database.globalSearch(uri),200,"OK");
        if(path.equals("/wp-json/medipharm-protocols/v1/search"))return json(database.searchProtocols(uri),200,"OK");
        if(path.equals("/wp-json/medipharm-protocols/v1/specialties")){
            String type=uri.getQueryParameter("content_type");return fileJson("procedure".equals(type)?"specialties-procedure.json":"specialties-protocol.json");
        }
        if(path.equals("/wp-json/medipharm-protocols/v1/status"))return fileJson("status.json");
        String prefix="/wp-json/medipharm-protocols/v1/protocol/";
        if(path.startsWith(prefix)){String slug=Uri.decode(path.substring(prefix.length())).replaceAll("/$","");JSONObject p=database.protocol(slug);return p==null?json(error("not_found","Không tìm thấy nội dung lâm sàng."),404,"Not Found"):json(p,200,"OK");}
        prefix="/wp-json/medipharm-protocols/v1/icd/";
        if(path.startsWith(prefix)&&path.endsWith("/protocols")){String code=Uri.decode(path.substring(prefix.length(),path.length()-"/protocols".length())).replaceAll("/$","");return json(database.protocolsByIcd(code),200,"OK");}

        if(path.equals("/wp-json/nah-icd10/v1/search"))return json(database.icdSearch(uri),200,"OK");
        if(path.equals("/wp-json/nah-icd10/v1/stats"))return fileJson("icd-stats.json");
        if(path.equals("/wp-json/nah-icd10/v1/check-primary"))return json(database.checkPrimary(uri),200,"OK");
        if(path.equals("/wp-json/nah-icd10/v1/pl3/search"))return json(database.pl3Search(uri),200,"OK");
        if(path.equals("/wp-json/nah-icd10/v1/yhct/search"))return json(database.yhctSearch(uri),200,"OK");
        if(path.equals("/wp-json/nah-icd10/v1/guides/search"))return json(database.guidesSearch(uri),200,"OK");
        prefix="/wp-json/nah-icd10/v1/code/";
        if(path.startsWith(prefix)){String code=Uri.decode(path.substring(prefix.length())).replaceAll("/$","");JSONObject r=database.icdCode(code);return r==null?json(error("not_found","Không tìm thấy mã ICD-10."),404,"Not Found"):json(r,200,"OK");}
        return notFound();
    }

    private WebResourceResponse fileJson(String name)throws Exception{File f=new File(runtime.getActiveDir(),name);if(!f.isFile())return json(error("missing_local_file",name),404,"Not Found");return response(200,"OK","application/json","UTF-8",new FileInputStream(f));}
    private WebResourceResponse asset(String path,String mime)throws Exception{InputStream in=context.getAssets().open(path);return response(200,"OK",mime,encoding(path),in);}
    private static JSONObject error(String code,String message){
        JSONObject o=new JSONObject();
        try{
            o.put("code",code);
            o.put("message",message==null?"":message);
        }catch(Exception ignored){}
        return o;
    }
    private static WebResourceResponse json(JSONObject o,int status,String reason){return response(status,reason,"application/json","UTF-8",text(o.toString()));}
    private static WebResourceResponse notFound(){return response(404,"Not Found","text/plain","UTF-8",text("Not Found"));}
    private static ByteArrayInputStream text(String s){return new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8));}
    private static WebResourceResponse response(int status,String reason,String mime,String encoding,InputStream in){Map<String,String>h=new HashMap<>();h.put("Cache-Control","no-store");h.put("X-Content-Type-Options","nosniff");h.put("Access-Control-Allow-Origin",ORIGIN);h.put("Content-Security-Policy","default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https:; font-src 'self' https: data:; object-src 'none'; base-uri 'self'");return new WebResourceResponse(mime,encoding,status,reason,h,in);}
    private File resolveLocalSourceMedia(Uri uri){
        String last=uri==null?null:uri.getLastPathSegment();
        if(last==null)return null;
        Matcher m=SOURCE_MEDIA_PATTERN.matcher(last);
        if(!m.matches())return null;
        String sha=m.group(1).toLowerCase(Locale.ROOT);
        File dir=new File(runtime.getActiveDir(),"media");
        if(!dir.isDirectory())return null;
        String[] exts=new String[]{"jpg","jpeg","png","gif","webp"};
        for(String ext:exts){
            File f=new File(dir,"mcr-source-"+sha+"."+ext);
            if(f.isFile())return f;
        }
        File[] files=dir.listFiles();
        if(files!=null){
            String prefix=("mcr-source-"+sha+".").toLowerCase(Locale.ROOT);
            for(File f:files)if(f.isFile()&&f.getName().toLowerCase(Locale.ROOT).startsWith(prefix))return f;
        }
        return null;
    }
    private static String normalize(String p){if(p==null||p.contains("..")||p.contains("\\")||p.indexOf('\0')>=0)return null;String x=p.startsWith("/")?p:"/"+p;while(x.contains("//"))x=x.replace("//","/");return x;}
    private static String encoding(String n){String l=n.toLowerCase(Locale.ROOT);if(l.matches(".*\\.(png|jpg|jpeg|gif|webp|woff|woff2)$"))return null;return"UTF-8";}
    private static String mime(String n){String l=n.toLowerCase(Locale.ROOT);if(l.endsWith(".html"))return"text/html";if(l.endsWith(".css"))return"text/css";if(l.endsWith(".js"))return"application/javascript";if(l.endsWith(".json"))return"application/json";if(l.endsWith(".png"))return"image/png";if(l.endsWith(".jpg")||l.endsWith(".jpeg"))return"image/jpeg";if(l.endsWith(".gif"))return"image/gif";if(l.endsWith(".webp"))return"image/webp";if(l.endsWith(".woff2"))return"font/woff2";if(l.endsWith(".woff"))return"font/woff";return"application/octet-stream";}
}
