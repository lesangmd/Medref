package com.medipharm.medref;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

public final class DataUpdateService extends Service {
    private static final String TAG="MedRefDataUpdate";
    private static final String CHANNEL_ID="medref_data_update";
    private static final int NOTIFICATION_ID=1042;
    private static final String PREFS="medref_data_update";
    private static final String EXTRA_COOKIE="cookie";
    private static final String EXTRA_NONCE="nonce";

    public static final String ACTION_STATUS="com.medipharm.medref.DATA_UPDATE_STATUS";
    public static final String EXTRA_STATE="state";
    public static final String EXTRA_PROGRESS="progress";
    public static final String EXTRA_MESSAGE="message";
    public static final String EXTRA_CHANGED="changed";

    public static final String STATE_IDLE="idle";
    public static final String STATE_RUNNING="running";
    public static final String STATE_DONE="done";
    public static final String STATE_FAILED="failed";

    private volatile boolean workerRunning=false;
    private PowerManager.WakeLock wakeLock;

    public static void start(Context context,String cookie,String nonce){
        Intent i=new Intent(context,DataUpdateService.class);
        i.putExtra(EXTRA_COOKIE,cookie==null?"":cookie);
        i.putExtra(EXTRA_NONCE,nonce==null?"":nonce);
        context.startForegroundService(i);
    }

    public static String state(Context c){return c.getSharedPreferences(PREFS,MODE_PRIVATE).getString(EXTRA_STATE,STATE_IDLE);}
    public static int progress(Context c){return c.getSharedPreferences(PREFS,MODE_PRIVATE).getInt(EXTRA_PROGRESS,0);}
    public static String message(Context c){return c.getSharedPreferences(PREFS,MODE_PRIVATE).getString(EXTRA_MESSAGE,"");}
    public static boolean isRunning(Context c){
        SharedPreferences p=c.getSharedPreferences(PREFS,MODE_PRIVATE);
        if(!STATE_RUNNING.equals(p.getString(EXTRA_STATE,STATE_IDLE)))return false;
        long updated=p.getLong("updated_at",0L),now=System.currentTimeMillis();
        if(updated>0L&&now>=updated&&now-updated<30L*60L*1000L)return true;
        p.edit().putString(EXTRA_STATE,STATE_FAILED)
                .putString(EXTRA_MESSAGE,"Lần cập nhật trước đã bị gián đoạn; có thể thử lại.")
                .apply();
        return false;
    }

    @Override public void onCreate(){
        super.onCreate();
        createChannel();
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(workerRunning)return START_NOT_STICKY;
        final String cookie=intent==null?"":intent.getStringExtra(EXTRA_COOKIE);
        final String nonce=intent==null?"":intent.getStringExtra(EXTRA_NONCE);
        workerRunning=true;
        publish(STATE_RUNNING,1,"Đang chuẩn bị cập nhật dữ liệu…",false);
        startForeground(NOTIFICATION_ID,notification("Đang cập nhật dữ liệu MedRef","Đang chuẩn bị…",1,true));
        acquireWakeLock();
        new Thread(()->runUpdate(cookie==null?"":cookie,nonce==null?"":nonce),"MedRef-data-update-service").start();
        return START_NOT_STICKY;
    }

    private void runUpdate(String cookie,String nonce){
        boolean changed=false;
        try{
            MedRefDataRuntime runtime=new MedRefDataRuntime(this);
            runtime.ensureReady();
            MedRefDataRuntime.UpdatePlan plan=runtime.checkForUpdates(cookie,nonce);
            if(!plan.hasChanges()){
                publish(STATE_DONE,100,"Dữ liệu MedRef đang ở phiên bản mới nhất.",false);
                notifyFinal("Dữ liệu đã cập nhật","Không có dữ liệu mới.");
                return;
            }
            publish(STATE_RUNNING,2,"Đã phát hiện dữ liệu mới. Đang cập nhật trong nền…",false);
            MedRefDataRuntime.ProgressListener listener=(pct,msg)->{
                int p=Math.max(1,Math.min(99,pct));
                publish(STATE_RUNNING,p,msg,false);
                updateNotification(msg,p);
            };
            changed=runtime.applyUpdate(plan,cookie,nonce,listener);
            publish(STATE_DONE,100,changed?"Đã cập nhật dữ liệu MedRef.":"Dữ liệu MedRef đang ở phiên bản mới nhất.",changed);
            notifyFinal("Cập nhật MedRef hoàn tất",changed?"Dữ liệu mới đã sẵn sàng.":"Không có dữ liệu mới.");
        }catch(Exception e){
            Log.e(TAG,"background data update",e);
            String msg=safe(e);
            publish(STATE_FAILED,0,"Cập nhật chưa hoàn tất: "+msg,false);
            notifyFinal("Cập nhật MedRef chưa hoàn tất","Dữ liệu hiện có vẫn được giữ nguyên. Chạm Cập nhật dữ liệu để thử lại.");
        }finally{
            releaseWakeLock();
            workerRunning=false;
            stopForeground(STOP_FOREGROUND_DETACH);
            stopSelf();
        }
    }

    private void publish(String state,int progress,String message,boolean changed){
        SharedPreferences.Editor e=getSharedPreferences(PREFS,MODE_PRIVATE).edit();
        e.putString(EXTRA_STATE,state).putInt(EXTRA_PROGRESS,progress).putString(EXTRA_MESSAGE,message).putLong("updated_at",System.currentTimeMillis()).apply();
        Intent b=new Intent(ACTION_STATUS).setPackage(getPackageName());
        b.putExtra(EXTRA_STATE,state).putExtra(EXTRA_PROGRESS,progress).putExtra(EXTRA_MESSAGE,message).putExtra(EXTRA_CHANGED,changed);
        sendBroadcast(b);
    }

    private void createChannel(){
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(nm==null)return;
        NotificationChannel c=new NotificationChannel(CHANNEL_ID,"Cập nhật dữ liệu MedRef",NotificationManager.IMPORTANCE_LOW);
        c.setDescription("Tiến độ cập nhật dữ liệu ngoại tuyến MedRef");
        nm.createNotificationChannel(c);
    }

    private Notification notification(String title,String text,int pct,boolean ongoing){
        Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b=new Notification.Builder(this,CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pi)
                .setOnlyAlertOnce(true)
                .setOngoing(ongoing)
                .setCategory(Notification.CATEGORY_PROGRESS);
        if(ongoing)b.setProgress(100,Math.max(0,Math.min(100,pct)),false);
        else b.setProgress(0,0,false).setAutoCancel(true);
        return b.build();
    }

    private void updateNotification(String msg,int pct){
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(nm!=null)nm.notify(NOTIFICATION_ID,notification("Đang cập nhật dữ liệu MedRef",msg,pct,true));
    }

    private void notifyFinal(String title,String text){
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(nm!=null)nm.notify(NOTIFICATION_ID,notification(title,text,100,false));
    }

    private void acquireWakeLock(){
        try{
            PowerManager pm=getSystemService(PowerManager.class);
            if(pm!=null){wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"MedRef:DataUpdate");wakeLock.acquire(30L*60L*1000L);}
        }catch(Throwable ignored){}
    }

    private void releaseWakeLock(){
        try{if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();}catch(Throwable ignored){}
        wakeLock=null;
    }

    private static String safe(Throwable t){
        String s=t==null?"Lỗi không xác định":t.getMessage();
        return s==null||s.trim().isEmpty()?t.getClass().getSimpleName():s.trim();
    }

    @Override public IBinder onBind(Intent intent){return null;}
}
