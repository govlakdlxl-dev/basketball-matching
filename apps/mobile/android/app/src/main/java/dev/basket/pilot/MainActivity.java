package dev.basket.pilot;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.widget.TextView;
import androidx.webkit.WebViewFeature;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {registerPlugin(SessionVaultPlugin.class);super.onCreate(savedInstanceState);}
    @Override protected void load() {
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView text=new TextView(this);text.setText("보안 연결을 사용할 수 없습니다. Android System WebView를 업데이트해 주세요.");setContentView(text);return;
        }
        super.load();
    }
}
