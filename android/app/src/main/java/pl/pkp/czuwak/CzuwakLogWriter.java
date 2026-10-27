package pl.pkp.czuwak;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;

import androidx.documentfile.provider.DocumentFile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class CzuwakLogWriter {
    public static final String PREFS_NAME = "czuwak_log_prefs";
    public static final String KEY_LOG_TREE_URI = "log_tree_uri";

    public static synchronized boolean appendToFile(Context context, String filename, String text) {
        if (context == null || filename == null || filename.isEmpty() || text == null) {
            return false;
        }

        // 1. Zapis do folderu wybranego przez użytkownika (Storage Access Framework)
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String treeUriStr = prefs.getString(KEY_LOG_TREE_URI, null);
            if (treeUriStr != null && !treeUriStr.isEmpty()) {
                Uri treeUri = Uri.parse(treeUriStr);
                DocumentFile dir = DocumentFile.fromTreeUri(context, treeUri);
                if (dir != null && dir.exists() && dir.canWrite()) {
                    DocumentFile targetFile = dir.findFile(filename);
                    if (targetFile == null) {
                        targetFile = dir.createFile("text/plain", filename);
                    }
                    if (targetFile != null) {
                        OutputStream os = context.getContentResolver().openOutputStream(targetFile.getUri(), "wa");
                        if (os != null) {
                            os.write(text.getBytes(StandardCharsets.UTF_8));
                            os.flush();
                            os.close();
                            return true;
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 2. Domyślny fallback: folder Pobrane / Czuwak_Logi
        try {
            File baseDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Czuwak_Logi");
            if (!baseDir.exists()) {
                baseDir.mkdirs();
            }
            File targetFile = new File(baseDir, filename);
            FileOutputStream fos = new FileOutputStream(targetFile, true);
            fos.write(text.getBytes(StandardCharsets.UTF_8));
            fos.flush();
            fos.close();
            return true;
        } catch (Exception fallbackErr) {
            // 3. Ostateczny fallback: pamięć prywatna aplikacji (zawsze dostępna)
            try {
                File fallbackDir = new File(context.getExternalFilesDir(null), "czuwak_logs");
                if (!fallbackDir.exists()) {
                    fallbackDir.mkdirs();
                }
                File targetFile = new File(fallbackDir, filename);
                FileOutputStream fos = new FileOutputStream(targetFile, true);
                fos.write(text.getBytes(StandardCharsets.UTF_8));
                fos.flush();
                fos.close();
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }

    public static String getLogFolderDisplay(Context context) {
        if (context == null) return "Pobrane / Czuwak_Logi (Domyślny)";
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String treeUriStr = prefs.getString(KEY_LOG_TREE_URI, null);
            if (treeUriStr != null && !treeUriStr.isEmpty()) {
                Uri treeUri = Uri.parse(treeUriStr);
                String folder = treeUri.getLastPathSegment();
                if (folder != null && folder.contains(":")) {
                    folder = folder.substring(folder.indexOf(":") + 1);
                }
                if (folder != null && !folder.isEmpty()) {
                    return folder;
                }
                return "Wybrany folder";
            }
        } catch (Exception ignored) {}

        return "Pobrane / Czuwak_Logi (Domyślny)";
    }
}
