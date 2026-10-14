package dev.basket.pilot;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name="SessionVault")
public final class SessionVaultPlugin extends Plugin {
    private static final String ALIAS="basket.session.v1";
    private boolean ready() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && !getBridge().getConfig().isUsingLegacyBridge()
            && getBridge().getWebView() instanceof SecureCapacitorWebView
            && !((SecureCapacitorWebView)getBridge().getWebView()).wasLegacyBridgeRejected();
    }
    private String key(PluginCall call) {
        if (!ready()) { call.reject("보안 연결을 사용할 수 없습니다.","SECURE_BRIDGE_UNAVAILABLE"); return null; }
        String key=call.getString("key");
        if (key==null || key.length()>256 || !(key.startsWith("sb-") || key.startsWith("basket."))) { call.reject("보관소 요청이 유효하지 않습니다.","INVALID_VAULT_KEY"); return null; }
        return key;
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("basket_auth_cipher",Context.MODE_PRIVATE); }
    private SecretKey secret() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS,null);
    }
    @PluginMethod public void getItem(PluginCall call) {
        String key=key(call);if(key==null)return;
        try {String encrypted=prefs().getString(key,null);JSObject result=new JSObject();
            if(encrypted==null) {result.put("value",org.json.JSONObject.NULL);call.resolve(result);return;}
            String[] parts=encrypted.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            result.put("value",new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));call.resolve(result);
        }catch(Exception error){call.reject("보관소를 사용할 수 없습니다.","VAULT_UNAVAILABLE");}
    }
    @PluginMethod public void setItem(PluginCall call) {
        String key=key(call),value=call.getString("value");if(key==null)return;
        if(value==null || value.getBytes(StandardCharsets.UTF_8).length>65536){call.reject("보관소 입력이 유효하지 않습니다.","INVALID_VAULT_VALUE");return;}
        try {Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secret());cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            String encoded=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
            if(!prefs().edit().putString(key,encoded).commit())throw new Exception();call.resolve();
        }catch(Exception error){call.reject("보관소를 사용할 수 없습니다.","VAULT_UNAVAILABLE");}
    }
    @PluginMethod public void removeItem(PluginCall call) {String key=key(call);if(key==null)return;if(prefs().edit().remove(key).commit())call.resolve();else call.reject("보관소를 사용할 수 없습니다.","VAULT_UNAVAILABLE");}
}
