# FiOTP

FiOTP is an offline TOTP and HOTP authenticator for macOS. It stores accounts in a local vault encrypted with AES-256-GCM and generates verification codes on-device.

The application is built with [GeaStack](https://www.npmjs.com/package/@geastack/cli) using TypeScript and TSX. GeaStack compiles the interface from `src/index.tsx`. The native bridge in `native/fiotp_host.mm`, together with `scripts/fiotp-host-plugin.mjs`, provides macOS file, cryptography, camera, and system integration. The project also includes a separate native Android application under `android/`, implemented in Kotlin and Jetpack Compose. It shares this repository and the FiOTP vault format; it does not use the GeaStack Android WebView target. The web target remains an interface preview.

## Requirements

- macOS
- Node.js and npm
- Xcode Command Line Tools (`xcode-select --install`) for Apple builds
- JDK 17 or newer and Android SDK Platform 36 for Android builds

## Installation

From the project directory, install the dependencies:

```sh
npm install
```

The install lifecycle applies the version-controlled macOS password-field patch in `patches/`. The patch enables native secure text entry while preserving GeaStack input events. If an upstream dependency change makes the patch incompatible, installation stops with an error so the change can be reviewed.

## Development and build

```sh
npm run dev          # Start the web interface preview
npm run check        # Run the TypeScript check
npm test             # Run OTP and native vault tests
npx gea inspect --json
npm run build:macos  # Build the macOS application
npm run build:android # Build the Android debug APK
npm run test:android  # Run Kotlin unit tests
```

The macOS application is generated at `dist/macos/fiotp-gea/FiOTP.app` and can be launched with:

```sh
open dist/macos/fiotp-gea/FiOTP.app
```

The Android APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk` and uses the package id `com.fiskindal.fiotp`. Android supports API 23 and newer. Its first build is debug-signed. The Android UI, OTP engine, vault cryptography, file selection, and QR camera flow are implemented in Kotlin; the Apple and web targets continue to use the existing TypeScript/GeaStack application.

The web target is intended for interface development and preview. It does not open or persist production vaults. Camera access and production vault workflows are available in the macOS application.

`npm run build:macos` adds the camera usage description to the application bundle and applies an ad-hoc signature for local testing. Public distribution requires signing with a Developer ID certificate and notarization by Apple.

## Using FiOTP

1. On first launch, create a vault or select an existing encrypted vault file.
2. Unlock the vault with its master password. New vaults start empty and contain no sample accounts.
3. Add an account manually, paste an `otpauth://` URI, or scan a QR code with the camera. Google Authenticator migration QR codes are also supported.
4. Select a TOTP code to copy it. For HOTP accounts, use the counter control to advance to the next code.
5. Find accounts with search, categories, and favorites. Use **Vault & Backup** to export an encrypted backup, import a backup, or change the master password.

By default, the vault is stored at `~/Library/Application Support/FiOTP Gea/kasa.json`; another location can be selected in the application. The vault key is derived with PBKDF2-HMAC-SHA256. Writes are atomic, and the previous valid version is retained as a `.bak` recovery file. The vault cannot be opened without its master password, so keep the password and backups in a secure location. FiOTP locks the vault after five minutes of inactivity.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/App.tsx`, `src/stores/` | Interface and application state |
| `src/crypto/`, `src/services/` | OTP generation and encrypted vault operations |
| `native/`, `scripts/fiotp-host-plugin.mjs` | Apple host integration |
| `android/app/src/main/java/` | Native Android Compose UI, OTP, vault encryption, SAF and camera integration |
| `patches/` | GeaStack macOS secure password field patch |
| `tests/`, `native/fiotp_host_test.mm` | OTP and native vault tests |

## License, branding, and security

The source code is distributed under the [MIT License](LICENSE). The **FiOTP** name, logo, icon, and product identity are reserved under the [trademark policy](TRADEMARKS.md); forks must use distinct product branding. Please follow [SECURITY.md](SECURITY.md) when reporting vulnerabilities. Do not include real vault files, OTP secrets, or passwords in issues or pull requests.
