package com.medipharm.medref;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String TAG="MedRef";
    private static final String START_URL="https://www.sachyhoc.com/medipharm/";
    private static final String LOGIN_URL="https://www.sachyhoc.com/dangnhap/";
    private static final String LOGIN_RETURN="https://www.sachyhoc.com/medipharm/?medref_auth_done=1";
    private static final String APP_UA=" MedRefAndroid/"+BuildConfig.VERSION_NAME+" OnlineFirst";

    private final Handler main=new Handler(Looper.getMainLooper());
    private FrameLayout root,webContainer;
    private WebView webView;
    private LinearLayout gate;
    private TextView gateTitle,gateMessage,progressText;
    private Button primaryButton,secondaryButton;
    private ProgressBar progress;
    private boolean loginTransitionPending=false;
    private Dialog loginDialog;
    private WebView loginView;
    private CredentialStore credentialStore;
    private boolean loginAttemptInjected=false;
    private String pendingLoginUser="",pendingLoginPassword="";
    private boolean pendingRemember=false;
    private TextView loginStatus;

    @Override protected void onCreate(Bundle savedInstanceState){
        super.onCreate(savedInstanceState);
        configureSystemBars();
        buildShell();
        credentialStore=new CredentialStore(this);
        afterRuntimeReady();
    }

    private void afterRuntimeReady(){
        // Online-first: no SQLite hydration or automatic media worker.
        AppUpdateJobService.schedule(this);
        if(!networkAvailable()){
            showGate("Chưa có kết nối Internet","MedRef hoạt động trực tuyến. Kiểm tra kết nối để xem nội dung lâm sàng mới nhất.",
                    "Thử lại",v->afterRuntimeReady(),null,null);
            return;
        }
        if(isMemberAuthenticated())loadOnlineApp();
        else showGate("MedRef","Đăng nhập MEDIPHARM để tra cứu trực tuyến phác đồ, quy trình và ICD-10. Ứng dụng không tải hàng nghìn bản ghi vào thiết bị.",
                "Đăng nhập",v->showEmbeddedLogin(),null,null);
    }

    private void buildShell(){
        root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(244,249,250));
        webContainer=new FrameLayout(this);root.addView(webContainer,new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));

        gate=new LinearLayout(this);gate.setOrientation(LinearLayout.VERTICAL);gate.setGravity(Gravity.CENTER);gate.setPadding(dp(30),dp(34),dp(30),dp(34));
        GradientDrawable shellBg=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{Color.rgb(238,249,249),Color.rgb(248,250,252),Color.rgb(233,242,247)});gate.setBackground(shellBg);

        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setGravity(Gravity.CENTER);card.setPadding(dp(26),dp(28),dp(26),dp(26));
        GradientDrawable cardBg=new GradientDrawable();cardBg.setColor(Color.WHITE);cardBg.setCornerRadius(dp(26));cardBg.setStroke(dp(1),Color.rgb(215,229,232));card.setBackground(cardBg);
        gate.addView(card,new LinearLayout.LayoutParams(-1,-2));

        TextView mark=new TextView(this);mark.setText("M");mark.setTextSize(24);mark.setGravity(Gravity.CENTER);mark.setTextColor(Color.WHITE);mark.setTypeface(mark.getTypeface(),android.graphics.Typeface.BOLD);
        GradientDrawable markBg=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{Color.rgb(13,126,136),Color.rgb(33,157,159)});markBg.setCornerRadius(dp(18));mark.setBackground(markBg);
        card.addView(mark,new LinearLayout.LayoutParams(dp(58),dp(58)));

        gateTitle=new TextView(this);gateTitle.setTextSize(25);gateTitle.setTextColor(Color.rgb(18,37,58));gateTitle.setGravity(Gravity.CENTER);gateTitle.setTypeface(gateTitle.getTypeface(),android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams tp=new LinearLayout.LayoutParams(-1,-2);tp.setMargins(0,dp(16),0,0);card.addView(gateTitle,tp);

        gateMessage=new TextView(this);gateMessage.setTextSize(15);gateMessage.setTextColor(Color.rgb(92,111,124));gateMessage.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams mp=new LinearLayout.LayoutParams(-1,-2);mp.setMargins(0,dp(10),0,dp(18));card.addView(gateMessage,mp);

        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams pg=new LinearLayout.LayoutParams(-1,dp(8));pg.setMargins(0,dp(2),0,0);card.addView(progress,pg);

        progressText=new TextView(this);progressText.setTextSize(13);progressText.setTextColor(Color.rgb(13,126,136));progressText.setGravity(Gravity.CENTER);progressText.setVisibility(View.GONE);progressText.setTypeface(progressText.getTypeface(),android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams pp=new LinearLayout.LayoutParams(-1,-2);pp.setMargins(0,dp(10),0,dp(12));card.addView(progressText,pp);

        primaryButton=new Button(this);primaryButton.setAllCaps(false);primaryButton.setTextSize(16);primaryButton.setTextColor(Color.WHITE);primaryButton.setTypeface(primaryButton.getTypeface(),android.graphics.Typeface.BOLD);primaryButton.setBackground(buttonBackground(Color.rgb(13,126,136),0));
        card.addView(primaryButton,new LinearLayout.LayoutParams(-1,dp(54)));

        secondaryButton=new Button(this);secondaryButton.setAllCaps(false);secondaryButton.setTextSize(15);secondaryButton.setTextColor(Color.rgb(13,126,136));secondaryButton.setBackground(buttonBackground(Color.WHITE,Color.rgb(13,126,136)));
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,dp(52));sp.setMargins(0,dp(10),0,0);card.addView(secondaryButton,sp);

        root.addView(gate,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        applySystemInsets();
    }

    private void configureSystemBars(){
        Window w=getWindow();
        try{w.setStatusBarColor(Color.rgb(244,249,250));}catch(Throwable ignored){}
        try{w.setNavigationBarColor(Color.rgb(244,249,250));}catch(Throwable ignored){}
        try{
            WindowInsetsController c=w.getInsetsController();
            if(c!=null)c.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }catch(Throwable ignored){}
    }

    private void applySystemInsets(){
        if(root==null)return;
        root.setOnApplyWindowInsetsListener((v,insets)->{
            Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
            v.setPadding(safe.left,safe.top,safe.right,safe.bottom);
            return insets;
        });
        root.requestApplyInsets();
    }

    private void showGate(String title,String message,String primary,View.OnClickListener primaryAction,String secondary,View.OnClickListener secondaryAction){
        gate.setVisibility(View.VISIBLE);webContainer.setVisibility(View.GONE);gateTitle.setText(title);gateMessage.setText(message);progress.setVisibility(View.GONE);progressText.setVisibility(View.GONE);
        primaryButton.setEnabled(true);primaryButton.setAlpha(1f);primaryButton.setBackground(buttonBackground(Color.rgb(13,126,136),0));
        if(primary!=null){primaryButton.setText(primary);primaryButton.setOnClickListener(primaryAction);primaryButton.setVisibility(View.VISIBLE);}else primaryButton.setVisibility(View.GONE);
        if(secondary!=null){secondaryButton.setText(secondary);secondaryButton.setOnClickListener(secondaryAction);secondaryButton.setVisibility(View.VISIBLE);}else secondaryButton.setVisibility(View.GONE);
    }

    // Clinical content is fetched on demand by the responsive WebApp.

    private void ensureWebView(){
        if(webView!=null)return;
        webView=new WebView(this);webView.setBackgroundColor(Color.WHITE);webContainer.addView(webView,new FrameLayout.LayoutParams(-1,-1));
        WebSettings s=webView.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);s.setCacheMode(WebSettings.LOAD_DEFAULT);s.setSupportZoom(false);s.setBuiltInZoomControls(false);s.setDisplayZoomControls(false);s.setTextZoom(100);s.setDefaultTextEncodingName("UTF-8");s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setUserAgentString(s.getUserAgentString()+APP_UA);
        CookieManager cm=CookieManager.getInstance();cm.setAcceptCookie(true);try{cm.setAcceptThirdPartyCookies(webView,false);}catch(Throwable ignored){}
        // Never expose a native JavaScript bridge to remote web content.
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                return handleNavigation(request.getUrl());
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(request.isForMainFrame())main.post(()->showGate("Không thể mở MedRef",
                    "Không tải được trang. Kiểm tra Internet rồi thử lại. Không có dữ liệu nào được tải hàng loạt.",
                    "Thử lại",v->loadOnlineApp(),"Đăng nhập",v->showEmbeddedLogin()));
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
                if(!request.isForMainFrame())return;
                int code=response.getStatusCode();
                if(code==401||code==403){
                    main.post(()->showGate("Phiên đăng nhập đã hết hạn",
                        "Cần đăng nhập MEDIPHARM để tiếp tục tra cứu.",
                        "Đăng nhập",v->showEmbeddedLogin(),null,null));
                }else if(code>=500){
                    main.post(()->showGate("Máy chủ đang bận",
                        "Dịch vụ MEDIPHARM tạm thời chưa phản hồi. Ứng dụng không tự thử lại liên tục để tránh tăng tải hosting.",
                        "Thử lại",v->loadOnlineApp(),null,null));
                }
            }
        });
        webView.setDownloadListener((url,userAgent,contentDisposition,mimeType,contentLength)->download(url,userAgent,contentDisposition,mimeType));
    }

    private void loadOnlineApp(){
        if(!networkAvailable()){
            showGate("Chưa có kết nối Internet","MedRef cần mạng để tra cứu. Không thực hiện tải bộ dữ liệu ngoại tuyến.",
                    "Thử lại",v->loadOnlineApp(),null,null);
            return;
        }
        if(!isMemberAuthenticated()){showEmbeddedLogin();return;}
        ensureWebView();
        gate.setVisibility(View.GONE);
        webContainer.setVisibility(View.VISIBLE);
        webView.loadUrl(START_URL);
    }

    private boolean handleNavigation(Uri uri){
        if(uri==null||uri.getScheme()==null)return true;
        String scheme=uri.getScheme().toLowerCase(Locale.ROOT);
        if("medref".equals(scheme)){
            String action=uri.getHost();
            if("login".equals(action))showEmbeddedLogin();
            else if("logout".equals(action))logout();
            else if("about".equals(action))showAbout();
            else if("check-update".equals(action))checkAppUpdate(true);
            else if("data-update".equals(action))loadOnlineApp();
            else if("rollback-data".equals(action))
                Toast.makeText(this,"MedRef trực tuyến không sử dụng gói ngoại tuyến.",Toast.LENGTH_LONG).show();
            return true;
        }
        if("https".equals(scheme)){
            if(isSachYHoc(uri)&&isLoginPath(uri.getPath())){showEmbeddedLogin();return true;}
            String path=uri.getPath()==null?"":uri.getPath().toLowerCase(Locale.ROOT);
            if("www.sachyhoc.com".equalsIgnoreCase(uri.getHost()) &&
                    (path.equals("/medipharm")||path.startsWith("/medipharm/")))return false;
            openExternal(uri);
            return true;
        }
        openExternal(uri);
        return true;
    }

    @SuppressWarnings("SetJavaScriptEnabled") private void showEmbeddedLogin(){
        if(loginDialog!=null&&loginDialog.isShowing())return;
        pendingLoginUser="";pendingLoginPassword="";pendingRemember=false;loginAttemptInjected=false;loginTransitionPending=false;

        Dialog d=new Dialog(this);d.requestWindowFeature(Window.FEATURE_NO_TITLE);d.setCanceledOnTouchOutside(true);loginDialog=d;
        LinearLayout frame=new LinearLayout(this);frame.setOrientation(LinearLayout.VERTICAL);frame.setPadding(dp(2),dp(2),dp(2),dp(2));
        GradientDrawable edge=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{Color.rgb(15,131,139),Color.rgb(109,207,207),Color.rgb(207,230,239)});
        edge.setCornerRadius(dp(28));frame.setBackground(edge);

        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(22),dp(18),dp(22),dp(18));
        GradientDrawable bg=new GradientDrawable();bg.setColor(Color.WHITE);bg.setCornerRadius(dp(26));card.setBackground(bg);frame.addView(card,new LinearLayout.LayoutParams(-1,-1));

        FrameLayout header=new FrameLayout(this);
        TextView title=new TextView(this);title.setText("Đăng nhập MEDIPHARM");title.setTextSize(23);title.setTextColor(Color.rgb(18,37,58));title.setTypeface(title.getTypeface(),android.graphics.Typeface.BOLD);
        header.addView(title,new FrameLayout.LayoutParams(-1,-2));
        TextView close=new TextView(this);close.setText("×");close.setTextSize(30);close.setTextColor(Color.rgb(100,110,118));close.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams cp=new FrameLayout.LayoutParams(dp(46),dp(46),Gravity.END|Gravity.TOP);header.addView(close,cp);close.setOnClickListener(v->d.dismiss());
        card.addView(header,new LinearLayout.LayoutParams(-1,-2));

        TextView intro=new TextView(this);intro.setText("Đăng nhập để đồng bộ và sử dụng MedRef Offline.");intro.setTextSize(14);intro.setTextColor(Color.rgb(92,111,124));
        LinearLayout.LayoutParams ip=new LinearLayout.LayoutParams(-1,-2);ip.setMargins(0,dp(2),0,dp(14));card.addView(intro,ip);

        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);scroll.addView(form,new ScrollView.LayoutParams(-1,-2));
        card.addView(scroll,new LinearLayout.LayoutParams(-1,0,1f));

        TextView ul=fieldLabel("Tên đăng nhập");form.addView(ul);
        EditText username=new EditText(this);username.setSingleLine(true);username.setHint("Nhập tên đăng nhập");username.setTextSize(16);username.setPadding(dp(14),0,dp(14),0);username.setBackground(fieldBackground());
        form.addView(username,new LinearLayout.LayoutParams(-1,dp(54)));

        TextView pl=fieldLabel("Mật khẩu");LinearLayout.LayoutParams plp=new LinearLayout.LayoutParams(-1,-2);plp.setMargins(0,dp(14),0,dp(6));form.addView(pl,plp);
        EditText password=new EditText(this);password.setSingleLine(true);password.setHint("Nhập mật khẩu");password.setTextSize(16);password.setPadding(dp(14),0,dp(14),0);
        password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);password.setBackground(fieldBackground());
        form.addView(password,new LinearLayout.LayoutParams(-1,dp(54)));

        CheckBox showPassword=new CheckBox(this);showPassword.setText("Hiện mật khẩu");showPassword.setTextSize(14);showPassword.setTextColor(Color.rgb(55,75,88));
        showPassword.setOnCheckedChangeListener((b,checked)->{int pos=password.getSelectionStart();password.setInputType(InputType.TYPE_CLASS_TEXT|(checked?InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD:InputType.TYPE_TEXT_VARIATION_PASSWORD));password.setSelection(Math.max(0,Math.min(pos,password.length())));});
        LinearLayout.LayoutParams shp=new LinearLayout.LayoutParams(-1,-2);shp.setMargins(0,dp(8),0,0);form.addView(showPassword,shp);

        CheckBox remember=new CheckBox(this);remember.setText("Lưu thông tin đăng nhập");remember.setTextSize(14);remember.setTextColor(Color.rgb(55,75,88));form.addView(remember);

        String[] saved=credentialStore==null?new String[]{"",""}:credentialStore.load();
        if(!saved[0].isEmpty()){username.setText(saved[0]);password.setText(saved[1]);remember.setChecked(true);}

        loginStatus=new TextView(this);loginStatus.setTextSize(13);loginStatus.setTextColor(Color.rgb(177,47,47));loginStatus.setVisibility(View.GONE);
        LinearLayout.LayoutParams lsp=new LinearLayout.LayoutParams(-1,-2);lsp.setMargins(0,dp(8),0,dp(4));form.addView(loginStatus,lsp);

        Button login=new Button(this);login.setAllCaps(false);login.setText("ĐĂNG NHẬP");login.setTextSize(16);login.setTextColor(Color.WHITE);login.setTypeface(login.getTypeface(),android.graphics.Typeface.BOLD);
        login.setBackground(buttonBackground(Color.rgb(13,126,136),0));
        LinearLayout.LayoutParams lbp=new LinearLayout.LayoutParams(-1,dp(54));lbp.setMargins(0,dp(10),0,dp(10));form.addView(login,lbp);

        Button register=new Button(this);register.setAllCaps(false);register.setText("ĐĂNG KÝ TÀI KHOẢN");register.setTextSize(15);register.setTextColor(Color.rgb(13,126,136));register.setTypeface(register.getTypeface(),android.graphics.Typeface.BOLD);
        register.setBackground(buttonBackground(Color.WHITE,Color.rgb(13,126,136)));form.addView(register,new LinearLayout.LayoutParams(-1,dp(52)));

        TextView note=new TextView(this);note.setText("Quyền thành viên và phạm vi truy cập vẫn do hệ thống Membership MEDIPHARM quản lý.");note.setTextSize(12);note.setTextColor(Color.rgb(115,128,137));note.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams np=new LinearLayout.LayoutParams(-1,-2);np.setMargins(0,dp(12),0,0);form.addView(note,np);

        loginView=new WebView(this);loginView.setAlpha(0.01f);loginView.setVisibility(View.INVISIBLE);
        WebSettings ws=loginView.getSettings();ws.setJavaScriptEnabled(true);ws.setDomStorageEnabled(true);ws.setDatabaseEnabled(true);ws.setCacheMode(WebSettings.LOAD_DEFAULT);ws.setUserAgentString(ws.getUserAgentString()+APP_UA);
        CookieManager cm=CookieManager.getInstance();cm.setAcceptCookie(true);try{cm.setAcceptThirdPartyCookies(loginView,true);}catch(Throwable ignored){}
        loginView.setWebChromeClient(new WebChromeClient());
        loginView.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String u){
                try{CookieManager.getInstance().flush();}catch(Throwable ignored){}
                if(isMemberAuthenticated()){completeLogin();return;}
                if(!loginAttemptInjected)return;
                Uri current=Uri.parse(u);
                if(isSachYHoc(current)&&isLoginPath(current.getPath()))setLoginStatus("Tên đăng nhập hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.");
            }
        });
        LinearLayout.LayoutParams hidden=new LinearLayout.LayoutParams(1,1);card.addView(loginView,hidden);

        login.setOnClickListener(v->{
            String user=username.getText().toString().trim(),pass=password.getText().toString();
            if(user.isEmpty()||pass.isEmpty()){setLoginStatus("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.");return;}
            pendingLoginUser=user;pendingLoginPassword=pass;pendingRemember=remember.isChecked();
            login.setEnabled(false);login.setText("ĐANG XÁC THỰC…");setLoginStatus("Đang xác thực tài khoản MEDIPHARM…",false);
            beginMembershipLogin(user,pass,remember.isChecked(),login);
        });
        register.setOnClickListener(v->openExternal(Uri.parse("https://www.sachyhoc.com/dangky")));

        d.setOnDismissListener(x->destroyLoginView());d.setContentView(frame);d.show();
        Window w=d.getWindow();if(w!=null){w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));WindowManager.LayoutParams a=w.getAttributes();a.dimAmount=.50f;w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);w.setLayout(Math.round(getResources().getDisplayMetrics().widthPixels*.92f),Math.min(Math.round(getResources().getDisplayMetrics().heightPixels*.76f),dp(720)));w.setGravity(Gravity.CENTER);}
    }

    private void beginMembershipLogin(String username,String password,boolean remember,Button loginButton){
        loginAttemptInjected=false;
        loginView.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String u){
                try{CookieManager.getInstance().flush();}catch(Throwable ignored){}
                if(isMemberAuthenticated()){completeLogin();return;}
                if(!loginAttemptInjected){
                    loginAttemptInjected=true;
                    String js="(function(){var u=document.querySelector('input[name=\"log\"],input[name=\"username\"],input[name=\"user_login\"],input[type=\"email\"]');"+
                            "var p=document.querySelector('input[name=\"pwd\"],input[name=\"password\"],input[type=\"password\"]');"+
                            "if(!u||!p)return 'NO_FIELDS';u.value="+JSONObject.quote(username)+";p.value="+JSONObject.quote(password)+";"+
                            "u.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('input',{bubbles:true}));"+
                            "var r=document.querySelector('input[name=\"rememberme\"],input[name*=\"remember\"]');if(r)r.checked="+(remember?"true":"false")+";"+
                            "var f=p.form||u.form||document.querySelector('form');if(!f)return 'NO_FORM';var b=f.querySelector('button[type=\"submit\"],input[type=\"submit\"]');if(b)b.click();else f.submit();return 'SUBMITTED';})()";
                    v.evaluateJavascript(js,value->{if(value!=null&&(value.contains("NO_FIELDS")||value.contains("NO_FORM"))){main.post(()->{loginButton.setEnabled(true);loginButton.setText("ĐĂNG NHẬP");setLoginStatus("Không tìm thấy biểu mẫu đăng nhập Membership. Vui lòng thử lại.");});}});
                    return;
                }
                main.postDelayed(()->{
                    if(!isMemberAuthenticated()){loginButton.setEnabled(true);loginButton.setText("ĐĂNG NHẬP");setLoginStatus("Đăng nhập chưa thành công. Vui lòng kiểm tra thông tin tài khoản.");}
                },600L);
            }
        });
        loginView.loadUrl(LOGIN_URL+"?medref_embed=1&redirect_to="+Uri.encode(LOGIN_RETURN));
    }

    private void completeLogin(){main.post(()->{
        if(loginTransitionPending)return;
        loginTransitionPending=true;
        try{CookieManager.getInstance().flush();}catch(Throwable ignored){}
        try{
            if(credentialStore!=null){
                if(pendingRemember)credentialStore.save(pendingLoginUser,pendingLoginPassword);
                else credentialStore.clear();
            }
        }catch(Exception e){Log.w(TAG,"credential store",e);}
        pendingLoginPassword="";
        Dialog d=loginDialog;loginDialog=null;
        if(d!=null&&d.isShowing())d.dismiss();
        loadOnlineApp();
    });}

    private void setLoginStatus(String message){setLoginStatus(message,true);}
    private void setLoginStatus(String message,boolean error){
        if(loginStatus==null)return;loginStatus.setText(message);loginStatus.setTextColor(error?Color.rgb(177,47,47):Color.rgb(13,126,136));loginStatus.setVisibility(View.VISIBLE);
    }

    private TextView fieldLabel(String text){
        TextView v=new TextView(this);v.setText(text);v.setTextSize(14);v.setTextColor(Color.rgb(18,37,58));v.setTypeface(v.getTypeface(),android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,dp(6));v.setLayoutParams(p);return v;
    }

    private GradientDrawable fieldBackground(){
        GradientDrawable g=new GradientDrawable();g.setColor(Color.rgb(249,252,253));g.setCornerRadius(dp(14));g.setStroke(dp(1),Color.rgb(210,225,230));return g;
    }

    private GradientDrawable buttonBackground(int fill,int stroke){
        GradientDrawable g=new GradientDrawable();g.setColor(fill);g.setCornerRadius(dp(16));if(stroke!=0)g.setStroke(dp(1),stroke);return g;
    }

    private void destroyLoginView(){WebView v=loginView;loginView=null;loginStatus=null;loginAttemptInjected=false;if(v!=null){try{v.stopLoading();}catch(Throwable ignored){}try{v.destroy();}catch(Throwable ignored){}}}

    private boolean isMemberAuthenticated(){String cookies=memberCookie();if(cookies.isEmpty())return false;for(String part:cookies.split(";")){int eq=part.indexOf('=');String name=(eq>=0?part.substring(0,eq):part).trim().toLowerCase(Locale.ROOT);if(name.startsWith("wordpress_logged_in_")||name.startsWith("wordpress_sec_")||(name.startsWith("wordpress_")&&!name.startsWith("wordpress_test_cookie")))return true;}return false;}
    private String memberCookie(){try{String c=CookieManager.getInstance().getCookie(MedRefDataRuntime.REMOTE_ROOT+"/");return c==null?"":c;}catch(Throwable e){return"";}}

    private void logout(){
        try{
            CookieManager cm=CookieManager.getInstance();
            String c=memberCookie();
            for(String part:c.split(";")){
                int eq=part.indexOf('=');String name=(eq>=0?part.substring(0,eq):part).trim();
                String low=name.toLowerCase(Locale.ROOT);
                if(low.startsWith("wordpress_logged_in_")||low.startsWith("wordpress_sec_")||
                   (low.startsWith("wordpress_")&&!low.startsWith("wordpress_test_cookie"))){
                    String expired=name+"=; Max-Age=0; Path=/; Secure; SameSite=Lax";
                    cm.setCookie("https://www.sachyhoc.com/",expired);
                    cm.setCookie("https://sachyhoc.com/",expired);
                }
            }
            cm.flush();
            if(credentialStore!=null)credentialStore.clear();
            if(webView!=null){webView.loadUrl("about:blank");webView.clearHistory();webView.clearCache(true);}
            showGate("MedRef","Đã đăng xuất. Dữ liệu lâm sàng được tra cứu trực tuyến; không lưu kho phác đồ trên thiết bị.",
                "Đăng nhập",v->showEmbeddedLogin(),null,null);
        }catch(Exception e){Toast.makeText(this,"Chưa thể đăng xuất.",Toast.LENGTH_SHORT).show();}
    }

    private void showAbout(){
        String message="MedRef là ứng dụng tham chiếu lâm sàng MEDIPHARM dành cho nhân viên y tế.\\n\\n"
                +"• Tra cứu phác đồ và quy trình trực tuyến theo chuyên khoa.\\n"
                +"• Tìm kiếm ICD-10 và liên kết phác đồ liên quan.\\n"
                +"• Chỉ tải danh sách ngắn hoặc nội dung khi được mở.\\n"
                +"• Sử dụng bộ nhớ đệm WebView theo chính sách máy chủ; không đồng bộ toàn bộ dữ liệu về thiết bị.\\n\\n"
                +"Tài khoản và quyền truy cập do MEDIPHARM Membership quản lý.\\n\\n"
                +"Phiên bản: "+BuildConfig.VERSION_NAME;
        new AlertDialog.Builder(this).setTitle("Giới thiệu MedRef")
                .setMessage(message).setPositiveButton("Đóng",null).show();
    }

    private void checkAppUpdate(boolean userVisible){new Thread(()->{
        try{
            JSONObject j=fetchUpdateManifest();
            int remote=j.optInt("versionCode",BuildConfig.VERSION_CODE);
            String name=j.optString("versionName","");
            String url=j.optString("downloadUrl","");
            String sha=j.optString("sha256","");
            main.post(()->{
                if(remote>BuildConfig.VERSION_CODE){
                    String msg="Phiên bản "+name+" đã sẵn sàng.";
                    if(sha.matches("(?i)[a-f0-9]{64}"))msg+="\n\nSHA-256: "+sha;
                    new AlertDialog.Builder(this).setTitle("Có phiên bản MedRef mới").setMessage(msg).setNegativeButton("Để sau",null)
                            .setPositiveButton("Tải cập nhật",(d,w)->{if(url.startsWith("https://"))openExternal(Uri.parse(url));}).show();
                }else if(userVisible)Toast.makeText(this,"MedRef đang ở phiên bản mới nhất ("+BuildConfig.VERSION_NAME+").",Toast.LENGTH_SHORT).show();
            });
        }catch(Exception e){
            Log.w(TAG,"app update check",e);
            if(userVisible)main.post(()->Toast.makeText(this,"Chưa thể kiểm tra phiên bản mới. Vui lòng kiểm tra kết nối mạng.",Toast.LENGTH_LONG).show());
        }
    },"MedRef-app-update").start();}

    private JSONObject fetchUpdateManifest()throws Exception{
        Exception first=null;
        try{return fetchPublicJson(BuildConfig.APP_UPDATE_MANIFEST_URL);}
        catch(Exception e){first=e;}
        try{return fetchPublicJson("https://raw.githubusercontent.com/lesangmd/Medref/main/medref-update.json?ts="+System.currentTimeMillis());}
        catch(Exception second){if(first!=null)second.addSuppressed(first);throw second;}
    }

    private JSONObject fetchPublicJson(String u)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(u).openConnection();
        c.setConnectTimeout(10000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Accept","application/json");c.setRequestProperty("Cache-Control","no-cache");c.setRequestProperty("User-Agent","MedRefAndroid/"+BuildConfig.VERSION_NAME);
        try{
            int status=c.getResponseCode();if(status!=200)throw new IllegalStateException("HTTP "+status);
            StringBuilder b=new StringBuilder();try(BufferedReader r=new BufferedReader(new InputStreamReader(c.getInputStream()))){String line;while((line=r.readLine())!=null)b.append(line);}
            JSONObject j=new JSONObject(b.toString());if(!j.has("versionCode")||!j.has("versionName"))throw new IllegalStateException("Manifest cập nhật không hợp lệ.");return j;
        }finally{c.disconnect();}
    }

    private void download(String url,String ua,String disposition,String mime){try{DownloadManager.Request r=new DownloadManager.Request(Uri.parse(url));r.setMimeType(mime);r.addRequestHeader("User-Agent",ua);String c=memberCookie();if(!c.isEmpty())r.addRequestHeader("Cookie",c);String name=URLUtil.guessFileName(url,disposition,mime);r.setTitle(name);r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,name);((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);}catch(Exception e){openExternal(Uri.parse(url));}}
    private boolean networkAvailable(){try{ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);Network n=cm.getActiveNetwork();if(n==null)return false;NetworkCapabilities c=cm.getNetworkCapabilities(n);return c!=null&&(c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));}catch(Exception e){return false;}}
    private static boolean isSachYHoc(Uri u){if(u==null||u.getHost()==null)return false;String h=u.getHost().toLowerCase(Locale.ROOT);return"sachyhoc.com".equals(h)||"www.sachyhoc.com".equals(h);}
    private static boolean isLoginPath(String p){if(p==null)return false;String x=p.toLowerCase(Locale.ROOT);return x.startsWith("/dangnhap")||x.startsWith("/dang-nhap")||x.startsWith("/wp-login.php");}
    private static boolean isLocal(Uri u){return u!=null&&LocalContentServer.HOST.equalsIgnoreCase(u.getHost());}
    private void openExternal(Uri u){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}}
    private String safe(Throwable e){String m=e==null?"":e.getMessage();return(m==null||m.trim().isEmpty())?"Lỗi không xác định.":m;}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}

    // No JavaScript bridge or background clinical-data sync in online-first mode.

    @Override public void onConfigurationChanged(Configuration newConfig){
        super.onConfigurationChanged(newConfig);
        if(root!=null)root.post(this::applySystemInsets);
    }

    @Override public void onBackPressed(){if(loginDialog!=null&&loginDialog.isShowing()){loginDialog.dismiss();return;}if(webView!=null&&webView.canGoBack()){webView.goBack();return;}super.onBackPressed();}
    @Override protected void onDestroy(){destroyLoginView();if(webView!=null){try{webView.destroy();}catch(Throwable ignored){}webView=null;}super.onDestroy();}
}
