import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const path = 'node_modules/@geastack/linux/targets/raspberry-pi-os/build-raspberry-pi-os.sh'
if (!existsSync(path)) {
  console.log('Skipping GeaStack Linux build patch: @geastack/linux target script not found')
  process.exit(0)
}
const original = readFileSync(path, 'utf8')
let source = original

const replacements = [
  [
    `ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"\nTARGET_DIR="$ROOT_DIR/targets/raspberry-pi-os"`,
    `ROOT_DIR="$(pwd -P)"\nTARGET_DIR="$(cd "$(dirname "$0")" && pwd)"`,
  ],
  [
    `GEA_CLI="$GEA_CORE/bin/gea-embedded.mjs"`,
    `GEA_CLI="$ROOT_DIR/node_modules/@geastack/cli/bin/gea.mjs"`,
  ],
  [
    `source "$GEA_CORE/../../gea_sources.sh"`,
    `source "$GEA_CORE/gea_sources.sh"`,
  ],
  [
    `GENERATED_DIR="$TARGET_DIR/generated/$APP_ID"`,
    `GENERATED_DIR="$ROOT_DIR/.gea-linux/generated/$APP_ID"`,
  ],
  [
    `"$TARGET_DIR/main/rpios_storage_bridge.cpp"`,
    `"$ROOT_DIR/native/rpios_storage_bridge.cpp"`,
  ],
  [
    `INCLUDES=(
  -I"$TARGET_DIR/include"
  -I"$GENERATED_DIR"
)`,
    `INCLUDES=(
  -I"$TARGET_DIR/include"
  -I"$GENERATED_DIR"
  -I"$ROOT_DIR/native"
)`,
  ],
  [
    `CXX_SOURCES+=("$GEA_GEAOS/resident_apps.cpp")`,
    `# Single-app target: the current GeaStack package has no resident_apps.cpp.`,
  ],

  [
    `  echo "[rpios] generating C++ for $APP_ID from $APP_DIR/$APP_ENTRY"`,
    `  APP_FONT_SOURCE="$APP_DIR/assets/fonts/Inter-Regular.ttf"
  LINUX_FONT_SOURCE="$APP_DIR/assets/fonts/OpenSans-Regular.ttf"
  APP_FONT_BACKUP="$GENERATED_DIR/.fiotp-font-backup.ttf"
  if [[ -f "$APP_FONT_SOURCE" && -f "$LINUX_FONT_SOURCE" ]]; then
    cp "$APP_FONT_SOURCE" "$APP_FONT_BACKUP"
    cp "$LINUX_FONT_SOURCE" "$APP_FONT_SOURCE"
    trap 'cp "$APP_FONT_BACKUP" "$APP_FONT_SOURCE"; rm -f "$APP_FONT_BACKUP"' EXIT
  fi
  echo "[rpios] generating C++ for $APP_ID from $APP_DIR/$APP_ENTRY"`,
  ],
  [
    '  node "$GEA_CORE/scripts/build-gea-vite-geatsc.mjs" \\',
    '  GEA_RPIOS_FONT_LATIN_EXTENDED=1 GEA_RPIOS_EMOJI_FONT="$APP_DIR/assets/fonts/Symbola_hint.ttf" node "$GEA_CORE/scripts/build-gea-vite-geatsc.mjs" \\',
  ],
  [
    `    --font-device-pixel-ratio "$FONT_DPR"
  # The object cache below`,
    `    --font-device-pixel-ratio "$FONT_DPR"
  if [[ -f "$APP_FONT_BACKUP" ]]; then
    cp "$APP_FONT_BACKUP" "$APP_FONT_SOURCE"
    rm -f "$APP_FONT_BACKUP"
    trap - EXIT
  fi
  # The object cache below`,
  ],
]

for (const [from, to] of replacements) {
  if (source.includes(to)) continue
  if (!source.includes(from)) throw new Error(`Unsupported @geastack/linux build script near: ${from.slice(0, 64)}`)
  source = source.replace(from, to)
}

if (source !== original) writeFileSync(path, source)

const displayPath = 'node_modules/@geastack/linux/targets/raspberry-pi-os/main/rpios_display.cpp'
const originalDisplay = readFileSync(displayPath, 'utf8')
let display = originalDisplay
const displayReplacements = [
  [
    'env_int("GEA_RPIOS_WIDTH", gea::platform::display::kWidth, 64, 4096)',
    'env_int("GEA_RPIOS_WIDTH", 1100, 64, 4096)',
  ],
  [
    'env_int("GEA_RPIOS_HEIGHT", gea::platform::display::kHeight, 64, 4096)',
    'env_int("GEA_RPIOS_HEIGHT", 760, 64, 4096)',
  ],
  ['env_int("GEA_RPIOS_SCALE", 2, 1, 8)', 'env_int("GEA_RPIOS_SCALE", 1, 1, 8)'],
  [
    'GEA_RPIOS_WIDTH   logical canvas width   (default 410 — amoled-2.06)',
    'GEA_RPIOS_WIDTH   logical canvas width   (default 1100 — desktop)',
  ],
  ['GEA_RPIOS_HEIGHT  logical canvas height  (default 502)', 'GEA_RPIOS_HEIGHT  logical canvas height  (default 760)'],
  ['GEA_RPIOS_SCALE   integer window scale   (default 2)', 'GEA_RPIOS_SCALE   integer window scale   (default 1)'],
]

for (const [from, to] of displayReplacements) {
  if (display.includes(to)) continue
  if (!display.includes(from)) throw new Error(`Unsupported @geastack/linux display source near: ${from}`)
  display = display.replace(from, to)
}

if (display !== originalDisplay) writeFileSync(displayPath, display)

const mainPath = 'node_modules/@geastack/linux/targets/raspberry-pi-os/main/rpios_main.cpp'
const originalMain = readFileSync(mainPath, 'utf8')
let main = originalMain
const obsoleteAppLaunchCase = `\t\tcase gea::framework::events::EventType::AppLaunch:\n`
if (main.includes(obsoleteAppLaunchCase)) main = main.replace(obsoleteAppLaunchCase, '')
if (main.includes('return 2.0;')) main = main.replace('return 2.0;', 'return 1.0;')
if (!main.includes('return 1.0;')) {
  throw new Error('Unsupported @geastack/linux DPR default in rpios_main.cpp')
}
if (main !== originalMain) writeFileSync(mainPath, main)


const fontGeneratorPath = 'node_modules/@geastack/core/scripts/generate-gea-embedded-fonts.mjs'
const originalFontGenerator = readFileSync(fontGeneratorPath, 'utf8')
const oldBaseline = `function baselineCodepoints() {
  const codepoints = []
  for (let cp = 0x20; cp <= 0x7e; cp += 1) codepoints.push(cp)
  codepoints.push(...embeddedFontExtraCodepoints)
  return codepoints
}`
const newBaseline = `function baselineCodepoints() {
  const codepoints = []
  for (let cp = 0x20; cp <= 0x7e; cp += 1) codepoints.push(cp)
  codepoints.push(...embeddedFontExtraCodepoints)
  if (process.env.GEA_RPIOS_FONT_LATIN_EXTENDED === '1') {
    for (let cp = 0x00a0; cp <= 0x00ff; cp += 1) codepoints.push(cp)
    codepoints.push(0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f)
    codepoints.push(0x1f6e1, 0x1f511, 0x1f4bc, 0x1f464, 0x26a1, 0x1f4cb, 0xfe0f, 0x200d)
  }
  return [...new Set(codepoints)].sort((a, b) => a - b)
}`
let fontGenerator = originalFontGenerator
const latinBaseline = `function baselineCodepoints() {
  const codepoints = []
  for (let cp = 0x20; cp <= 0x7e; cp += 1) codepoints.push(cp)
  codepoints.push(...embeddedFontExtraCodepoints)
  if (process.env.GEA_RPIOS_FONT_LATIN_EXTENDED === '1') {
    for (let cp = 0x00a0; cp <= 0x00ff; cp += 1) codepoints.push(cp)
    codepoints.push(0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f)
  }
  return [...new Set(codepoints)].sort((a, b) => a - b)
}`
if (!fontGenerator.includes(newBaseline)) {
  if (fontGenerator.includes(latinBaseline)) fontGenerator = fontGenerator.replace(latinBaseline, newBaseline)
  else if (fontGenerator.includes(oldBaseline)) fontGenerator = fontGenerator.replace(oldBaseline, newBaseline)
  else throw new Error('Unsupported GeaStack embedded font charset generator')
}
const oldFontParse = `  const font = opentype.parse(arrayBuffer)

  const scale = sizePx / font.unitsPerEm`
const newFontParse = `  const font = opentype.parse(arrayBuffer)
  let emojiFont = null
  const emojiFontPath = process.env.GEA_RPIOS_EMOJI_FONT
  if (emojiFontPath && fs.existsSync(emojiFontPath)) {
    const emojiBuffer = fs.readFileSync(emojiFontPath)
    const emojiArrayBuffer = emojiBuffer.buffer.slice(emojiBuffer.byteOffset, emojiBuffer.byteOffset + emojiBuffer.byteLength)
    emojiFont = opentype.parse(emojiArrayBuffer)
  }

  const scale = sizePx / font.unitsPerEm`
if (!fontGenerator.includes(newFontParse)) {
  if (!fontGenerator.includes(oldFontParse)) throw new Error('Unsupported GeaStack font parser for Linux emoji fallback')
  fontGenerator = fontGenerator.replace(oldFontParse, newFontParse)
}

const oldGlyphRasterization = `  for (const cp of codepoints) {
    const glyph = font.charToGlyph(String.fromCodePoint(cp))
    const advance = Math.round((glyph.advanceWidth ?? 0) * scale)
    const bounds = glyph.getBoundingBox()
    const x0 = Math.floor(bounds.x1 * scale)
    const y0 = Math.floor(-bounds.y2 * scale)
    const x1 = Math.ceil(bounds.x2 * scale)
    const y1 = Math.ceil(-bounds.y1 * scale)`
const newGlyphRasterization = `  for (const cp of codepoints) {
    if (cp === 0xfe0e || cp === 0xfe0f || cp === 0x200d) {
      glyphs.push({ codepoint: cp, sourceX: 0, sourceY: 0, width: 0, height: 0, advance: 0, bearingX: 0, bearingY: 0 })
      glyphBitmaps.push({ data: new Uint8Array(0), width: 0, height: 0 })
      continue
    }

    let glyphFont = font
    let glyph = font.charToGlyph(String.fromCodePoint(cp))
    if (glyph.index === 0 && emojiFont) {
      const fallbackGlyph = emojiFont.charToGlyph(String.fromCodePoint(cp))
      if (fallbackGlyph.index !== 0) {
        glyphFont = emojiFont
        glyph = fallbackGlyph
      }
    }

    const glyphScale = sizePx / glyphFont.unitsPerEm
    const advance = Math.round((glyph.advanceWidth ?? 0) * glyphScale)
    const bounds = glyph.getBoundingBox()
    const x0 = Math.floor(bounds.x1 * glyphScale)
    const y0 = Math.floor(-bounds.y2 * glyphScale)
    const x1 = Math.ceil(bounds.x2 * glyphScale)
    const y1 = Math.ceil(-bounds.y1 * glyphScale)`
if (!fontGenerator.includes(newGlyphRasterization)) {
  if (!fontGenerator.includes(oldGlyphRasterization)) throw new Error('Unsupported GeaStack glyph rasterizer for Linux emoji fallback')
  fontGenerator = fontGenerator.replace(oldGlyphRasterization, newGlyphRasterization)
}

if (fontGenerator !== originalFontGenerator) writeFileSync(fontGeneratorPath, fontGenerator)
