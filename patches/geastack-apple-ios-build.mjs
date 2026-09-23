import { readFileSync, writeFileSync } from 'node:fs'

const path = 'node_modules/@geastack/apple/targets/ios/build-ios.sh'
let source = readFileSync(path, 'utf8')

const replacements = [
  [
    `GEA_CORE="$(node -e "process.stdout.write(require('fs').realpathSync('$ROOT_DIR/node_modules/@geastack/core'))" 2>/dev/null || true)"`,
    `GEA_CORE="$(node -e "const fs=require('fs');for(const base of ['$ROOT_DIR',process.cwd()]){try{process.stdout.write(fs.realpathSync(base+'/node_modules/@geastack/core'));process.exit(0)}catch{}}" 2>/dev/null || true)"`,
  ],
  [
    `GEA_COMPILER="$(node -e "process.stdout.write(require('fs').realpathSync('$ROOT_DIR/node_modules/@geastack/compiler'))" 2>/dev/null || true)"`,
    `GEA_COMPILER="$(node -e "const fs=require('fs');for(const base of ['$ROOT_DIR',process.cwd()]){try{process.stdout.write(fs.realpathSync(base+'/node_modules/@geastack/compiler'));process.exit(0)}catch{}}" 2>/dev/null || true)"`,
  ],
  [
    `GEA_CLI="${'${GEA_CLI_BIN:-$(node -e "process.stdout.write(require(\'path\').join(require(\'fs\').realpathSync(\'$ROOT_DIR/node_modules/@geastack/cli\'), \'bin\', \'gea.mjs\'))" 2>/dev/null || true)}'}"`,
    `GEA_CLI="${'${GEA_CLI_BIN:-$(node -e "const fs=require(\'fs\'),p=require(\'path\');for(const base of [\'$ROOT_DIR\',process.cwd()]){try{process.stdout.write(p.join(fs.realpathSync(base+\'/node_modules/@geastack/cli\'),\'bin\',\'gea.mjs\'));process.exit(0)}catch{}}" 2>/dev/null || true)}'}"`,
  ],
  [
    `--geatsc-apple-native-plugin "$ROOT_DIR/packages/geatsc-plugin-apple-native/dist/index.js"`,
    `--geatsc-apple-native-plugin "$BUILD_INVOCATION_CWD/node_modules/@geastack/geatsc-plugin-apple-native/dist/index.js"`,
  ],
  [
    `source "$GEA_CORE/gea_sources.sh"\nexport GEA_CORE`,
    `export GEA_CORE GEA_HOST_DIR GEA_ENGINE_DIR GEA_ELEMENTS_DIR GEA_GEAOS_PACKAGE_DIR\nsource "$GEA_CORE/gea_sources.sh"`,
  ],
  [
    `/usr/bin/open -a Simulator --args -CurrentDeviceUDID "$udid"`,
    `/usr/bin/open -a "Device Hub" >/dev/null 2>&1 || true`,
  ],
]

for (const [from, to] of replacements) {
  if (source.includes(to)) continue
  if (!source.includes(from)) throw new Error(`Unsupported @geastack/apple iOS build script near: ${from.slice(0, 64)}`)
  source = source.replace(from, to)
}

writeFileSync(path, source)

const projectGeneratorPath = 'node_modules/@geastack/apple/targets/ios/generate-xcode-project.mjs'
let projectGenerator = readFileSync(projectGeneratorPath, 'utf8')
const generatorFrom = "const projectDir = process.cwd()"
const generatorTo = `${generatorFrom}\nconst geaCore = process.env.GEA_CORE || path.join(projectDir, 'node_modules/@geastack/core')`
if (!projectGenerator.includes('const geaCore = process.env.GEA_CORE')) {
  if (!projectGenerator.includes(generatorFrom)) throw new Error('Unsupported @geastack/apple iOS Xcode project generator')
  projectGenerator = projectGenerator.replace(generatorFrom, generatorTo)
  writeFileSync(projectGeneratorPath, projectGenerator)
}

const frameworkAnchor = "  'AVFoundation.framework',"
const frameworkAddition = `${frameworkAnchor}\n  'UniformTypeIdentifiers.framework',`
if (!projectGenerator.includes("'UniformTypeIdentifiers.framework'")) {
  if (!projectGenerator.includes(frameworkAnchor)) throw new Error('Unsupported iOS framework list in @geastack/apple generator')
  projectGenerator = projectGenerator.replace(frameworkAnchor, frameworkAddition)
  writeFileSync(projectGeneratorPath, projectGenerator)
}

console.log('Patched GeaStack iOS build paths to resolve app-installed packages')

const iosMainPath = 'node_modules/@geastack/apple/targets/ios/main/ios_main.mm'
let iosMain = readFileSync(iosMainPath, 'utf8')
const placeholderFrom = '\t\tfield.placeholder = placeholder.length > 0 ? placeholder : nil;'
const placeholderTo = [
  '\t\tfield.placeholder = nil;',
  '\t\tfield.attributedPlaceholder = placeholder.length > 0',
  '\t\t    ? [[NSAttributedString alloc] initWithString:placeholder attributes:@{ NSForegroundColorAttributeName: [UIColor colorWithWhite:0.62 alpha:1.0] }]',
  '\t\t    : nil;',
].join('\n')
if (!iosMain.includes('NSForegroundColorAttributeName: [UIColor colorWithWhite:0.62 alpha:1.0]')) {
  if (!iosMain.includes(placeholderFrom)) throw new Error('Unsupported iOS text field placeholder code in @geastack/apple')
  iosMain = iosMain.replace(placeholderFrom, placeholderTo)
  writeFileSync(iosMainPath, iosMain)
}

const plistTemplatePath = 'node_modules/@geastack/apple/targets/ios/Info.plist.in'
let plistTemplate = readFileSync(plistTemplatePath, 'utf8')
const plistAnchor = '\t<key>UIRequiresFullScreen</key><true/>'
const sceneManifest = [
  '\t<key>UIApplicationSceneManifest</key>',
  '\t<dict>',
  '\t\t<key>UIApplicationSupportsMultipleScenes</key><false/>',
  '\t\t<key>UISceneConfigurations</key>',
  '\t\t<dict>',
  '\t\t\t<key>UIWindowSceneSessionRoleApplication</key>',
  '\t\t\t<array><dict>',
  '\t\t\t\t<key>UISceneConfigurationName</key><string>Default Configuration</string>',
  '\t\t\t\t<key>UISceneClassName</key><string>UIWindowScene</string>',
  '\t\t\t\t<key>UISceneDelegateClassName</key><string>FiOTPSceneDelegate</string>',
  '\t\t\t</dict></array>',
  '\t\t</dict>',
  '\t</dict>',
].join('\n')
if (!plistTemplate.includes('<key>UIApplicationSceneManifest</key>')) {
  if (!plistTemplate.includes(plistAnchor)) throw new Error('Unsupported iOS Info.plist template in @geastack/apple')
  plistTemplate = plistTemplate.replace(plistAnchor, `${sceneManifest}\n${plistAnchor}`)
  writeFileSync(plistTemplatePath, plistTemplate)
}
