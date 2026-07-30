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

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Fully in-app APK update (no browser).
 *
 * 1) Download APK over HTTPS into app-private storage (background thread)
 * 2) Install via PackageInstaller session (system confirm sheet — not Chrome)
 *
 * Progress: notifyListeners("apkProgress", { percent, message })
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String ACTION_INSTALL_COMPLETE =
            "app.schoolie.tracker.INSTALL_COMPLETE";
    private static final long DOWNLOAD_TIMEOUT_MS = 240_000L;

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
     * No browser. Resolves when the install sheet is shown (or on error/timeout).
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final String fileName = call.getString("fileName", "schoolie-update.apk");

        // Must allow installs from this app (still inside Settings, not a browser)
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

        final Runnable timeout =
                () -> {
                    if (call.isKeptAlive()) {
                        cancelled = true;
                        call.reject("Download timed out. Check Wi‑Fi and try again.");
                    }
                };
        mainHandler.postDelayed(timeout, DOWNLOAD_TIMEOUT_MS);

        new Thread(
                        () -> {
                            File apkFile = null;
                            HttpURLConnection conn = null;
                            try {
                                emit(0, "Connecting to update server…");
                                conn = openFollowingRedirects(url);
                                int code = conn.getResponseCode();
                                if (code < 200 || code >= 300) {
                                    fail(call, timeout, "Download failed (HTTP " + code + ")");
                                    return;
                                }
                                long total = conn.getContentLengthLong();
                                File dir = getContext().getFilesDir();
                                apkFile = new File(dir, fileName);
                                if (apkFile.exists()) {
                                    //noinspection ResultOfMethodCallIgnored
                                    apkFile.delete();
                                }

                                emit(1, "Downloading update inside the app…");
                                try (InputStream in =
                                                new BufferedInputStream(conn.getInputStream());
                                        OutputStream out =
                                                new java.io.FileOutputStream(apkFile)) {
                                    byte[] buf = new byte[128 * 1024];
                                    long read = 0;
                                    int n;
                                    int lastPct = -1;
                                    while ((n = in.read(buf)) != -1) {
                                        if (cancelled) {
                                            fail(call, timeout, "Cancelled");
                                            return;
                                        }
                                        out.write(buf, 0, n);
                                        read += n;
                                        if (total > 0) {
                                            int pct = (int) Math.min(99, (read * 100L) / total);
                                            if (pct >= lastPct + 2) {
                                                lastPct = pct;
                                                emit(pct, "Downloading… " + pct + "%");
                                            }
                                        } else if (read % (512 * 1024) < 128 * 1024) {
                                            emit(
                                                    Math.min(90, (int) (read / (150 * 1024))),
                                                    "Downloading… "
                                                            + (read / (1024 * 1024))
                                                            + " MB");
                                        }
                                    }
                                    out.flush();
                                }

                                if (apkFile.length() < 100_000L) {
                                    fail(
                                            call,
                                            timeout,
                                            "Download incomplete ("
                                                    + apkFile.length()
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
                                                JSObject ok = new JSObject();
                                                ok.put("installed", true);
                                                ok.put("path", toInstall.getAbsolutePath());
                                                if (call.isKeptAlive()) {
                                                    call.resolve(ok);
                                                }
                                                emit(100, "Install screen ready — confirm Install");
                                            } catch (Exception e) {
                                                fail(
                                                        call,
                                                        timeout,
                                                        "Could not start installer: "
                                                                + e.getMessage());
                                            }
                                        });
                            } catch (Exception e) {
                                fail(call, timeout, "Download error: " + e.getMessage());
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        },
                        "in-app-apk-download")
                .start();
    }

    /** Install an already-downloaded APK from absolute path (in-app only). */
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

    /**
     * PackageInstaller session — system install confirmation, no browser.
     */
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
                OutputStream out =
                        session.openWrite("package", 0, apk.length())) {
            byte[] buf = new byte[128 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            session.fsync(out);
        }

        // Callback when user finishes install UI
        registerInstallReceiver();

        Intent callback = new Intent(ACTION_INSTALL_COMPLETE);
        callback.setPackage(ctx.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent pending =
                PendingIntent.getBroadcast(ctx, sessionId, callback, flags);
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
                            ev.put("message", msg != null ? msg : "Install failed (" + status + ")");
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

    private HttpURLConnection openFollowingRedirects(String startUrl) throws Exception {
        String current = startUrl;
        HttpURLConnection conn = null;
        for (int i = 0; i < 8; i++) {
            URL u = new URL(current);
            conn = (HttpURLConnection) u.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(30_000);
            conn.setReadTimeout(120_000);
            conn.setRequestProperty("User-Agent", "ProjectCostTracker-InAppUpdater/1.0");
            conn.setRequestProperty("Accept", "*/*");
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_SEE_OTHER
                    || code == 307
                    || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null) throw new IllegalStateException("Redirect without Location");
                if (loc.startsWith("/")) {
                    loc = u.getProtocol() + "://" + u.getHost() + loc;
                }
                current = loc;
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
        notifyListeners("apkProgress", p);
    }

    private void fail(PluginCall call, Runnable timeout, String msg) {
        mainHandler.post(
                () -> {
                    mainHandler.removeCallbacks(timeout);
                    if (call.isKeptAlive()) call.reject(msg);
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
