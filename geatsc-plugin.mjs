// Desktop target adapters load an app-owned geatsc-plugin.mjs directly.
// Keep this entry aligned with gea.compilerPlugins so the native host shim
// is present in both Windows and Apple desktop builds.
export { default } from './scripts/fiotp-host-plugin.mjs'
