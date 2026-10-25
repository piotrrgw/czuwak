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

public class CzuwakWidgetProvider extends AppWidgetProvider {

    public static final String ACTION_CZUWAK_WIDGET_UPDATE = "pl.pkp.czuwak.ACTION_UPDATE_WIDGET";

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

            // Kliknięcie w widget uruchamia aplikację Czuwak (MainActivity)
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

            if (isActive) {
                views.setViewVisibility(R.id.widget_active_container, View.VISIBLE);
                views.setViewVisibility(R.id.widget_idle_container, View.GONE);

                String trainInfo = prefs.getString("train_info", "Pociąg");
                String nextStation = prefs.getString("next_station", "W drodze...");
                String distStr = prefs.getString("dist_str", "-- km");
                String timeStr = prefs.getString("time_str", "--:--");
                String delayStr = prefs.getString("delay_str", "Planowo");
                String speedStr = prefs.getString("speed_str", "0 km/h");
                String statusStr = prefs.getString("status_str", "");

                views.setTextViewText(R.id.widget_train_title, trainInfo);
                views.setTextViewText(R.id.widget_station_name, nextStation);
                views.setTextViewText(R.id.widget_distance, distStr);
                views.setTextViewText(R.id.widget_time, timeStr);
                views.setTextViewText(R.id.widget_delay, delayStr);
                views.setTextViewText(R.id.widget_speed, speedStr);
                views.setTextViewText(R.id.widget_duty, statusStr);

                if (delayStr != null && delayStr.contains("+")) {
                    views.setTextColor(R.id.widget_delay, 0xFFFBBF24); // Żółty/pomarańczowy przy opóźnieniu
                } else {
                    views.setTextColor(R.id.widget_delay, 0xFF4ADE80); // Zielony przy planowej jeździe
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
        if (ACTION_CZUWAK_WIDGET_UPDATE.equals(intent.getAction())) {
            updateAllWidgets(context);
        }
    }
}
