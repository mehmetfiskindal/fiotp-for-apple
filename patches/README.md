# Dependency patches

These patches are part of the source distribution and are applied after every
`npm install` through the package `postinstall` script.

`geastack-apple-macos-password.mjs` adds native `NSSecureTextField` support to
`@geastack/apple`'s macOS renderer. It is intentionally idempotent and fails
closed when the upstream renderer no longer matches its expected anchors, so
an upstream update cannot silently remove password masking.
