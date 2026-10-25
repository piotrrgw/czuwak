package pl.pkp.czuwak;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

public class CzuwakWidgetBridge {
    private final Context context;

    public CzuwakWidgetBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void updateWidget(String trainInfo, String nextStation, String distStr, String timeStr, String delayStr, String speedStr, String statusStr) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
            prefs.edit()
                .putBoolean("is_active", true)
                .putString("train_info", trainInfo != null ? trainInfo : "")
                .putString("next_station", nextStation != null ? nextStation : "")
                .putString("dist_str", distStr != null ? distStr : "")
                .putString("time_str", timeStr != null ? timeStr : "")
                .putString("delay_str", delayStr != null ? delayStr : "")
                .putString("speed_str", speedStr != null ? speedStr : "")
                .putString("status_str", statusStr != null ? statusStr : "")
                .putLong("last_updated", System.currentTimeMillis())
                .apply();

            CzuwakWidgetProvider.updateAllWidgets(context);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public void clearWidget() {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
            prefs.edit()
                .putBoolean("is_active", false)
                .apply();

            CzuwakWidgetProvider.updateAllWidgets(context);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
