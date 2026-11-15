# Android app

The Android app is the desktop app's Tauri v2 project built for Android (`apps/client/src-tauri`, generated project in
`gen/android`). It shows the same React UI in the system web view. Floating bubbles, the updater and the loopback
sign-in listener are desktop-only; `apps/app/src/platform.ts` tells the platforms apart.

## Build tools

JDK 17, the Android SDK (platform 37, build-tools 37, NDK 30), and the four Rust Android targets:

```
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME`. Then, from the repo root:

```
pnpm --filter @orvo/client tauri android build --debug --apk --target x86_64   # emulator
pnpm --filter @orvo/client tauri android build --apk                           # all phone ABIs
```

The APK is in `apps/client/src-tauri/gen/android/app/build/outputs/apk/universal/`.

Debug APKs, whether built on a developer machine or on GitHub, are signed with `gen/android/app/debug.keystore`, which is in
the repository and public (password `android`). Every build then has the same signature, so a new APK installs over the
old one. Never use this key for anything that is published; the Play Store needs a release key that is kept secret. The
key's SHA-1 is `27:9C:DC:CC:7C:22:7E:43:33:4D:02:11:2C:AA:F6:49:61:64:96:70`, for the Android OAuth client in Google Cloud Console. Release APKs are signed with a separate
keystore that is never in the repository (below). The Release workflow builds debug APKs only on a manual run, as
short-lived artifacts for testing.

## Release signing

A release APK is signed with a key only you hold. Whoever has it can publish updates that install over your app, and if it
is lost, installed apps can never be updated, so keep a backup (password manager or offline) before anything else.

1. Make the keystore once, on your own machine (not in the repository):
   ```
   keytool -genkeypair -v -keystore orvo-release.keystore -alias orvo -keyalg RSA -keysize 4096 -validity 10000
   ```
   It asks for a keystore password and a key password (they may be the same) and for a name.
2. Add four repository secrets (Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (`base64 -w0 orvo-release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
   (`orvo` above) and `ANDROID_KEY_PASSWORD`. Then delete any copy of the keystore outside your backup.
3. Push a version tag as in `docs/releasing.md`. The `android-release` job builds the arm64 APK, verifies its signature
   (it fails if the APK is unsigned or signed with the debug key) and attaches it to the draft release.
4. Print the release key's SHA-1 with `keytool -list -v -keystore orvo-release.keystore` and register it on the Android OAuth
   client in Google Cloud Console, in addition to the debug key's, or sign-in fails in release builds.

To build a signed release locally, export `ORVO_ANDROID_KEYSTORE` (path), `ORVO_ANDROID_KEYSTORE_PASSWORD`,
`ORVO_ANDROID_KEY_ALIAS` and `ORVO_ANDROID_KEY_PASSWORD`, then run `pnpm --filter @orvo/client tauri android build --apk`.
Without them the release build is left unsigned (it cannot be installed) rather than signed with the debug key.

Release builds forbid cleartext traffic and are not debuggable, which debug builds allow. This is a sideloaded APK, not
yet a Play Store build: the Store needs an app bundle (`--aab`) and its own listing and key arrangement.

## Signing in with Google

Google issues Android clients with no secret and requires the redirect `dev.orvo.app:/oauth2redirect`, which Android
hands to the app as a deep link. In Google Cloud Console create an **Android** client with package name `dev.orvo.app`
and the SHA-1 of the signing key (the debug key for debug builds), then run the server with
`OIDC_ANDROID_CLIENT_ID=<that client id>`. Tokens for it are accepted alongside the others.
