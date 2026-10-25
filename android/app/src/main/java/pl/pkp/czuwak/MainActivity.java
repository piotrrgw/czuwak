package pl.pkp.czuwak;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().addJavascriptInterface(new CzuwakWidgetBridge(this), "CzuwakNativeWidget");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        CzuwakWidgetProvider.updateAllWidgets(this);
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().post(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            bridge.getWebView().evaluateJavascript("if (typeof window.syncPendingWidgetEvents === 'function') { window.syncPendingWidgetEvents(); }", null);
                        } catch (Exception ignored) {}
                    }
                });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
