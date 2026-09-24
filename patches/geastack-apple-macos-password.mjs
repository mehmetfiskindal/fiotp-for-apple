import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// 1. Native password input (NSSecureTextField)
const rendererPath = 'node_modules/@geastack/apple/targets/macos/main/macos_renderer.mm'
if (existsSync(rendererPath)) {
  let source = readFileSync(rendererPath, 'utf8')
  if (!source.includes('@interface GeaSecureInputField : NSSecureTextField')) {
    const secureClass = `@end

// Native password input that preserves Gea's input and keydown bridge.
@interface GeaSecureInputField : NSSecureTextField <NSTextFieldDelegate>
@property(nonatomic, assign) int nodeId;
@end
@implementation GeaSecureInputField
- (instancetype)initWithFrame:(NSRect)frameRect { if ((self = [super initWithFrame:frameRect])) { _nodeId = -1; self.delegate = self; } return self; }
- (void)controlTextDidChange:(NSNotification *)note { (void)note; if (_nodeId < 0) return; auto &tree = gea::embedded::ui::Tree::instance(); if (_nodeId >= tree.nodeCount()) return; const std::string value = std::string([self.stringValue UTF8String] ?: ""); tree.setAttribute(_nodeId, "value", value.c_str()); gea::framework::events::PointerEvent event; event.type = gea::framework::events::PointerEventType::Input; event.targetId = _nodeId; tree.dispatchEvent(event); }
- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)selector { (void)control; (void)textView; const int keyCode = geaKeyCodeForCommand(selector); if (keyCode == 0 || _nodeId < 0) return NO; auto &tree = gea::embedded::ui::Tree::instance(); if (_nodeId >= tree.nodeCount()) return NO; gea::framework::events::PointerEvent event; event.type = gea::framework::events::PointerEventType::KeyDown; event.targetId = _nodeId; event.keyCode = keyCode; tree.dispatchEvent(event); return NO; }
@end

// Multi-line text editor.`

    const replacements = [
      ['@end\n\n// Multi-line text editor.', secureClass],
      ['NSView *makeInputField()\n{', 'NSView *makeInputField(const char *inputType)\n{'],
      ['GeaInputField *tf = [[GeaInputField alloc] initWithFrame:NSZeroRect];', 'NSTextField *tf = inputType && std::strcmp(inputType, "password") == 0\n\t                         ? [[GeaSecureInputField alloc] initWithFrame:NSZeroRect]\n\t                         : [[GeaInputField alloc] initWithFrame:NSZeroRect];'],
      ['return makeInputField();', 'return makeInputField(inputType);'],
      ['void applyInputProps(GeaInputField *tf,', 'void applyInputProps(NSTextField *tf,'],
      ['\ttf.nodeId = nodeId;', '\tif ([tf isKindOfClass:[GeaSecureInputField class]]) ((GeaSecureInputField *)tf).nodeId = nodeId;\n\telse ((GeaInputField *)tf).nodeId = nodeId;'],
      ['} else if ([view isKindOfClass:[GeaInputField class]]) {\n\t\tapplyInputProps((GeaInputField *)view, node, nodeId);', '} else if ([view isKindOfClass:[GeaInputField class]] || [view isKindOfClass:[GeaSecureInputField class]]) {\n\t\tapplyInputProps((NSTextField *)view, node, nodeId);'],
      ['\t\treturn [view isKindOfClass:[GeaInputField class]];', '\t\tif (inputType && std::strcmp(inputType, "password") == 0) return [view isKindOfClass:[GeaSecureInputField class]];\n\t\treturn [view isKindOfClass:[GeaInputField class]];'],
    ]

    for (const [from, to] of replacements) {
      if (!source.includes(from)) throw new Error(`Unsupported @geastack/apple renderer: ${from.slice(0, 44)}`)
      source = source.replace(from, to)
    }
    writeFileSync(rendererPath, source)
    console.log('Applied native NSSecureTextField support for password inputs')
  }
}

// 2. Info.plist.in camera permission description
const plistPath = 'node_modules/@geastack/apple/targets/macos/Info.plist.in'
if (existsSync(plistPath)) {
  let plist = readFileSync(plistPath, 'utf8')
  if (!plist.includes('NSCameraUsageDescription')) {
    const anchor = '\t<key>NSPrincipalClass</key><string>NSApplication</string>'
    const addition = `${anchor}\n\t<key>NSCameraUsageDescription</key>\n\t<string>FiOTP QR kodlarını taramak için kamerayı kullanır.</string>`
    if (plist.includes(anchor)) {
      plist = plist.replace(anchor, addition)
      writeFileSync(plistPath, plist)
      console.log('Added NSCameraUsageDescription to macOS Info.plist template')
    }
  }
}

// 3. build-macos.sh clean codesign & compiler warning suppression for geatsc generated sources
const buildScriptPath = 'node_modules/@geastack/apple/targets/macos/build-macos.sh'
if (existsSync(buildScriptPath)) {
  let script = readFileSync(buildScriptPath, 'utf8')
  let changed = false

  // Suppress unused-value warnings in geatsc generated sources
  if (script.includes('generatedWarningArgs=(-Wno-parentheses-equality)') && !script.includes('-Wno-unused-value')) {
    script = script.replace(
      'generatedWarningArgs=(-Wno-parentheses-equality)',
      'generatedWarningArgs=(-Wno-parentheses-equality -Wno-unused-value)'
    )
    script = script.replaceAll(
      'extra="-Wno-parentheses-equality"',
      'extra="-Wno-parentheses-equality -Wno-unused-value"'
    )
    changed = true
  }

  // Codesign informational output cleanup: only print output if codesign fails
  const codesignFrom = `if (( CODESIGN_NEEDED != 0 )); then
  rm -f "$CODESIGN_STAMP"
  if ! codesign --force --sign - "$APP_BUNDLE"; then
    echo "Code signing failed for $APP_BUNDLE" >&2
    exit 1
  fi
  touch "$CODESIGN_STAMP"
fi`

  const codesignTo = `if (( CODESIGN_NEEDED != 0 )); then
  rm -f "$CODESIGN_STAMP"
  local_codesign_out="$(codesign --force --sign - "$APP_BUNDLE" 2>&1)"
  local_codesign_rc=$?
  if [[ $local_codesign_rc -ne 0 ]]; then
    echo "$local_codesign_out" >&2
    echo "Code signing failed for $APP_BUNDLE" >&2
    exit 1
  fi
  touch "$CODESIGN_STAMP"
fi`

  if (script.includes(codesignFrom)) {
    script = script.replace(codesignFrom, codesignTo)
    changed = true
  }

  if (changed) {
    writeFileSync(buildScriptPath, script)
    console.log('Patched GeaStack macOS build script for clean codesign and diagnostics')
  }
}
