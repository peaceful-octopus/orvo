# Releasing the desktop app

Windows and macOS installers are built by `.github/workflows/release.yml` when a version tag is pushed. The workflow attaches an
NSIS installer, an MSI, a universal macOS `.dmg`, and `latest.json` (the update manifest) to a **draft** GitHub Release. Publishing the draft
rolls it out: installed apps poll `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.

## One-time setup

1. **Push the repository to GitHub.** The workflow replaces `OWNER/REPO` in `apps/desktop/src-tauri/tauri.conf.json`
   with the repository it runs in, so no address is edited by hand.
2. **Add the update signing key as repository secrets** (Settings → Secrets and variables → Actions):
   `TAURI_SIGNING_PRIVATE_KEY` (the contents of the key file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   The matching public key is `plugins.updater.pubkey` in `tauri.conf.json`. Installed apps accept an update only if
   it is signed by this key, so **keep the key and its password somewhere safe. If they are lost, installed apps can
   never be updated again** and everyone has to reinstall.

   To make a new key pair (this invalidates updates for apps built with the old public key):
   `pnpm --filter @orvo/desktop exec tauri signer generate -w <path-to-key> -p <password>`, then put the printed public
   key in `tauri.conf.json`.

## Making a release

```
pnpm version:set 1.0.0        # root package.json, desktop package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git commit -am "Release 1.0.0"
git tag v1.0.0
git push origin main v1.0.0
```

Versions are `x.y.z` numbers only (the Windows MSI and the app's version comparison need it). CI fails if the files
disagree (`pnpm version:check`), and the release workflow fails if the tag differs from the version.

The same tag also builds the server image and publishes it to `ghcr.io/<owner>/orvo` as `latest`, the version (`0.2.0`) and the short commit, so the server and the apps are released together. Unlike the desktop release this is not a draft: `latest` moves as soon as the job finishes, and a server that pulls `latest` is updated on its next pull. Pin `ORVO_IMAGE` to a version tag to avoid that.

The image job signs in with the workflow's own token, so the package must allow this repository's Actions to write to it: on the package's page (Package settings → Manage Actions access), add the repository with the Write role. A package that was first pushed by hand needs this once.

When the workflow finishes, open the draft release, check the assets, and publish it. Apps check for updates on
start and every six hours, and show a banner outside calls with **Restart and update**.

If you retire old versions, set `MIN_CLIENT_VERSION` on the server. An app older than that shows "Update required",
with a **Restart and update** button when the update server is reachable, and `updateUrl` otherwise.

## Not signed yet

The installers are not code-signed. macOS Gatekeeper blocks the first launch (on macOS 15 and later, open the app once, then choose Open Anyway in System Settings, Privacy & Security, or run `xattr -dr com.apple.quarantine /Applications/Orvo.app`), and Windows SmartScreen warns on first run ("Windows protected your PC", then
More info → Run anyway). The update signature above is separate: it protects updates, not the first install. Code
signing needs a certificate or Azure Trusted Signing; Tauri's `bundle.windows.signCommand` is where it plugs in.

On macOS, ad-hoc signing needs no account but does not stop the Gatekeeper warning, and neither does a self-signed
certificate. Only a Developer ID certificate plus notarization, which needs the paid Apple Developer Program, does.
Tauri reads it from the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` and `APPLE_TEAM_ID` environment variables, which the workflows would pass to the build step.

## Building an installer locally

`pnpm --filter @orvo/desktop build` produces unsigned installers in `apps/desktop/src-tauri/target/release/bundle/`.
Those builds contain the placeholder update address, so they never find an update. To also produce the update
artifacts locally, set `TAURI_SIGNING_PRIVATE_KEY` (or its path) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and add
`--config src-tauri/tauri.release.conf.json` after the build command.
