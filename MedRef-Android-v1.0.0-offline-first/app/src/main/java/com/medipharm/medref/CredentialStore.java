package com.medipharm.medref;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class CredentialStore {
    private static final String PREFS="medref_credentials";
    private static final String KEY_ALIAS="MedRefCredentialsV1";
    private final SharedPreferences prefs;

    public CredentialStore(Context context){
        prefs=context.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    }

    public void save(String username,String password)throws Exception{
        SecretKey key=getOrCreateKey();
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,key);
        byte[] encrypted=cipher.doFinal(password.getBytes(StandardCharsets.UTF_8));
        prefs.edit()
                .putString("username",username==null?"":username)
                .putString("password_iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
                .putString("password_cipher",Base64.encodeToString(encrypted,Base64.NO_WRAP))
                .apply();
    }

    public String[] load(){
        try{
            String username=prefs.getString("username","");
            String iv=prefs.getString("password_iv","");
            String enc=prefs.getString("password_cipher","");
            if(username.isEmpty()||iv.isEmpty()||enc.isEmpty())return new String[]{"",""};
            KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
            java.security.Key key=ks.getKey(KEY_ALIAS,null);
            if(!(key instanceof SecretKey))return new String[]{"",""};
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,(SecretKey)key,new GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)));
            String password=new String(cipher.doFinal(Base64.decode(enc,Base64.NO_WRAP)),StandardCharsets.UTF_8);
            return new String[]{username,password};
        }catch(Exception e){return new String[]{"",""};}
    }

    public void clear(){
        prefs.edit().clear().apply();
    }

    private static SecretKey getOrCreateKey()throws Exception{
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        java.security.Key existing=ks.getKey(KEY_ALIAS,null);
        if(existing instanceof SecretKey)return (SecretKey)existing;
        KeyGenerator kg=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }
}
