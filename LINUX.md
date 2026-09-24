# FiOTP on Linux

FiOTP uses the existing TypeScript/TSX application and GeaStack's native SDL2 target. The first supported Linux environment is Raspberry Pi OS Bookworm or newer on Raspberry Pi 5. The target produces a native executable; it does not package the app in a browser view.

## Build prerequisites

On Raspberry Pi OS, install the native build dependencies:

```sh
sudo apt install build-essential libsdl2-dev libcurl4-openssl-dev libssl-dev nlohmann-json3-dev zenity
npm install
```

Then build and run FiOTP from the project directory:

```sh
npm run build:linux
node_modules/@geastack/linux/targets/raspberry-pi-os/dist/fiotp-gea/fiotp-gea
```

The embedded raster font includes Turkish characters and FiOTP's emoji icons, so rendering does not depend on fonts installed on the target.

The Linux build opens a resizable SDL2 window and uses the physical keyboard by default. FiOTP stores its default encrypted vault at `$XDG_DATA_HOME/fiotp/kasa.json`, or `~/.local/share/fiotp/kasa.json` when `XDG_DATA_HOME` is unset. Vaults and backups are written with owner-only permissions and atomic replacement; the previous vault is retained as `.bak`.

Linux uses the same v1 AES-256-GCM / PBKDF2-HMAC-SHA256 vault envelope as the Apple versions. The Linux host supplies file selection through Zenity and clipboard access through SDL2. Camera QR scanning is not available in the current GeaStack Linux target; accounts can be added with an `otpauth://` URI or entered manually.

The GeaStack target currently focuses on Raspberry Pi OS. Other Linux distributions may work with their SDL2, libcurl, OpenSSL, nlohmann-json, and Zenity packages, but are not part of the current target's verified platform matrix.
