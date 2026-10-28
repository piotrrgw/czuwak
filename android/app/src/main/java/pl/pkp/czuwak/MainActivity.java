package pl.pkp.czuwak;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    public static final int REQUEST_CODE_PICK_FOLDER = 9922;
    private static MainActivity instance;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().addJavascriptInterface(new CzuwakWidgetBridge(this), "CzuwakNativeWidget");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    public static void sendLocationToWebView(final Location location) {
        if (instance != null && location != null) {
            instance.postLocation(location);
        }
    }

    public void postLocation(final Location loc) {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().post(new Runnable() {
                @Override
                public void run() {
                    try {
                        String js = String.format(Locale.US,
                            "if (typeof window.onNativeLocationUpdate === 'function') { window.onNativeLocationUpdate(%f, %f, %f, %f, %d); }",
                            loc.getLatitude(),
                            loc.getLongitude(),
                            loc.hasSpeed() ? loc.getSpeed() : -1.0,
                            loc.hasAccuracy() ? loc.getAccuracy() : 25.0,
                            loc.getTime()
                        );
                        bridge.getWebView().evaluateJavascript(js, null);
                    } catch (Exception ignored) {}
                }
            });
        }
    }

    public void strobeTorch(final int count, final int delayMs) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        CameraManager cameraManager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
                        if (cameraManager == null) return;
                        String cameraId = null;
                        for (String id : cameraManager.getCameraIdList()) {
                            CameraCharacteristics chars = cameraManager.getCameraCharacteristics(id);
                            Boolean flashAvailable = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                            Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
                            if (flashAvailable != null && flashAvailable && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                                cameraId = id;
                                break;
                            }
                        }
                        if (cameraId == null && cameraManager.getCameraIdList().length > 0) {
                            cameraId = cameraManager.getCameraIdList()[0];
                        }
                        if (cameraId != null) {
                            int numFlashes = count > 0 ? count : 6;
                            int delay = delayMs > 0 ? delayMs : 150;
                            for (int i = 0; i < numFlashes; i++) {
                                cameraManager.setTorchMode(cameraId, true);
                                Thread.sleep(delay);
                                cameraManager.setTorchMode(cameraId, false);
                                Thread.sleep(delay);
                            }
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }).start();
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

    @Override
    public void onPause() {
        super.onPause();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().resumeTimers();
        }
    }
}
