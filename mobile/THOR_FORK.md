# Orca Mobile for AYN Thor

This fork changes only the Android mobile app. It does not change the Orca desktop app, its RPC
protocol, or the macOS release/update path.

## What the lower screen does

When a terminal is open on the upper screen, the app opens a native Android `Presentation` on the
Thor secondary display. The lower screen provides:

- a real Android text field, so system IMEs can compose Chinese and other multi-stage input before
  anything is sent;
- Send, Enter, Esc, Tab, arrow, Backspace, and Ctrl-C controls;
- quick `continue`, `yes`, and `no` replies;
- the active worktree/terminal name and connection state.

Input goes through the existing `terminal.send` RPC used by Orca Mobile. It is not injected as
cross-app Android key events, and the desktop app needs no fork.

The presentation starts only when Android reports AYN Thor hardware and a secondary presentation
display. Debug builds deliberately allow Android's simulated secondary display for development.

## Install a built APK

The fork uses the package id `dev.orca.thor.mobile` and the app label **Orca Thor**, so it does not
replace the official mobile package.

```sh
adb install -r orca-thor-android-arm64.apk
```

Pair it with the unmodified desktop app in the normal way. If both official and Thor builds are
installed, scan the QR code from inside Orca Thor to avoid Android asking which app should handle an
`orca://` link.

The local release build currently uses Android's debug certificate. It is intended for personal
sideloading, not Play Store distribution. Keep the same checkout/keystore when installing updates;
otherwise uninstall the previous build first.

## Rebuild on macOS

Prerequisites are pnpm, JDK 17, and an Android SDK with platform/build tools 36 and NDK
27.1.12297006. Then run:

```sh
cd mobile
pnpm install
pnpm build:thor:android
```

The arm64 APK is written to `mobile/dist/orca-thor-android-arm64.apk`.

## Keep up with upstream

The fork's `main` branch is the stable Thor build. Keep `upstream` pointed at official Orca and
merge upstream updates into the fork before starting a new feature branch:

```sh
git fetch upstream
git switch main
git merge upstream/main
cd mobile
pnpm install
pnpm test
pnpm typecheck
pnpm build:thor:android
```

Create new work on a focused branch from the verified `main` branch. All intentional fork changes
live under `mobile/`, which keeps conflicts away from the desktop app in normal upstream updates.
