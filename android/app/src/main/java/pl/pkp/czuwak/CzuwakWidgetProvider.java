package pl.pkp.czuwak;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class CzuwakWidgetProvider extends AppWidgetProvider {

    public static final String ACTION_CZUWAK_WIDGET_UPDATE = "pl.pkp.czuwak.ACTION_UPDATE_WIDGET";
    public static final String ACTION_CHECK_STOP = "pl.pkp.czuwak.ACTION_CHECK_STOP";
    public static final String ACTION_ADD_DELAY = "pl.pkp.czuwak.ACTION_ADD_DELAY";

    public static void updateAllWidgets(Context context) {
        try {
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            ComponentName thisWidget = new ComponentName(context, CzuwakWidgetProvider.class);
            int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget);
            if (appWidgetIds != null && appWidgetIds.length > 0) {
                for (int widgetId : appWidgetIds) {
                    updateAppWidget(context, appWidgetManager, widgetId);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
            boolean isActive = prefs.getBoolean("is_active", false);

            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.czuwak_app_widget);

            // Kliknięcie w całe tło widgetu otwiera aplikację Czuwak (MainActivity)
            Intent openAppIntent = new Intent(context, MainActivity.class);
            openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int openFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                openFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent openPendingIntent = PendingIntent.getActivity(context, 0, openAppIntent, openFlags);
            views.setOnClickPendingIntent(R.id.widget_root, openPendingIntent);

            // Przycisk akcji: [✓ Odhacz postój]
            Intent checkStopIntent = new Intent(context, CzuwakWidgetProvider.class);
            checkStopIntent.setAction(ACTION_CHECK_STOP);
            int broadcastFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                broadcastFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent checkStopPending = PendingIntent.getBroadcast(context, 101, checkStopIntent, broadcastFlags);
            views.setOnClickPendingIntent(R.id.widget_btn_check_stop, checkStopPending);

            // Przycisk akcji: [+5m] (Szybkie podbicie opóźnienia)
            Intent addDelayIntent = new Intent(context, CzuwakWidgetProvider.class);
            addDelayIntent.setAction(ACTION_ADD_DELAY);
            PendingIntent addDelayPending = PendingIntent.getBroadcast(context, 102, addDelayIntent, broadcastFlags);
            views.setOnClickPendingIntent(R.id.widget_btn_add_delay, addDelayPending);

            if (isActive) {
                views.setViewVisibility(R.id.widget_active_container, View.VISIBLE);
                views.setViewVisibility(R.id.widget_idle_container, View.GONE);

                String trainInfo = prefs.getString("train_info", "Pociąg");
                String originStation = prefs.getString("origin_station", "Odjazd: trasa pociągu");
                String nextStation = prefs.getString("next_station", "W drodze...");
                String distStr = prefs.getString("dist_str", "-- km");
                String timeStr = prefs.getString("time_str", "Przyjazd: --:--");
                String delayStr = prefs.getString("delay_str", "Planowo");
                String speedStr = prefs.getString("speed_str", "0 km/h");
                String statusStr = prefs.getString("status_str", "🔵 NA SZLAKU");
                String crewTag = prefs.getString("crew_tag", "");
                boolean isHandover = prefs.getBoolean("is_handover", false);
                boolean isStanding = prefs.getBoolean("is_standing", false);
                int dutyProgress = prefs.getInt("duty_progress", 0);
                String dutyStations = prefs.getString("duty_stations", "");

                // Ustawienia pól tekstowych
                views.setTextViewText(R.id.widget_train_title, trainInfo);
                views.setTextViewText(R.id.widget_origin_station, originStation);
                views.setTextViewText(R.id.widget_station_name, nextStation);
                views.setTextViewText(R.id.widget_distance, distStr);
                views.setTextViewText(R.id.widget_time, timeStr);
                views.setTextViewText(R.id.widget_speed, speedStr);
                views.setTextViewText(R.id.widget_delay, delayStr);
                views.setTextViewText(R.id.widget_train_status, statusStr);

                // Kolor opóźnienia
                if (delayStr != null && delayStr.contains("+")) {
                    views.setTextColor(R.id.widget_delay, 0xFFFBBF24); // Bursztynowy
                } else {
                    views.setTextColor(R.id.widget_delay, 0xFF4ADE80); // Zielony
                }

                // Kolor dynamicznego statusu
                if (statusStr != null && (statusStr.contains("POSTÓJ") || statusStr.contains("Postój"))) {
                    views.setTextColor(R.id.widget_train_status, 0xFF4ADE80);
                } else if (statusStr != null && statusStr.contains("ZBLIŻANIE")) {
                    views.setTextColor(R.id.widget_train_status, 0xFFFB923C);
                } else {
                    views.setTextColor(R.id.widget_train_status, 0xFF38BDF8);
                }

                // Plakietka stacji zmiany DK
                if (isHandover) {
                    views.setViewVisibility(R.id.widget_handover_badge, View.VISIBLE);
                } else {
                    views.setViewVisibility(R.id.widget_handover_badge, View.GONE);
                }

                // Znacznik drużyny (Crew Tag)
                if (crewTag != null && !crewTag.trim().isEmpty()) {
                    views.setViewVisibility(R.id.widget_crew_tag, View.VISIBLE);
                    views.setTextViewText(R.id.widget_crew_tag, crewTag.trim());
                } else {
                    views.setViewVisibility(R.id.widget_crew_tag, View.GONE);
                }

                // Pasek postępu służby DK
                views.setProgressBar(R.id.widget_progress_bar, 100, Math.max(0, Math.min(100, dutyProgress)), false);
                String progressLabel = "Służba DK: " + dutyProgress + "%";
                if (dutyStations != null && !dutyStations.trim().isEmpty()) {
                    progressLabel = "Służba (" + dutyProgress + "%): " + dutyStations;
                }
                views.setTextViewText(R.id.widget_duty_progress, progressLabel);

                // Przycisk postoju
                if (isStanding) {
                    views.setTextViewText(R.id.widget_btn_check_stop, "✓ Postój zaliczony");
                } else {
                    views.setTextViewText(R.id.widget_btn_check_stop, "✓ Odhacz postój");
                }

            } else {
                views.setViewVisibility(R.id.widget_active_container, View.GONE);
                views.setViewVisibility(R.id.widget_idle_container, View.VISIBLE);
            }

            appWidgetManager.updateAppWidget(appWidgetId, views);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;

        if (ACTION_CHECK_STOP.equals(action)) {
            try {
                SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
                int stationIdx = prefs.getInt("next_station_idx", -1);
                String nowTime = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date());

                prefs.edit()
                    .putBoolean("pending_stop_checked", true)
                    .putInt("pending_stop_idx", stationIdx)
                    .putString("pending_stop_time", nowTime)
                    .putBoolean("is_standing", true)
                    .putString("status_str", "🟢 Postój zaliczony: " + nowTime)
                    .apply();

                updateAllWidgets(context);
            } catch (Exception e) {
                e.printStackTrace();
            }
        } else if (ACTION_ADD_DELAY.equals(action)) {
            try {
                SharedPreferences prefs = context.getSharedPreferences("czuwak_widget_prefs", Context.MODE_PRIVATE);
                int curDelay = prefs.getInt("delay_minutes", 0);
                int newDelay = curDelay + 5;

                prefs.edit()
                    .putInt("delay_minutes", newDelay)
                    .putString("delay_str", "+" + newDelay + " min")
                    .putBoolean("pending_delay_changed", true)
                    .putInt("pending_delay_val", newDelay)
                    .apply();

                updateAllWidgets(context);
            } catch (Exception e) {
                e.printStackTrace();
            }
        } else if (ACTION_CZUWAK_WIDGET_UPDATE.equals(action)) {
            updateAllWidgets(context);
        }
    }
}
