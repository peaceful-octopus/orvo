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
key's SHA-1 is `27:9C:DC:CC:7C:22:7E:43:33:4D:02:11:2C:AA:F6:49:61:64:96:70`, for the Android OAuth client in Google Cloud Console. Release APKs need a signing
keystore, which is not set up yet.

## Signing in with Google

Google issues Android clients with no secret and requires the redirect `dev.orvo.app:/oauth2redirect`, which Android
hands to the app as a deep link. In Google Cloud Console create an **Android** client with package name `dev.orvo.app`
and the SHA-1 of the signing key (the debug key for debug builds), then run the server with
`OIDC_ANDROID_CLIENT_ID=<that client id>`. Tokens for it are accepted alongside the others.
