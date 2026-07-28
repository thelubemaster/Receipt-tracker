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
