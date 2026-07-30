package app.schoolie.tracker;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app APK update for home-screen icon / native shell.
 *
 * Strategies (fastest first):
 * 1) openApkUrl — hand HTTPS URL to the system (browser / package installer)
 * 2) downloadAndInstall — stream to app storage on a background thread, then install
 *
 * Never leave the JS bridge hanging: every public method resolves or rejects quickly,
 * except downloadAndInstall which reports progress and has a hard timeout.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final long DOWNLOAD_TIMEOUT_MS = 180_000L;

    private long downloadId = -1L;
    private BroadcastReceiver completeReceiver;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean downloadCancelled = false;

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ret.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            ret.put("allowed", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open install permission settings: " + e.getMessage());
        }
    }

    /**
     * Immediate: open the APK HTTPS URL with the system. Resolves right away.
     * User may get a download notification or browser — then Install.
     */
    @PluginMethod
    public void openApkUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // Prefer browser / download handler for https
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            getContext().startActivity(intent);
            JSObject ok = new JSObject();
            ok.put("opened", true);
            call.resolve(ok);
        } catch (ActivityNotFoundException e) {
            call.reject("No app can open this download link");
        } catch (Exception e) {
            call.reject("Could not open URL: " + e.getMessage());
        }
    }

    /**
     * Stream APK to app files dir, then open package installer.
     * Resolves when the installer is launched (or on error / timeout).
     * Sends progress via notifyListeners("apkProgress", { percent, message }).
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String fileName = call.getString("fileName", "schoolie-update.apk");

        // Permission nudge (non-blocking)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        downloadCancelled = false;
        call.setKeepAlive(true);

        // Hard timeout so JS never spins forever
        mainHandler.postDelayed(
                () -> {
                    if (call.isKeptAlive()) {
                        downloadCancelled = true;
                        call.reject(
                                "Download timed out. Check your connection, or allow Install unknown apps, then try again.");
                    }
                },
                DOWNLOAD_TIMEOUT_MS);

        new Thread(
                        () -> {
                            File outFile = null;
                            HttpURLConnection conn = null;
                            try {
                                emitProgress(0, "Connecting…");
                                URL u = new URL(url);
                                conn = (HttpURLConnection) u.openConnection();
                                conn.setInstanceFollowRedirects(true);
                                conn.setConnectTimeout(30_000);
                                conn.setReadTimeout(60_000);
                                conn.setRequestProperty("User-Agent", "ProjectCostTracker-Updater");
                                conn.connect();

                                // Follow up to 5 redirects manually if needed
                                int code = conn.getResponseCode();
                                int redirects = 0;
                                while ((code == HttpURLConnection.HTTP_MOVED_TEMP
                                                || code == HttpURLConnection.HTTP_MOVED_PERM
                                                || code == HttpURLConnection.HTTP_SEE_OTHER
                                                || code == 307
                                                || code == 308)
                                        && redirects < 5) {
                                    String loc = conn.getHeaderField("Location");
                                    conn.disconnect();
                                    conn = (HttpURLConnection) new URL(loc).openConnection();
                                    conn.setInstanceFollowRedirects(true);
                                    conn.setConnectTimeout(30_000);
                                    conn.setReadTimeout(60_000);
                                    conn.setRequestProperty(
                                            "User-Agent", "ProjectCostTracker-Updater");
                                    conn.connect();
                                    code = conn.getResponseCode();
                                    redirects++;
                                }

                                if (code < 200 || code >= 300) {
                                    fail(call, "Download failed (HTTP " + code + ")");
                                    return;
                                }

                                int total = conn.getContentLength();
                                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                                if (dir == null) {
                                    dir = getContext().getFilesDir();
                                }
                                //noinspection ResultOfMethodCallIgnored
                                dir.mkdirs();
                                outFile = new File(dir, fileName);
                                if (outFile.exists()) {
                                    //noinspection ResultOfMethodCallIgnored
                                    outFile.delete();
                                }

                                emitProgress(1, "Downloading update…");
                                try (InputStream in =
                                                new BufferedInputStream(conn.getInputStream());
                                        FileOutputStream out = new FileOutputStream(outFile)) {
                                    byte[] buf = new byte[64 * 1024];
                                    long read = 0;
                                    int n;
                                    int lastPct = -1;
                                    while ((n = in.read(buf)) != -1) {
                                        if (downloadCancelled) {
                                            fail(call, "Download cancelled");
                                            return;
                                        }
                                        out.write(buf, 0, n);
                                        read += n;
                                        if (total > 0) {
                                            int pct = (int) Math.min(99, (read * 100) / total);
                                            if (pct != lastPct && pct % 5 == 0) {
                                                lastPct = pct;
                                                emitProgress(
                                                        pct,
                                                        "Downloading… " + pct + "%");
                                            }
                                        }
                                    }
                                    out.flush();
                                }

                                if (outFile.length() < 100_000) {
                                    fail(
                                            call,
                                            "Download too small ("
                                                    + outFile.length()
                                                    + " bytes) — file may be missing on the server");
                                    return;
                                }

                                emitProgress(100, "Opening installer…");
                                final File installFile = outFile;
                                mainHandler.post(
                                        () -> {
                                            try {
                                                installApkFile(installFile);
                                                JSObject ok = new JSObject();
                                                ok.put("installed", true);
                                                ok.put("path", installFile.getAbsolutePath());
                                                if (call.isKeptAlive()) call.resolve(ok);
                                            } catch (Exception e) {
                                                fail(call, "Could not open installer: " + e.getMessage());
                                            }
                                        });
                            } catch (Exception e) {
                                fail(call, "Download error: " + e.getMessage());
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        },
                        "apk-download")
                .start();
    }

    /**
     * Legacy DownloadManager path (optional) — starts and returns immediately.
     */
    @PluginMethod
    public void enqueueSystemDownload(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String fileName = call.getString("fileName", "schoolie-update.apk");
        try {
            DownloadManager dm =
                    (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("DownloadManager unavailable");
                return;
            }
            File destDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (destDir != null) {
                File prev = new File(destDir, fileName);
                if (prev.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    prev.delete();
                }
            }
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("Project Cost Tracker");
            req.setDescription("Downloading app update…");
            req.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setMimeType("application/vnd.android.package-archive");
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(true);
            req.setDestinationInExternalFilesDir(
                    getContext(), Environment.DIRECTORY_DOWNLOADS, fileName);

            unregisterReceiverSafe();
            completeReceiver =
                    new BroadcastReceiver() {
                        @Override
                        public void onReceive(Context context, Intent intent) {
                            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                            if (id != downloadId) return;
                            handleDownloadComplete(dm, id);
                        }
                    };
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext()
                        .registerReceiver(
                                completeReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(completeReceiver, filter);
            }
            downloadId = dm.enqueue(req);
            JSObject started = new JSObject();
            started.put("started", true);
            started.put("downloadId", downloadId);
            // Resolve immediately — do not hang the web layer
            call.resolve(started);
        } catch (Exception e) {
            call.reject("Enqueue failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void installFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        try {
            installApkFile(new File(path));
            call.resolve();
        } catch (Exception e) {
            call.reject("Install failed: " + e.getMessage());
        }
    }

    private void handleDownloadComplete(DownloadManager dm, long id) {
        unregisterReceiverSafe();
        DownloadManager.Query q = new DownloadManager.Query();
        q.setFilterById(id);
        try (Cursor c = dm.query(q)) {
            if (c == null || !c.moveToFirst()) return;
            int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
            if (c.getInt(statusIdx) != DownloadManager.STATUS_SUCCESSFUL) return;
            int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
            String localUri = uriIdx >= 0 ? c.getString(uriIdx) : null;
            if (localUri == null) return;
            try {
                if (localUri.startsWith("file:")) {
                    installApkFile(new File(Uri.parse(localUri).getPath()));
                } else {
                    installContentUri(Uri.parse(localUri));
                }
            } catch (Exception ignored) {
            }
        }
    }

    private void installApkFile(File file) {
        Uri uri =
                FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private void installContentUri(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private void emitProgress(int percent, String message) {
        JSObject p = new JSObject();
        p.put("percent", percent);
        p.put("message", message);
        notifyListeners("apkProgress", p);
    }

    private void fail(PluginCall call, String msg) {
        mainHandler.post(
                () -> {
                    if (call.isKeptAlive()) call.reject(msg);
                });
    }

    private void unregisterReceiverSafe() {
        if (completeReceiver != null) {
            try {
                getContext().unregisterReceiver(completeReceiver);
            } catch (Exception ignored) {
            }
            completeReceiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        downloadCancelled = true;
        unregisterReceiverSafe();
        super.handleOnDestroy();
    }
}
