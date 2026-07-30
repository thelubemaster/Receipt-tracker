#!/usr/bin/env bash
# Build Schoolie Android APK (installable like a normal app)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-arm64}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "Java 21 required at $JAVA_HOME" >&2
  exit 1
fi
if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "ANDROID_HOME not found: $ANDROID_HOME" >&2
  exit 1
fi

# aarch64 aapt2 override (Google's is x86_64 only)
AAPT2="$ROOT/tools/aapt2-aarch64/aapt2"
if [[ -x "$AAPT2" ]]; then
  if ! grep -q aapt2FromMavenOverride android/gradle.properties 2>/dev/null; then
    echo "android.aapt2FromMavenOverride=$AAPT2" >> android/gradle.properties
  else
    sed -i "s|android.aapt2FromMavenOverride=.*|android.aapt2FromMavenOverride=$AAPT2|" android/gradle.properties
  fi
fi

echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# Keep Android versionName / versionCode aligned with package.json + app-update.json
PKG_VER="$(node -p "require('./package.json').version")"
APK_CODE="$(node -p "const fs=require('fs');const j=JSON.parse(fs.readFileSync('public/app-update.json','utf8'));j.apkVersionCode||0")"
if [[ -n "$PKG_VER" && "$APK_CODE" != "0" ]]; then
  echo "Syncing Android versionName=$PKG_VER versionCode=$APK_CODE"
  sed -i "s/versionCode [0-9]*/versionCode $APK_CODE/" android/app/build.gradle
  sed -i "s/versionName \"[^\"]*\"/versionName \"$PKG_VER\"/" android/app/build.gradle
fi

echo "Building web assets…"
npm run build

echo "Syncing Capacitor…"
npx cap sync android

echo "Building APK…"
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
mkdir -p "$ROOT/public/downloads" "$ROOT/dist/downloads"
cp -f "$APK" "$ROOT/public/downloads/schoolie.apk"
cp -f "$APK" "$ROOT/dist/downloads/schoolie.apk"
echo ""
echo "✓ APK ready: public/downloads/schoolie.apk"
ls -lh "$ROOT/public/downloads/schoolie.apk"
