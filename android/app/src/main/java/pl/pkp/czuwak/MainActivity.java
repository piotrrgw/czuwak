package pl.pkp.czuwak;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static final int REQUEST_CODE_PICK_FOLDER = 9922;

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

    public void openFolderPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                          | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                          | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(intent, REQUEST_CODE_PICK_FOLDER);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_PICK_FOLDER && resultCode == RESULT_OK && data != null) {
            Uri treeUri = data.getData();
            if (treeUri != null) {
                try {
                    getContentResolver().takePersistableUriPermission(
                        treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    );
                } catch (Exception ignored) {}

                SharedPreferences prefs = getSharedPreferences(CzuwakLogWriter.PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(CzuwakLogWriter.KEY_LOG_TREE_URI, treeUri.toString()).apply();

                final String displayName = CzuwakLogWriter.getLogFolderDisplay(this);
                if (this.bridge != null && this.bridge.getWebView() != null) {
                    this.bridge.getWebView().post(new Runnable() {
                        @Override
                        public void run() {
                            bridge.getWebView().evaluateJavascript(
                                "if (typeof window.onLogFolderPicked === 'function') { window.onLogFolderPicked('" + displayName.replace("'", "\\'") + "'); }",
                                null
                            );
                        }
                    });
                }
            }
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
