package pl.pkp.czuwak;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

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
    public void updateWidgetFull(String jsonStr) {
        if (context == null || jsonStr == null) return;
        try {
            JSONObject obj = new JSONObject(jsonStr);
            SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();

            editor.putBoolean("is_active", true);
            editor.putString("train_info", obj.optString("trainInfo", "Pociąg"));
            editor.putString("origin_station", obj.optString("originStation", "Odjazd: trasa pociągu"));
            editor.putString("next_station", obj.optString("nextStation", "W drodze..."));
            editor.putString("next_station_clean", obj.optString("nextStationClean", ""));
            editor.putInt("next_station_idx", obj.optInt("nextStationIdx", -1));
            editor.putString("dist_str", obj.optString("distStr", "-- km"));
            editor.putString("time_str", obj.optString("timeStr", "Przyjazd: --:--"));
            editor.putInt("delay_minutes", obj.optInt("delayMinutes", 0));
            editor.putString("delay_str", obj.optString("delayStr", "Planowo"));
            editor.putString("speed_str", obj.optString("speedStr", "0 km/h"));
            editor.putString("status_str", obj.optString("statusStr", "🔵 NA SZLAKU"));
            editor.putString("crew_tag", obj.optString("crewTag", ""));
            editor.putBoolean("is_handover", obj.optBoolean("isHandover", false));
            editor.putBoolean("is_standing", obj.optBoolean("isStanding", false));
            editor.putInt("duty_progress", obj.optInt("dutyProgressPercent", 0));
            editor.putString("duty_stations", obj.optString("dutyStationsStr", ""));
            editor.putLong("last_updated", System.currentTimeMillis());

            editor.apply();

            CzuwakWidgetProvider.updateAllWidgets(context);

            String fgTitle = obj.optString("trainInfo", "Czuwak GPS aktywny");
            String fgNext = obj.optString("nextStationClean", obj.optString("nextStation", ""));
            String fgDist = obj.optString("distStr", "");
            String fgSpeed = obj.optString("speedStr", "");
            String fgSub = fgNext;
            if (!fgDist.isEmpty()) fgSub += " (" + fgDist + ")";
            if (!fgSpeed.isEmpty()) fgSub += " • " + fgSpeed;
            if (!fgSub.isEmpty()) {
                CzuwakForegroundService.startOrUpdate(context, fgTitle, "Nast.: " + fgSub);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @JavascriptInterface
    public void startForegroundTracking(String title, String text) {
        if (context == null) return;
        CzuwakForegroundService.startOrUpdate(context, title, text);
    }

    @JavascriptInterface
    public void stopForegroundTracking() {
        if (context == null) return;
        CzuwakForegroundService.stop(context);
    }

    @JavascriptInterface
    public String getPendingEvents() {
        if (context == null) return "{}";
        try {
            SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
            boolean stopChecked = prefs.getBoolean("pending_stop_checked", false);
            boolean delayChanged = prefs.getBoolean("pending_delay_changed", false);

            if (!stopChecked && !delayChanged) {
                return "{}";
            }

            JSONObject res = new JSONObject();
            if (stopChecked) {
                res.put("stopChecked", true);
                res.put("stopIdx", prefs.getInt("pending_stop_idx", -1));
                res.put("stopTime", prefs.getString("pending_stop_time", ""));
            }
            if (delayChanged) {
                res.put("delayChanged", true);
                res.put("delayMinutes", prefs.getInt("pending_delay_val", 0));
            }

            prefs.edit()
                .putBoolean("pending_stop_checked", false)
                .putBoolean("pending_delay_changed", false)
                .apply();

            return res.toString();
        } catch (Exception e) {
            e.printStackTrace();
            return "{}";
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
            CzuwakForegroundService.stop(context);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
