package dev.basket.pilot;
import android.content.Context;
import android.util.AttributeSet;
import com.getcapacitor.CapacitorWebView;
public final class SecureCapacitorWebView extends CapacitorWebView {
    private boolean legacyBridgeRejected;
    public SecureCapacitorWebView(Context context, AttributeSet attrs) { super(context, attrs); }
    @Override public void addJavascriptInterface(Object object, String name) {
        if ("androidBridge".equals(name)) { legacyBridgeRejected = true; return; }
        super.addJavascriptInterface(object, name);
    }
    public boolean wasLegacyBridgeRejected() { return legacyBridgeRejected; }
}
