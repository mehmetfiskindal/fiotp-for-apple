import { readFileSync, writeFileSync } from 'node:fs'

const path = 'node_modules/@geastack/apple/targets/macos/main/macos_renderer.mm'
let source = readFileSync(path, 'utf8')
if (source.includes('@interface GeaSecureInputField : NSSecureTextField')) {
  console.log('GeaStack macOS password patch already applied')
  process.exit(0)
}

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
writeFileSync(path, source)
console.log('Applied native NSSecureTextField support for password inputs')
