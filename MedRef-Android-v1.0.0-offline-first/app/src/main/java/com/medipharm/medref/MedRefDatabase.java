package com.medipharm.medref;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MedRefDatabase {
    private final SQLiteDatabase db;

    private MedRefDatabase(SQLiteDatabase db) { this.db = db; }

    public static MedRefDatabase create(File file) {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Không thể tạo thư mục SQLite MedRef.");
        }
        SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null);
        try { db.enableWriteAheadLogging(); } catch (Throwable ignored) {}
        try (Cursor pragma = db.rawQuery("PRAGMA synchronous=NORMAL", null)) {
            if (pragma.moveToFirst()) { /* apply PRAGMA through query API */ }
        } catch (Throwable ignored) {}
        db.execSQL("CREATE TABLE IF NOT EXISTS protocols (id INTEGER, slug TEXT PRIMARY KEY, title_vi TEXT, title_en TEXT, summary TEXT, status TEXT, version TEXT, content_type TEXT, group_key TEXT, group_name_vi TEXT, specialty_key TEXT, specialty_name_vi TEXT, updated_at TEXT, search_text TEXT, detail_json TEXT NOT NULL)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_protocol_type_specialty ON protocols(content_type,specialty_key)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_protocol_group ON protocols(group_key)");
        db.execSQL("CREATE TABLE IF NOT EXISTS protocol_icd (slug TEXT NOT NULL, code TEXT NOT NULL, relation_type TEXT, is_primary INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_protocol_icd_code ON protocol_icd(code)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_protocol_icd_slug ON protocol_icd(slug)");
        db.execSQL("CREATE TABLE IF NOT EXISTS icd (code TEXT PRIMARY KEY, code_no_dot TEXT, name_vi TEXT, name_en TEXT, chapter_name_vi TEXT, parent_code TEXT, is_active INTEGER, is_cancelled INTEGER, not_primary INTEGER, not_recommended_primary INTEGER, requires_more_specific_code INTEGER, death_only INTEGER, female_only INTEGER, male_only INTEGER, is_new INTEGER, search_text TEXT, raw_json TEXT NOT NULL)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_icd_code_nodot ON icd(code_no_dot)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_icd_parent ON icd(parent_code)");
        db.execSQL("CREATE TABLE IF NOT EXISTS pl3 (row_id INTEGER PRIMARY KEY, substance TEXT, search_text TEXT, raw_json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS yhct (row_id INTEGER PRIMARY KEY, yhct_code TEXT, status TEXT, search_text TEXT, raw_json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS guides (row_id INTEGER PRIMARY KEY, part TEXT, search_text TEXT, raw_json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS synonyms (row_id INTEGER PRIMARY KEY, code TEXT, term_unsigned TEXT)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_syn_term ON synonyms(term_unsigned)");
        return new MedRefDatabase(db);
    }

    public static MedRefDatabase openReadWrite(File file) { return create(file); }

    public void close() { db.close(); }
    public void begin() { db.beginTransaction(); }
    public void success() { db.setTransactionSuccessful(); }
    public void end() { db.endTransaction(); }

    private static String s(JSONObject o, String k) { return o == null ? "" : o.optString(k, ""); }
    private static int b(JSONObject o, String k) { return o != null && truthy(o.opt(k)) ? 1 : 0; }
    private static boolean truthy(Object v) {
        if (v == null || v == JSONObject.NULL) return false;
        if (v instanceof Boolean) return (Boolean)v;
        if (v instanceof Number) return ((Number)v).intValue() != 0;
        String x = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
        return "1".equals(x) || "true".equals(x) || "yes".equals(x);
    }

    public void insertProtocol(JSONObject p) throws Exception {
        String slug=s(p,"slug"); if (slug.isEmpty()) return;
        String search=norm(s(p,"title_vi")+" "+s(p,"title_en")+" "+s(p,"summary"));
        db.execSQL("INSERT OR REPLACE INTO protocols(id,slug,title_vi,title_en,summary,status,version,content_type,group_key,group_name_vi,specialty_key,specialty_name_vi,updated_at,search_text,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                new Object[]{p.optInt("id"),slug,s(p,"title_vi"),s(p,"title_en"),s(p,"summary"),s(p,"status"),s(p,"version"),emptyTo(s(p,"content_type"),"protocol"),s(p,"group_key"),s(p,"group_name_vi"),s(p,"specialty_key"),s(p,"specialty_name_vi"),s(p,"updated_at"),search,p.toString()});
        db.execSQL("DELETE FROM protocol_icd WHERE slug=?",new Object[]{slug});
        JSONArray icd=p.optJSONArray("icd");
        if(icd!=null) for(int i=0;i<icd.length();i++){
            JSONObject r=icd.optJSONObject(i); if(r==null) continue; String code=s(r,"code"); if(code.isEmpty()) continue;
            db.execSQL("INSERT INTO protocol_icd(slug,code,relation_type,is_primary) VALUES(?,?,?,?)",new Object[]{slug,code,s(r,"relation_type"),b(r,"is_primary")});
        }
    }

    public void insertIcd(JSONObject r) {
        String code=s(r,"code"); if(code.isEmpty()) return;
        String search=s(r,"search_text_unsigned"); if(search.isEmpty()) search=norm(code+" "+s(r,"name_vi")+" "+s(r,"name_en")+" "+s(r,"coding_guidance_vi"));
        db.execSQL("INSERT OR REPLACE INTO icd(code,code_no_dot,name_vi,name_en,chapter_name_vi,parent_code,is_active,is_cancelled,not_primary,not_recommended_primary,requires_more_specific_code,death_only,female_only,male_only,is_new,search_text,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                new Object[]{code,emptyTo(s(r,"code_no_dot"),code.replace(".","")),s(r,"name_vi"),s(r,"name_en"),s(r,"chapter_name_vi"),s(r,"parent_code"),b(r,"is_active"),b(r,"is_cancelled"),b(r,"not_primary"),b(r,"not_recommended_primary"),b(r,"requires_more_specific_code"),b(r,"death_only"),b(r,"female_only"),b(r,"male_only"),b(r,"is_new"),search,r.toString()});
    }

    public void insertPl3(JSONObject r) { insertGeneric("pl3",r,"substance"); }
    public void insertYhct(JSONObject r) { insertGeneric("yhct",r,"yhct_code"); }
    public void insertGuide(JSONObject r) { insertGeneric("guides",r,"title"); }

    private void insertGeneric(String table, JSONObject r, String mainField) {
        int id=r.optInt("id",0); if(id==0) id=Math.abs(r.toString().hashCode());
        String search=s(r,"search_text_unsigned"); if(search.isEmpty()) search=norm(r.toString());
        if("pl3".equals(table)) db.execSQL("INSERT OR REPLACE INTO pl3(row_id,substance,search_text,raw_json) VALUES(?,?,?,?)",new Object[]{id,s(r,mainField),search,r.toString()});
        else if("yhct".equals(table)) db.execSQL("INSERT OR REPLACE INTO yhct(row_id,yhct_code,status,search_text,raw_json) VALUES(?,?,?,?,?)",new Object[]{id,s(r,mainField),s(r,"status"),search,r.toString()});
        else db.execSQL("INSERT OR REPLACE INTO guides(row_id,part,search_text,raw_json) VALUES(?,?,?,?)",new Object[]{id,s(r,"part"),search,r.toString()});
    }

    public void insertSynonym(JSONObject r) {
        int id=r.optInt("id",0); if(id==0) id=Math.abs(r.toString().hashCode());
        db.execSQL("INSERT OR REPLACE INTO synonyms(row_id,code,term_unsigned) VALUES(?,?,?)",new Object[]{id,s(r,"code"),emptyTo(s(r,"term_unsigned"),norm(s(r,"term")))});
    }

    public JSONObject searchProtocols(Uri uri) throws Exception {
        String q=param(uri,"q"), specialty=param(uri,"specialty"), group=param(uri,"group"), type=emptyTo(param(uri,"content_type"),"protocol");
        int limit=clamp(intParam(uri,"limit",30),1,100), offset=Math.max(0,intParam(uri,"offset",0));
        List<String> where=new ArrayList<>(), args=new ArrayList<>();
        if(!"all".equals(type)){where.add("content_type=?");args.add(normalizeType(type));}
        if(!specialty.isEmpty()){where.add("specialty_key=?");args.add(specialty);} else if(!group.isEmpty()){where.add("group_key=?");args.add(group);}
        if(!q.trim().isEmpty()){String nq=norm(q);where.add("(search_text LIKE ? OR slug IN (SELECT slug FROM protocol_icd WHERE REPLACE(code,'.','') LIKE ?))");args.add("%"+nq+"%");args.add(q.toUpperCase(Locale.ROOT).replace(".","")+"%");}
        String w=where.isEmpty()?"1=1":join(where," AND ");
        int total=count("SELECT COUNT(*) FROM protocols WHERE "+w,args);
        ArrayList<String> pageArgs=new ArrayList<>(args);pageArgs.add(String.valueOf(limit));pageArgs.add(String.valueOf(offset));
        Cursor c=db.rawQuery("SELECT slug,title_vi,title_en,summary,status,version,content_type,group_key,group_name_vi,specialty_key,specialty_name_vi,updated_at FROM protocols WHERE "+w+" ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?",pageArgs.toArray(new String[0]));
        JSONArray arr=new JSONArray();
        try{while(c.moveToNext()){
            JSONObject o=new JSONObject();String slug=c.getString(0);
            o.put("slug",slug).put("title_vi",c.getString(1)).put("title_en",c.getString(2)).put("summary",c.getString(3)).put("status",c.getString(4)).put("version",c.getString(5)).put("content_type",c.getString(6)).put("group_key",c.getString(7)).put("group_name_vi",c.getString(8)).put("specialty_key",c.getString(9)).put("specialty_name_vi",c.getString(10)).put("updated_at",c.getString(11)).put("icd",icdForSlug(slug));
            arr.put(o);
        }}finally{c.close();}
        int next=offset+arr.length();
        return new JSONObject().put("query",q).put("count",arr.length()).put("total",total).put("limit",limit).put("offset",offset).put("next_offset",next).put("has_more",next<total).put("results",arr).put("icd_status",new JSONObject().put("offline",true));
    }

    public JSONObject protocol(String slug) throws Exception {
        Cursor c=db.rawQuery("SELECT detail_json FROM protocols WHERE slug=? LIMIT 1",new String[]{slug});
        try{return c.moveToFirst()?new JSONObject(c.getString(0)):null;}finally{c.close();}
    }

    public JSONObject protocolsByIcd(String code) throws Exception {
        Cursor c=db.rawQuery("SELECT p.detail_json,pi.relation_type,pi.is_primary FROM protocol_icd pi JOIN protocols p ON p.slug=pi.slug WHERE pi.code=? AND p.content_type='protocol' ORDER BY pi.is_primary DESC,p.title_vi ASC",new String[]{code.toUpperCase(Locale.ROOT)});
        JSONArray a=new JSONArray();try{while(c.moveToNext()){JSONObject d=new JSONObject(c.getString(0));JSONObject x=new JSONObject().put("slug",d.optString("slug")).put("title_vi",d.optString("title_vi")).put("title_en",d.optString("title_en")).put("specialty_key",d.optString("specialty_key")).put("relation_type",c.getString(1)).put("is_primary",c.getInt(2)!=0);a.put(x);}}finally{c.close();}
        return new JSONObject().put("code",code).put("count",a.length()).put("results",a);
    }

    public JSONObject globalSearch(Uri uri) throws Exception {
        String q=param(uri,"q");int limit=clamp(intParam(uri,"limit",8),1,12);
        JSONObject icd=icdSearch(buildUri("/search",q,limit,"all"));
        JSONObject all=searchProtocols(buildProtocolSearchUri(q,limit*2));
        JSONArray protocols=new JSONArray(), procedures=new JSONArray(), rows=all.optJSONArray("results");
        if(rows!=null) for(int i=0;i<rows.length();i++){JSONObject p=rows.optJSONObject(i);if(p==null)continue;if("procedure".equals(p.optString("content_type"))) procedures.put(p); else protocols.put(p);}
        trim(protocols,limit);trim(procedures,limit);
        JSONArray icdRows=icd.optJSONArray("results"); if(icdRows==null)icdRows=new JSONArray();
        return new JSONObject().put("query",q).put("icd",icdRows).put("protocols",protocols).put("procedures",procedures).put("count",icdRows.length()+protocols.length()+procedures.length());
    }

    public JSONObject icdSearch(Uri uri) throws Exception {
        String q=param(uri,"q"), filter=emptyTo(param(uri,"filter"),"all");int limit=clamp(intParam(uri,"limit",20),1,50);
        List<String>w=new ArrayList<>(),a=new ArrayList<>();w.add("1=1");
        switch(filter){case"primary":w.add("is_active=1 AND is_cancelled=0 AND not_primary=0 AND not_recommended_primary=0 AND requires_more_specific_code=0 AND death_only=0");break;case"not_primary":w.add("(not_primary=1 OR not_recommended_primary=1)");break;case"specific":w.add("requires_more_specific_code=1");break;case"cancelled":w.add("is_cancelled=1");break;case"gender":w.add("(female_only=1 OR male_only=1)");break;case"death":w.add("death_only=1");break;case"new":w.add("is_new=1");break;case"not_recommended":w.add("not_recommended_primary=1");break;case"female":w.add("female_only=1");break;case"male":w.add("male_only=1");break;default:break;}
        if(!q.trim().isEmpty()){
            String nq=norm(q),cn=q.toUpperCase(Locale.ROOT).replace(".","").replace(" ","");
            w.add("(code_no_dot LIKE ? OR search_text LIKE ? OR code IN (SELECT code FROM synonyms WHERE term_unsigned LIKE ?))");a.add(cn+"%");a.add("%"+nq+"%");a.add("%"+nq+"%");
        }
        a.add(String.valueOf(limit));Cursor c=db.rawQuery("SELECT raw_json FROM icd WHERE "+join(w," AND ")+" ORDER BY code ASC LIMIT ?",a.toArray(new String[0]));JSONArray rows=new JSONArray();
        try{while(c.moveToNext()){JSONObject r=new JSONObject(c.getString(0));r.put("evaluation",evaluate(r,"","clinical"));if(truthy(r.opt("requires_more_specific_code")))r.put("suggestions",suggestions(r.optString("code"),8));enrichIcd(r);rows.put(r);}}finally{c.close();}
        return new JSONObject().put("query",q).put("count",rows.length()).put("results",rows);
    }

    public JSONObject icdCode(String code) throws Exception {
        String normalized=code.toUpperCase(Locale.ROOT);Cursor c=db.rawQuery("SELECT raw_json FROM icd WHERE code=? OR code_no_dot=? LIMIT 1",new String[]{normalized,normalized.replace(".","")});
        try{if(!c.moveToFirst())return null;JSONObject r=new JSONObject(c.getString(0));r.put("evaluation",evaluate(r,"","clinical"));r.put("suggestions",suggestions(r.optString("code"),20));enrichIcd(r);return r;}finally{c.close();}
    }

    public JSONObject checkPrimary(Uri uri) throws Exception {
        String code=param(uri,"code"),gender=param(uri,"gender"),record=emptyTo(param(uri,"record_type"),"clinical");JSONObject r=icdCodeRaw(code);
        if(r==null)return new JSONObject().put("found",false).put("code",code).put("evaluation",new JSONObject().put("status","not_found").put("severity","danger").put("messages",new JSONArray().put("Không tìm thấy mã ICD-10 này trong dữ liệu offline.")).put("warnings",new JSONArray()).put("badges",new JSONArray()).put("copy_formats",new JSONObject())).put("suggestions",new JSONArray());
        return new JSONObject().put("found",true).put("code",r.optString("code")).put("item",r).put("evaluation",evaluate(r,gender,record)).put("suggestions",suggestions(r.optString("code"),20));
    }

    private JSONObject icdCodeRaw(String code)throws Exception{String n=code.toUpperCase(Locale.ROOT);Cursor c=db.rawQuery("SELECT raw_json FROM icd WHERE code=? OR code_no_dot=? LIMIT 1",new String[]{n,n.replace(".","")});try{return c.moveToFirst()?new JSONObject(c.getString(0)):null;}finally{c.close();}}

    public JSONObject pl3Search(Uri uri)throws Exception{return genericSearch("pl3",uri,"",false);}
    public JSONObject yhctSearch(Uri uri)throws Exception{
        String filter=emptyTo(param(uri,"filter"),"all"), extra="";
        if("pl1".equals(filter))extra="status LIKE 'PL I%'";else if("pl2".equals(filter))extra="status LIKE 'PL II%'";else if("pl3".equals(filter))extra="status LIKE 'PL III%'";else if("pl4".equals(filter))extra="status LIKE 'PL IV%'";else if("active".equals(filter))extra="status LIKE '%Đang%'";else if("removed".equals(filter))extra="(status LIKE '%bỏ%' OR status LIKE '%hủy%')";else if("changed".equals(filter))extra="status LIKE '%sửa%'";
        JSONObject o=genericSearch("yhct",uri,extra,false);o.put("filter",filter);return o;
    }
    public JSONObject guidesSearch(Uri uri)throws Exception{return genericSearch("guides",uri,"part=?",true);}

    private JSONObject genericSearch(String table,Uri uri,String extra,boolean partArg)throws Exception{
        String q=param(uri,"q");int limit=clamp(intParam(uri,"limit",50),1,1000),offset=Math.max(0,intParam(uri,"offset",0));List<String>w=new ArrayList<>(),args=new ArrayList<>();w.add("1=1");if(extra!=null&&!extra.isEmpty()){w.add(extra);if(partArg)args.add(emptyTo(param(uri,"part"),"pl1"));}if(!q.trim().isEmpty()){w.add("search_text LIKE ?");args.add("%"+norm(q)+"%");}String ws=join(w," AND ");int total=count("SELECT COUNT(*) FROM "+table+" WHERE "+ws,args);ArrayList<String>qa=new ArrayList<>(args);qa.add(String.valueOf(limit));qa.add(String.valueOf(offset));Cursor c=db.rawQuery("SELECT raw_json FROM "+table+" WHERE "+ws+" ORDER BY row_id ASC LIMIT ? OFFSET ?",qa.toArray(new String[0]));JSONArray rows=new JSONArray();try{while(c.moveToNext())rows.put(new JSONObject(c.getString(0)));}finally{c.close();}int next=offset+rows.length();return new JSONObject().put("query",q).put("count",rows.length()).put("shown",rows.length()).put("total",total).put("limit",limit).put("offset",offset).put("next_offset",next).put("has_more",next<total).put("results",rows);
    }

    private void enrichIcd(JSONObject r)throws Exception{String code=r.optString("code");JSONArray p=protocolSummaryForIcd(code,4);r.put("linked_protocol_count",count("SELECT COUNT(*) FROM protocol_icd pi JOIN protocols p ON p.slug=pi.slug WHERE pi.code=? AND p.content_type='protocol'",java.util.Collections.singletonList(code)));r.put("linked_protocols",p);r.put("protocols_url","https://app.medref.local/index.html?view=protocols&q="+Uri.encode(code));}

    private JSONArray protocolSummaryForIcd(String code,int limit)throws Exception{Cursor c=db.rawQuery("SELECT p.slug,p.title_vi,p.title_en,p.specialty_key,pi.relation_type,pi.is_primary FROM protocol_icd pi JOIN protocols p ON p.slug=pi.slug WHERE pi.code=? AND p.content_type='protocol' ORDER BY pi.is_primary DESC,p.title_vi ASC LIMIT ?",new String[]{code,String.valueOf(limit)});JSONArray a=new JSONArray();try{while(c.moveToNext())a.put(new JSONObject().put("slug",c.getString(0)).put("title_vi",c.getString(1)).put("title_en",c.getString(2)).put("specialty_key",c.getString(3)).put("relation_type",c.getString(4)).put("is_primary",c.getInt(5)!=0));}finally{c.close();}return a;}
    private JSONArray icdForSlug(String slug)throws Exception{Cursor c=db.rawQuery("SELECT code,relation_type,is_primary FROM protocol_icd WHERE slug=? ORDER BY is_primary DESC,code ASC",new String[]{slug});JSONArray a=new JSONArray();try{while(c.moveToNext())a.put(new JSONObject().put("code",c.getString(0)).put("relation_type",c.getString(1)).put("is_primary",c.getInt(2)!=0));}finally{c.close();}return a;}
    private JSONArray suggestions(String parent,int limit)throws Exception{Cursor c=db.rawQuery("SELECT raw_json FROM icd WHERE parent_code=? AND is_cancelled=0 ORDER BY code ASC LIMIT ?",new String[]{parent,String.valueOf(limit)});JSONArray a=new JSONArray();try{while(c.moveToNext()){JSONObject r=new JSONObject(c.getString(0));JSONObject x=new JSONObject();for(String k:new String[]{"code","name_vi","name_en","not_primary","not_recommended_primary","requires_more_specific_code","death_only","female_only","male_only","is_cancelled","is_new"})if(r.has(k))x.put(k,r.opt(k));a.put(x);}}finally{c.close();}return a;}

    private static JSONObject evaluate(JSONObject row,String gender,String record)throws Exception{
        JSONArray msg=new JSONArray(),warn=new JSONArray(),badges=new JSONArray();String status="primary_ok",severity="ok";
        if(truthy(row.opt("is_cancelled"))){status="cancelled";severity="danger";msg.put("Mã này không còn trong danh mục TT06/2026 đang hiệu lực hoặc đã bị hủy. Không sử dụng cho hồ sơ hiện hành.");badges.put(badge("danger","Mã bị hủy"));}
        else if(truthy(row.opt("death_only"))&&!"death".equals(record)){status="death_only";severity="danger";msg.put("Mã này chỉ sử dụng để mã hóa nguyên nhân tử vong.");badges.put(badge("danger","Chỉ dùng nguyên nhân tử vong"));}
        else if(truthy(row.opt("not_primary"))){status="not_primary";severity="danger";msg.put("Mã này không được sử dụng làm mã bệnh chính. Có thể cân nhắc ghi ở mã bệnh kèm theo/bổ sung nếu phù hợp.");badges.put(badge("danger","Không dùng bệnh chính"));}
        else if(truthy(row.opt("requires_more_specific_code"))){status="need_specific";severity="warning";msg.put("Mã này không nên dùng trực tiếp nếu đã có mã 4 hoặc 5 ký tự phù hợp. Cần chọn mã chi tiết hơn theo biến chứng hoặc tình trạng lâm sàng.");badges.put(badge("warning","Cần mã cụ thể hơn"));}
        else if(truthy(row.opt("not_recommended_primary"))){status="not_recommended_primary";severity="warning";msg.put("Mã này không khuyến khích dùng làm mã bệnh chính. Cần kiểm tra bối cảnh lâm sàng và hướng dẫn mã hóa.");badges.put(badge("warning","Không khuyến khích bệnh chính"));}
        else{if(row.optString("code").startsWith("Z")){msg.put("Có thể dùng khi phù hợp với lý do tiếp xúc dịch vụ y tế/khám sức khỏe. Không dùng thay thế chẩn đoán bệnh lý xác định nếu đã có bệnh được chẩn đoán.");}else msg.put("Có thể dùng làm bệnh chính nếu phù hợp với chẩn đoán xác định và hồ sơ bệnh án.");warn.put("Bác sĩ vẫn cần đối chiếu chẩn đoán theo thực tế lâm sàng và hồ sơ bệnh án.");badges.put(badge("success","Có thể dùng làm bệnh chính"));}
        if(truthy(row.opt("female_only"))){badges.put(badge("purple","Theo giới tính nữ"));if("male".equals(gender)){warn.put("Mã này chỉ/chủ yếu áp dụng cho người bệnh nữ; giới tính đang chọn là nam.");severity="danger";}}
        if(truthy(row.opt("male_only"))){badges.put(badge("purple","Theo giới tính nam"));if("female".equals(gender)){warn.put("Mã này chỉ/chủ yếu áp dụng cho người bệnh nam; giới tính đang chọn là nữ.");severity="danger";}}
        if(truthy(row.opt("is_new")))badges.put(badge("info","Mã bổ sung mới"));
        String code=row.optString("code"),name=row.optString("name_vi"),line=(code+(name.isEmpty()?"":" - "+name)).trim();JSONObject copy=new JSONObject().put("code",code).put("code_name",line).put("primary",line.isEmpty()?"":"Bệnh chính: "+line).put("secondary",line.isEmpty()?"":"Bệnh kèm theo: "+line);
        return new JSONObject().put("status",status).put("severity",severity).put("messages",msg).put("warnings",warn).put("badges",badges).put("copy_formats",copy);
    }
    private static JSONObject badge(String type,String label)throws Exception{return new JSONObject().put("type",type).put("label",label);}

    public JSONObject counts()throws Exception{return new JSONObject().put("protocols",count("SELECT COUNT(*) FROM protocols",new ArrayList<>())).put("icd",count("SELECT COUNT(*) FROM icd",new ArrayList<>())).put("pl3",count("SELECT COUNT(*) FROM pl3",new ArrayList<>())).put("yhct",count("SELECT COUNT(*) FROM yhct",new ArrayList<>())).put("guides",count("SELECT COUNT(*) FROM guides",new ArrayList<>())).put("synonyms",count("SELECT COUNT(*) FROM synonyms",new ArrayList<>()));}

    private int count(String sql,List<String>args){Cursor c=db.rawQuery(sql,args.toArray(new String[0]));try{return c.moveToFirst()?c.getInt(0):0;}finally{c.close();}}
    private static String param(Uri u,String k){String v=u.getQueryParameter(k);return v==null?"":v;}
    private static int intParam(Uri u,String k,int d){try{String v=u.getQueryParameter(k);return v==null?d:Integer.parseInt(v);}catch(Exception e){return d;}}
    private static int clamp(int v,int a,int b){return Math.max(a,Math.min(b,v));}
    private static String emptyTo(String s,String d){return s==null||s.isEmpty()?d:s;}
    private static String normalizeType(String s){return ("procedure".equals(s)||"quy-trinh".equals(s)||"quy-trinh-chuyen-mon".equals(s)||"qtcm".equals(s))?"procedure":"protocol";}
    private static String join(List<String>x,String sep){StringBuilder b=new StringBuilder();for(int i=0;i<x.size();i++){if(i>0)b.append(sep);b.append(x.get(i));}return b.toString();}
    private static void trim(JSONArray a,int max){while(a.length()>max)a.remove(a.length()-1);}
    private static Uri buildProtocolSearchUri(String q,int limit){return Uri.parse("https://app.medref.local/wp-json/medipharm-protocols/v1/search?q="+Uri.encode(q)+"&limit="+limit+"&content_type=all");}
    private static Uri buildUri(String path,String q,int limit,String filter){return Uri.parse("https://app.medref.local/wp-json/nah-icd10/v1"+path+"?q="+Uri.encode(q)+"&limit="+limit+"&filter="+Uri.encode(filter));}
    public static String norm(String value){if(value==null)return"";String n=Normalizer.normalize(value,Normalizer.Form.NFD).replaceAll("\\p{M}+","").replace('đ','d').replace('Đ','D').toLowerCase(Locale.ROOT);return n.replaceAll("\\s+"," ").trim();}
}
