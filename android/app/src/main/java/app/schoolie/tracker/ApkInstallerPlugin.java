package app.schoolie.tracker;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Fully in-app APK update (no browser).
 *
 * 1) Download APK over HTTPS into app-private storage
 * 2) Install via PackageInstaller session (system confirm sheet)
 *
 * Progress: notifyListeners("apkProgress", { percent, message })
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String TAG = "ApkInstaller";
    private static final String ACTION_INSTALL_COMPLETE =
            "app.schoolie.tracker.INSTALL_COMPLETE";
    private static final long DOWNLOAD_TIMEOUT_MS = 300_000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean cancelled = false;
    private BroadcastReceiver installReceiver;

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
                getActivity().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /**
     * Download APK inside the app, then open the system PackageInstaller UI.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String fileName = call.getString("fileName", "schoolie-update.apk");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
            } catch (Exception ignored) {
            }
            call.reject(
                    "Allow “Install unknown apps” for Cost Tracker in the screen that just opened, then tap Update again.");
            return;
        }

        cancelled = false;
        call.setKeepAlive(true);

        final AtomicBoolean finished = new AtomicBoolean(false);
        final Runnable timeout =
                () -> {
                    if (finished.compareAndSet(false, true) && call.isKeptAlive()) {
                        cancelled = true;
                        call.reject(
                                "Download timed out after 5 minutes. Check Wi‑Fi and try again.");
                    }
                };
        mainHandler.postDelayed(timeout, DOWNLOAD_TIMEOUT_MS);

        // Heartbeat so the UI never sits at 0% with no feedback
        final Runnable[] heartbeat = new Runnable[1];
        final long startMs = System.currentTimeMillis();
        heartbeat[0] =
                () -> {
                    if (finished.get() || cancelled) return;
                    long sec = (System.currentTimeMillis() - startMs) / 1000L;
                    emit(0, "Still downloading… " + sec + "s (large file, please wait)");
                    mainHandler.postDelayed(heartbeat[0], 2500);
                };
        mainHandler.postDelayed(heartbeat[0], 2500);

        new Thread(
                        () -> {
                            File apkFile = null;
                            try {
                                emit(0, "Connecting…");
                                Log.i(TAG, "download start: " + url);
                                apkFile = downloadToFile(url, fileName);
                                if (cancelled) {
                                    fail(call, timeout, finished, heartbeat[0], "Cancelled");
                                    return;
                                }
                                if (apkFile == null || apkFile.length() < 100_000L) {
                                    fail(
                                            call,
                                            timeout,
                                            finished,
                                            heartbeat[0],
                                            "Download incomplete ("
                                                    + (apkFile == null
                                                            ? 0
                                                            : apkFile.length())
                                                    + " bytes). Try again on Wi‑Fi.");
                                    return;
                                }

                                emit(99, "Preparing Install…");
                                final File toInstall = apkFile;
                                mainHandler.post(
                                        () -> {
                                            try {
                                                installWithPackageInstaller(toInstall);
                                                mainHandler.removeCallbacks(timeout);
                                                mainHandler.removeCallbacks(heartbeat[0]);
                                                finished.set(true);
                                                JSObject ok = new JSObject();
                                                ok.put("installed", true);
                                                ok.put("path", toInstall.getAbsolutePath());
                                                if (call.isKeptAlive()) {
                                                    call.resolve(ok);
                                                }
                                                emit(
                                                        100,
                                                        "Install screen ready — confirm Install");
                                            } catch (Exception e) {
                                                fail(
                                                        call,
                                                        timeout,
                                                        finished,
                                                        heartbeat[0],
                                                        "Could not start installer: "
                                                                + e.getMessage());
                                            }
                                        });
                            } catch (Exception e) {
                                Log.e(TAG, "download error", e);
                                fail(
                                        call,
                                        timeout,
                                        finished,
                                        heartbeat[0],
                                        "Download error: " + e.getMessage());
                            }
                        },
                        "in-app-apk-download")
                .start();
    }

    /**
     * Install APK bytes already downloaded in the WebView (fallback path).
     * data = base64 of the APK file.
     */
    @PluginMethod
    public void installBase64(PluginCall call) {
        final String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("data is required");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
            } catch (Exception ignored) {
            }
            call.reject(
                    "Allow “Install unknown apps” for Cost Tracker, then tap Update again.");
            return;
        }

        call.setKeepAlive(true);
        new Thread(
                        () -> {
                            try {
                                emit(92, "Saving package…");
                                String pure = data;
                                int comma = pure.indexOf(',');
                                if (pure.startsWith("data:") && comma > 0) {
                                    pure = pure.substring(comma + 1);
                                }
                                byte[] bytes = Base64.decode(pure, Base64.DEFAULT);
                                if (bytes == null || bytes.length < 100_000) {
                                    mainHandler.post(
                                            () ->
                                                    call.reject(
                                                            "Package data incomplete ("
                                                                    + (bytes == null
                                                                            ? 0
                                                                            : bytes.length)
                                                                    + " bytes)"));
                                    return;
                                }
                                File apkFile =
                                        new File(
                                                getContext().getFilesDir(),
                                                "schoolie-update.apk");
                                try (FileOutputStream out = new FileOutputStream(apkFile)) {
                                    out.write(bytes);
                                    out.flush();
                                }
                                emit(99, "Preparing Install…");
                                mainHandler.post(
                                        () -> {
                                            try {
                                                installWithPackageInstaller(apkFile);
                                                JSObject ok = new JSObject();
                                                ok.put("installed", true);
                                                ok.put("path", apkFile.getAbsolutePath());
                                                call.resolve(ok);
                                                emit(
                                                        100,
                                                        "Install screen ready — confirm Install");
                                            } catch (Exception e) {
                                                call.reject(
                                                        "Could not start installer: "
                                                                + e.getMessage());
                                            }
                                        });
                            } catch (Exception e) {
                                mainHandler.post(
                                        () ->
                                                call.reject(
                                                        "Could not save package: "
                                                                + e.getMessage()));
                            }
                        },
                        "install-base64")
                .start();
    }

    @PluginMethod
    public void installFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        try {
            installWithPackageInstaller(new File(path));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private File downloadToFile(String startUrl, String fileName) throws Exception {
        HttpURLConnection conn = openFollowingRedirects(startUrl);
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("HTTP " + code + " for " + conn.getURL());
            }
            long total = conn.getContentLengthLong();
            // Some CDNs omit length on the first connection — try header
            if (total <= 0) {
                String cl = conn.getHeaderField("Content-Length");
                if (cl != null) {
                    try {
                        total = Long.parseLong(cl.trim());
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            Log.i(TAG, "downloading " + conn.getURL() + " contentLength=" + total);

            File dir = getContext().getFilesDir();
            File apkFile = new File(dir, fileName);
            if (apkFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                apkFile.delete();
            }

            emit(1, "Downloading update inside the app…");
            try (InputStream in = new BufferedInputStream(conn.getInputStream(), 256 * 1024);
                    OutputStream out = new FileOutputStream(apkFile)) {
                byte[] buf = new byte[256 * 1024];
                long read = 0;
                int n;
                int lastPct = -1;
                long lastEmit = System.currentTimeMillis();
                while ((n = in.read(buf)) != -1) {
                    if (cancelled) {
                        throw new IllegalStateException("Cancelled");
                    }
                    out.write(buf, 0, n);
                    read += n;
                    long now = System.currentTimeMillis();
                    if (total > 0) {
                        int pct = (int) Math.min(99, (read * 100L) / total);
                        if (pct >= lastPct + 1 || now - lastEmit > 800) {
                            lastPct = pct;
                            lastEmit = now;
                            emit(
                                    pct,
                                    "Downloading… "
                                            + pct
                                            + "% ("
                                            + (read / (1024 * 1024))
                                            + " MB)");
                        }
                    } else if (now - lastEmit > 600) {
                        lastEmit = now;
                        int fake = (int) Math.min(90, 5 + read / (200 * 1024));
                        emit(
                                fake,
                                "Downloading… " + (read / (1024 * 1024)) + " MB");
                    }
                }
                out.flush();
            }
            Log.i(TAG, "download complete bytes=" + apkFile.length());
            return apkFile;
        } finally {
            conn.disconnect();
        }
    }

    private void installWithPackageInstaller(File apk) throws Exception {
        if (!apk.exists() || apk.length() < 100_000L) {
            throw new IllegalStateException("APK file missing or too small");
        }

        Context ctx = getContext();
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(
                        PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());

        int sessionId = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(sessionId);

        try (InputStream in = new BufferedInputStream(new FileInputStream(apk));
                OutputStream out = session.openWrite("package", 0, apk.length())) {
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            session.fsync(out);
        }

        registerInstallReceiver();

        Intent callback = new Intent(ACTION_INSTALL_COMPLETE);
        callback.setPackage(ctx.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent pending = PendingIntent.getBroadcast(ctx, sessionId, callback, flags);
        session.commit(pending.getIntentSender());
        session.close();
    }

    private void registerInstallReceiver() {
        if (installReceiver != null) return;
        installReceiver =
                new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        int status =
                                intent.getIntExtra(
                                        PackageInstaller.EXTRA_STATUS,
                                        PackageInstaller.STATUS_FAILURE);
                        JSObject ev = new JSObject();
                        ev.put("status", status);
                        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            Intent confirm =
                                    intent.getParcelableExtra(Intent.EXTRA_INTENT);
                            if (confirm != null) {
                                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                try {
                                    getContext().startActivity(confirm);
                                    ev.put("message", "Confirm Install on the next screen");
                                } catch (Exception e) {
                                    ev.put("message", e.getMessage());
                                }
                            }
                        } else if (status == PackageInstaller.STATUS_SUCCESS) {
                            ev.put("message", "Installed — open the app from the home screen");
                        } else {
                            String msg =
                                    intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                            ev.put(
                                    "message",
                                    msg != null ? msg : "Install failed (" + status + ")");
                        }
                        notifyListeners("apkInstallStatus", ev);
                    }
                };
        IntentFilter filter = new IntentFilter(ACTION_INSTALL_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext()
                    .registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(installReceiver, filter);
        }
    }

    /**
     * Follow GitHub → Azure release redirects. Prefer manual follow so we keep
     * User-Agent and handle 302/307/308 correctly on all API levels.
     */
    private HttpURLConnection openFollowingRedirects(String startUrl) throws Exception {
        String current = startUrl;
        HttpURLConnection conn = null;
        for (int i = 0; i < 12; i++) {
            URL u = new URL(current);
            conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(45_000);
            conn.setReadTimeout(180_000);
            conn.setDoInput(true);
            conn.setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 13) ProjectCostTracker-InAppUpdater/2.0");
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.connect();
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_SEE_OTHER
                    || code == 307
                    || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) {
                    throw new IllegalStateException("Redirect without Location (HTTP " + code + ")");
                }
                // Resolve relative redirects
                current = new URL(u, loc).toString();
                emit(0, "Redirecting to download server…");
                Log.i(TAG, "redirect → " + current);
                continue;
            }
            return conn;
        }
        throw new IllegalStateException("Too many redirects");
    }

    private void emit(int percent, String message) {
        JSObject p = new JSObject();
        p.put("percent", percent);
        p.put("message", message);
        mainHandler.post(() -> notifyListeners("apkProgress", p));
    }

    private void fail(
            PluginCall call,
            Runnable timeout,
            AtomicBoolean finished,
            Runnable heartbeat,
            String msg) {
        mainHandler.post(
                () -> {
                    mainHandler.removeCallbacks(timeout);
                    if (heartbeat != null) mainHandler.removeCallbacks(heartbeat);
                    if (finished.compareAndSet(false, true) && call.isKeptAlive()) {
                        call.reject(msg);
                    }
                    emit(-1, msg);
                });
    }

    @Override
    protected void handleOnDestroy() {
        cancelled = true;
        if (installReceiver != null) {
            try {
                getContext().unregisterReceiver(installReceiver);
            } catch (Exception ignored) {
            }
            installReceiver = null;
        }
        super.handleOnDestroy();
    }
}
