package com.medipharm.medref;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Silent application-version watch. It never downloads or installs an APK.
 * It only stores the latest public release metadata for the in-app update check.
 */
public final class AppUpdateJobService extends JobService {
    private static final int JOB_ID = 0x4D52; // MR
    private static final long PERIOD_MS = 24L * 60L * 60L * 1000L;
    private static final String PREFS = "medref_app_update";

    public static void schedule(Context context) {
        try {
            JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, AppUpdateJobService.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .setPeriodic(PERIOD_MS)
                    .build();
            scheduler.schedule(job);
        } catch (Throwable ignored) {}
    }

    @Override public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                if (networkAvailable()) {
                    JSONObject j = fetch(BuildConfig.APP_UPDATE_MANIFEST_URL);
                    SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
                    e.putInt("latest_version_code", j.optInt("versionCode", BuildConfig.VERSION_CODE));
                    e.putString("latest_version_name", j.optString("versionName", BuildConfig.VERSION_NAME));
                    e.putString("download_url", j.optString("downloadUrl", ""));
                    e.putLong("checked_at", System.currentTimeMillis());
                    e.apply();
                }
            } catch (Throwable ignored) {
            } finally {
                jobFinished(params, false);
            }
        }, "MedRef-update-watch").start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return false; }

    private boolean networkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            if (n == null) return false;
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Throwable e) { return false; }
    }

    private static JSONObject fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(6000); c.setReadTimeout(8000);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "MedRefAndroid/" + BuildConfig.VERSION_NAME);
        try {
            int status = c.getResponseCode();
            if (status != 200) throw new IllegalStateException("HTTP " + status);
            StringBuilder b = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                String line; while ((line = r.readLine()) != null) b.append(line);
            }
            return new JSONObject(b.toString());
        } finally { c.disconnect(); }
    }
}
