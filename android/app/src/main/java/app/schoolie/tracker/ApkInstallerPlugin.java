package app.schoolie.tracker;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * In-app APK update: download from URL (GitHub Releases) then open the system installer.
 * Used for native changes (launcher icon, plugins) that web OTA cannot update.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private long downloadId = -1L;
    private PluginCall pendingCall;
    private BroadcastReceiver completeReceiver;

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
     * Download APK with system DownloadManager, then open the package installer.
     * call: { url: string, fileName?: string }
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String fileName = call.getString("fileName", "schoolie-update.apk");

        // Prompt for "install unknown apps" if needed (user must grant once)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {
            }
            // Continue anyway — user can grant and retry; also download in background
        }

        try {
            unregisterReceiverSafe();
            pendingCall = call;
            call.setKeepAlive(true);

            DownloadManager dm =
                    (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("DownloadManager unavailable");
                return;
            }

            // Clear previous file if present
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
                getContext().registerReceiver(completeReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(completeReceiver, filter);
            }

            downloadId = dm.enqueue(req);

            JSObject started = new JSObject();
            started.put("started", true);
            started.put("downloadId", downloadId);
            // Keep call open until complete — also notify progress via events
            notifyListeners("apkDownloadStarted", started);
        } catch (Exception e) {
            pendingCall = null;
            call.reject("Download failed to start: " + e.getMessage());
        }
    }

    /**
     * Install a local APK path (absolute filesystem path).
     */
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
        PluginCall call = pendingCall;
        pendingCall = null;
        unregisterReceiverSafe();

        DownloadManager.Query q = new DownloadManager.Query();
        q.setFilterById(id);
        try (Cursor c = dm.query(q)) {
            if (c == null || !c.moveToFirst()) {
                if (call != null) call.reject("Download finished but status unknown");
                return;
            }
            int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int status = c.getInt(statusIdx);
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reasonIdx = c.getColumnIndex(DownloadManager.COLUMN_REASON);
                int reason = reasonIdx >= 0 ? c.getInt(reasonIdx) : -1;
                if (call != null) call.reject("Download failed (status=" + status + ", reason=" + reason + ")");
                return;
            }
            int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
            String localUri = uriIdx >= 0 ? c.getString(uriIdx) : null;
            File file = null;
            if (localUri != null) {
                if (localUri.startsWith("file:")) {
                    file = new File(Uri.parse(localUri).getPath());
                } else {
                    // content:// from DownloadManager
                    try {
                        installContentUri(Uri.parse(localUri));
                        JSObject ok = new JSObject();
                        ok.put("installed", true);
                        if (call != null) call.resolve(ok);
                        return;
                    } catch (Exception e) {
                        if (call != null) call.reject("Could not open installer: " + e.getMessage());
                        return;
                    }
                }
            }
            if (file == null || !file.exists()) {
                File destDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (destDir != null) {
                    // find newest apk
                    File[] list = destDir.listFiles((dir, name) -> name.endsWith(".apk"));
                    if (list != null && list.length > 0) {
                        file = list[0];
                        for (File f : list) {
                            if (f.lastModified() > file.lastModified()) file = f;
                        }
                    }
                }
            }
            if (file == null || !file.exists()) {
                if (call != null) call.reject("Downloaded APK file not found");
                return;
            }
            try {
                installApkFile(file);
                JSObject ok = new JSObject();
                ok.put("installed", true);
                ok.put("path", file.getAbsolutePath());
                if (call != null) call.resolve(ok);
            } catch (Exception e) {
                if (call != null) call.reject("Could not open installer: " + e.getMessage());
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
        unregisterReceiverSafe();
        super.handleOnDestroy();
    }
}
