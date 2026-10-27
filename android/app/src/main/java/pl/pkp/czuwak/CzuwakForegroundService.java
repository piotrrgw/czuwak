package pl.pkp.czuwak;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

public class CzuwakForegroundService extends Service {
    public static final String CHANNEL_ID = "czuwak_fg_location_channel";
    public static final int NOTIFICATION_ID = 9410;

    public static final String ACTION_START_OR_UPDATE = "pl.pkp.czuwak.ACTION_FG_START_OR_UPDATE";
    public static final String ACTION_STOP = "pl.pkp.czuwak.ACTION_FG_STOP";

    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_TEXT = "extra_text";

    private PowerManager.WakeLock wakeLock;
    private static boolean isRunning = false;
    private static String lastTitle = "";
    private static String lastText = "";

    public static void startOrUpdate(Context context, String title, String text) {
        if (context == null) return;
        String cleanTitle = (title != null && !title.isEmpty()) ? title : "Czuwak GPS aktywny";
        String cleanText = (text != null && !text.isEmpty()) ? text : "Śledzenie pozycji pociągu na szlaku";

        if (isRunning && cleanTitle.equals(lastTitle) && cleanText.equals(lastText)) {
            return;
        }
        lastTitle = cleanTitle;
        lastText = cleanText;

        try {
            Intent intent = new Intent(context, CzuwakForegroundService.class);
            intent.setAction(ACTION_START_OR_UPDATE);
            intent.putExtra(EXTRA_TITLE, cleanTitle);
            intent.putExtra(EXTRA_TEXT, cleanText);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static void stop(Context context) {
        if (context == null) return;
        lastTitle = "";
        lastText = "";
        try {
            Intent intent = new Intent(context, CzuwakForegroundService.class);
            context.stopService(intent);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        acquireCpuWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = "Czuwak GPS aktywny";
        String text = "Śledzenie pozycji pociągu na szlaku";
        if (intent != null) {
            String t = intent.getStringExtra(EXTRA_TITLE);
            String tx = intent.getStringExtra(EXTRA_TEXT);
            if (t != null && !t.isEmpty()) title = t;
            if (tx != null && !tx.isEmpty()) text = tx;
        }

        Notification notification = buildNotification(title, text);

        if (!isRunning) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                isRunning = true;
            } catch (Exception e) {
                try {
                    startForeground(NOTIFICATION_ID, notification);
                    isRunning = true;
                } catch (Exception ignored) {}
            }
        } else {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIFICATION_ID, notification);
                }
            } catch (Exception ignored) {}
        }

        return START_STICKY;
    }

    private Notification buildNotification(String title, String text) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openIntent, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Czuwak – Praca GPS w tle",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Utrzymuje ciągłe śledzenie GPS pociągu przy wygaszonym ekranie");
                channel.setShowBadge(false);
                channel.enableVibration(false);
                channel.setSound(null, null);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void acquireCpuWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Czuwak::LocationWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(12 * 60 * 60 * 1000L);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void releaseCpuWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void stopForegroundCompat() {
        isRunning = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        releaseCpuWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
