#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <Vision/Vision.h>
#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonKeyDerivation.h>
#import <CommonCrypto/CommonHMAC.h>
#include <sys/stat.h>
#include <array>
#include <algorithm>
#include <vector>
#include <cstring>
#include <dlfcn.h>
#include "fiotp_host.h"

@interface FiOTPQRScanner : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@property(nonatomic, strong) AVCaptureSession *session;
@property(nonatomic, strong) NSPanel *panel;
@property(nonatomic, copy) NSString *result;
@property(nonatomic, assign) BOOL processingFrame;
- (NSString *)scan:(NSError **)error;
- (void)cancel:(id)sender;
@end

@implementation FiOTPQRScanner
- (void)cancel:(id)sender { [NSApp abortModal]; }
- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer fromConnection:(AVCaptureConnection *)connection {
  if (self.processingFrame || self.result.length) return;
  // Gea's macOS host links AVFoundation but does not currently expose
  // app-specific framework flags. Load Vision/CoreMedia dynamically so this
  // app-owned scanner remains portable across Gea package updates.
  static void *coreMedia = dlopen("/System/Library/Frameworks/CoreMedia.framework/CoreMedia", RTLD_LAZY | RTLD_LOCAL);
  using GetImageBufferFn = CVImageBufferRef (*)(CMSampleBufferRef);
  static GetImageBufferFn getImageBuffer = coreMedia
    ? reinterpret_cast<GetImageBufferFn>(dlsym(coreMedia, "CMSampleBufferGetImageBuffer")) : nullptr;
  if (!getImageBuffer) return;
  CVPixelBufferRef pixelBuffer = getImageBuffer(sampleBuffer);
  if (!pixelBuffer) return;
  static void *vision = dlopen("/System/Library/Frameworks/Vision.framework/Vision", RTLD_LAZY | RTLD_LOCAL);
  Class requestClass = vision ? NSClassFromString(@"VNDetectBarcodesRequest") : Nil;
  Class handlerClass = vision ? NSClassFromString(@"VNImageRequestHandler") : Nil;
  if (!requestClass || !handlerClass) return;
  self.processingFrame = YES;
  id request = [[requestClass alloc] initWithCompletionHandler:^(id completedRequest, NSError *visionError) {
    for (id observation in [completedRequest valueForKey:@"results"]) {
      NSString *payload = [observation valueForKey:@"payloadStringValue"];
      if (payload.length) {
        self.result = payload;
        dispatch_async(dispatch_get_main_queue(), ^{ [NSApp abortModal]; });
        break;
      }
    }
    self.processingFrame = NO;
  }];
  [request setValue:@[@"VNBarcodeSymbologyQR"] forKey:@"symbologies"];
  id handler = [[handlerClass alloc] initWithCVPixelBuffer:pixelBuffer options:@{}];
  NSError *visionError = nil;
  if (![handler performRequests:@[request] error:&visionError]) self.processingFrame = NO;
}
- (NSString *)scan:(NSError **)error {
  AVAuthorizationStatus auth = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (auth == AVAuthorizationStatusNotDetermined) {
    __block BOOL permissionFinished = NO;
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
      permissionFinished = YES;
    }];
    // The host bridge is invoked on AppKit's main thread. Blocking that thread
    // with a semaphore prevents macOS from presenting/responding to the TCC
    // camera prompt. Keep its run loop alive until the asynchronous answer
    // arrives instead.
    while (!permissionFinished) {
      @autoreleasepool {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode
                               beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
      }
    }
    auth = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  }
  if (auth != AVAuthorizationStatusAuthorized) {
    if (error) *error = [NSError errorWithDomain:@"FiOTP" code:20 userInfo:@{NSLocalizedDescriptionKey: @"Kamera izni verilmedi."}];
    return nil;
  }
  AVCaptureDevice *camera = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
  AVCaptureDeviceInput *input = camera ? [AVCaptureDeviceInput deviceInputWithDevice:camera error:error] : nil;
  if (!input) return nil;
  self.session = [AVCaptureSession new];
  self.session.sessionPreset = AVCaptureSessionPresetHigh;
  AVCaptureVideoDataOutput *video = [AVCaptureVideoDataOutput new];
  video.alwaysDiscardsLateVideoFrames = YES;
  if (![self.session canAddInput:input] || ![self.session canAddOutput:video]) {
    if (error) *error = [NSError errorWithDomain:@"FiOTP" code:21 userInfo:@{NSLocalizedDescriptionKey: @"Kamera görüntü akışı başlatılamadı."}];
    return nil;
  }
  [self.session addInput:input]; [self.session addOutput:video];
  [video setSampleBufferDelegate:self queue:dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0)];
  self.panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 520, 420)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  self.panel.title = @"FiOTP — QR Tara";
  NSView *preview = [[NSView alloc] initWithFrame:NSMakeRect(0, 50, 520, 370)]; preview.wantsLayer = YES;
  AVCaptureVideoPreviewLayer *layer = [AVCaptureVideoPreviewLayer layerWithSession:self.session];
  layer.frame = preview.bounds; layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  layer.videoGravity = AVLayerVideoGravityResizeAspectFill; [preview.layer addSublayer:layer];
  NSButton *cancel = [NSButton buttonWithTitle:@"İptal" target:self action:@selector(cancel:)]; cancel.frame = NSMakeRect(210, 10, 100, 30);
  [self.panel.contentView addSubview:preview]; [self.panel.contentView addSubview:cancel]; [self.panel center];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [self.session startRunning];
  });
  [NSApp runModalForWindow:self.panel];
  [self.session stopRunning];
  [self.panel close];
  return self.result;
}
@end

namespace {
constexpr uint32_t kIterations = 600000;
constexpr size_t kKeyLength = 32;
constexpr size_t kSaltLength = 16;
constexpr size_t kNonceLength = 12;
constexpr size_t kTagLength = 16;

NSMutableData *gKey = nil;
NSString *gVaultPath = nil;

NSString *toNSString(const std::string &value) {
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding];
}
std::string toString(NSString *value) {
  const char *utf8 = value.UTF8String;
  return utf8 ? std::string(utf8) : std::string();
}
NSDictionary *parseObject(const std::string &payload, NSError **error) {
  NSData *data = [toNSString(payload) dataUsingEncoding:NSUTF8StringEncoding];
  id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:error];
  return [object isKindOfClass:NSDictionary.class] ? object : nil;
}
std::string response(BOOL ok, id data, NSString *message = nil, NSString *code = nil) {
  NSMutableDictionary *root = [NSMutableDictionary dictionaryWithObject:@(ok) forKey:@"ok"];
  if (data) root[@"data"] = data;
  if (message) root[@"error"] = message;
  if (code) root[@"code"] = code;
  NSData *json = [NSJSONSerialization dataWithJSONObject:root options:0 error:nil];
  return std::string((const char *)json.bytes, json.length);
}
std::string failure(NSString *message, NSString *code = @"native_error") {
  return response(NO, nil, message ?: @"Bilinmeyen native hata", code);
}
NSString *expandedPath(NSString *path) {
  if (!path.length || [path hasPrefix:@"~/Library/Application Support/FiOTP Gea/"]) {
    NSString *dir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/FiOTP Gea"];
    return [dir stringByAppendingPathComponent:@"kasa.json"];
  }
  return path.stringByExpandingTildeInPath.stringByStandardizingPath;
}
NSData *randomData(NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  arc4random_buf(data.mutableBytes, data.length);
  return data;
}
NSData *deriveKey(NSString *password, NSData *salt, uint32_t iterations, NSError **error) {
  NSMutableData *key = [NSMutableData dataWithLength:kKeyLength];
  NSData *passwordData = [password dataUsingEncoding:NSUTF8StringEncoding];
  int rc = CCKeyDerivationPBKDF(kCCPBKDF2, (const char *)passwordData.bytes, passwordData.length,
                                (const uint8_t *)salt.bytes, salt.length, kCCPRFHmacAlgSHA256,
                                iterations, (uint8_t *)key.mutableBytes, key.length);
  if (rc != kCCSuccess) {
    if (error) *error = [NSError errorWithDomain:@"FiOTP" code:rc userInfo:@{NSLocalizedDescriptionKey: @"Parola anahtarı türetilemedi."}];
    return nil;
  }
  return key;
}

using Block = std::array<uint8_t, 16>;
Block aesBlock(NSData *key, const Block &input) {
  Block output{}; size_t moved = 0;
  CCCrypt(kCCEncrypt, kCCAlgorithmAES, kCCOptionECBMode, key.bytes, key.length, nullptr,
          input.data(), input.size(), output.data(), output.size(), &moved);
  return output;
}
Block xorBlock(const Block &a, const Block &b) {
  Block out{}; for (size_t i = 0; i < 16; ++i) out[i] = a[i] ^ b[i]; return out;
}
Block galoisMultiply(Block x, const Block &y) {
  Block z{}, v = y;
  for (size_t bit = 0; bit < 128; ++bit) {
    if ((x[bit / 8] >> (7 - bit % 8)) & 1) for (size_t j = 0; j < 16; ++j) z[j] ^= v[j];
    bool lsb = (v[15] & 1) != 0;
    for (int j = 15; j >= 0; --j) v[j] = uint8_t((v[j] >> 1) | (j ? (v[j - 1] & 1) << 7 : 0));
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}
Block ghash(const Block &h, const uint8_t *bytes, size_t length) {
  Block y{};
  for (size_t offset = 0; offset < length; offset += 16) {
    Block block{}; size_t count = std::min<size_t>(16, length - offset);
    memcpy(block.data(), bytes + offset, count); y = galoisMultiply(xorBlock(y, block), h);
  }
  Block lengths{}; uint64_t bits = uint64_t(length) * 8;
  for (int i = 0; i < 8; ++i) lengths[15 - i] = uint8_t(bits >> (i * 8));
  return galoisMultiply(xorBlock(y, lengths), h);
}
void incrementCounter(Block &counter) {
  for (int i = 15; i >= 12; --i) if (++counter[i] != 0) break;
}
NSData *gcmCrypt(NSData *input, NSData *key, NSData *nonce, BOOL encrypting, NSData *expectedTag, NSData **outTag, NSError **error) {
  Block zero{}, h = aesBlock(key, zero), j0{}; memcpy(j0.data(), nonce.bytes, 12); j0[15] = 1;
  NSMutableData *output = [NSMutableData dataWithLength:input.length]; Block counter = j0;
  const uint8_t *in = (const uint8_t *)input.bytes; uint8_t *out = (uint8_t *)output.mutableBytes;
  for (size_t offset = 0; offset < input.length; offset += 16) {
    incrementCounter(counter); Block stream = aesBlock(key, counter); size_t count = std::min<size_t>(16, input.length - offset);
    for (size_t i = 0; i < count; ++i) out[offset + i] = in[offset + i] ^ stream[i];
  }
  const uint8_t *authenticated = encrypting ? out : in;
  Block s = ghash(h, authenticated, input.length), mask = aesBlock(key, j0), tag = xorBlock(s, mask);
  if (!encrypting) {
    if (expectedTag.length != 16) return nil;
    const uint8_t *given = (const uint8_t *)expectedTag.bytes; uint8_t diff = 0;
    for (size_t i = 0; i < 16; ++i) diff |= tag[i] ^ given[i];
    if (diff) { if (error) *error = [NSError errorWithDomain:@"FiOTP" code:9 userInfo:@{NSLocalizedDescriptionKey: @"Parola hatalı veya kasa bozulmuş/kurcalanmış."}]; return nil; }
  }
  if (outTag) *outTag = [NSData dataWithBytes:tag.data() length:tag.size()];
  return output;
}
NSDictionary *encryptPayload(NSData *plaintext, NSData *key, NSError **error) {
  NSData *nonce = randomData(kNonceLength);
  NSData *tag = nil;
  NSData *ciphertext = gcmCrypt(plaintext, key, nonce, YES, nil, &tag, error);
  if (!ciphertext) return nil;
  return @{ @"version": @1, @"cipher": @"AES-256-GCM", @"kdf": @"PBKDF2-HMAC-SHA256",
            @"iterations": @(kIterations), @"nonce": [nonce base64EncodedStringWithOptions:0],
            @"ciphertext": [ciphertext base64EncodedStringWithOptions:0],
            @"tag": [tag base64EncodedStringWithOptions:0] };
}
NSData *decryptPayload(NSDictionary *envelope, NSData *key, NSError **error) {
  if (![envelope[@"version"] isEqual:@1] || ![envelope[@"cipher"] isEqual:@"AES-256-GCM"]) {
    if (error) *error = [NSError errorWithDomain:@"FiOTP" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Desteklenmeyen veya geçersiz kasa formatı."}];
    return nil;
  }
  NSData *nonce = [[NSData alloc] initWithBase64EncodedString:envelope[@"nonce"] options:0];
  NSData *ciphertext = [[NSData alloc] initWithBase64EncodedString:envelope[@"ciphertext"] options:0];
  NSData *tag = [[NSData alloc] initWithBase64EncodedString:envelope[@"tag"] options:0];
  if (nonce.length != kNonceLength || tag.length != kTagLength || !ciphertext) {
    if (error) *error = [NSError errorWithDomain:@"FiOTP" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Kasa şifreleme alanları bozuk."}];
    return nil;
  }
  return gcmCrypt(ciphertext, key, nonce, NO, tag, nil, error);
}
BOOL writeEnvelope(NSDictionary *envelope, NSString *path, BOOL backup, NSError **error) {
  NSFileManager *fm = NSFileManager.defaultManager;
  if (![fm createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:error]) return NO;
  NSData *json = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:error];
  NSString *temp = [path stringByAppendingFormat:@".tmp-%@", NSUUID.UUID.UUIDString];
  if (!json || ![json writeToFile:temp options:NSDataWritingAtomic error:error]) return NO;
  chmod(temp.fileSystemRepresentation, S_IRUSR | S_IWUSR);
  NSString *bak = [path stringByAppendingString:@".bak"];
  if (backup && [fm fileExistsAtPath:path]) {
    [fm removeItemAtPath:bak error:nil];
    if (![fm copyItemAtPath:path toPath:bak error:error]) { [fm removeItemAtPath:temp error:nil]; return NO; }
    chmod(bak.fileSystemRepresentation, S_IRUSR | S_IWUSR);
  }
  [fm removeItemAtPath:path error:nil];
  if (![fm moveItemAtPath:temp toPath:path error:error]) { [fm removeItemAtPath:temp error:nil]; return NO; }
  chmod(path.fileSystemRepresentation, S_IRUSR | S_IWUSR);
  return YES;
}
NSDictionary *readEnvelope(NSString *path, NSError **error) {
  NSData *data = [NSData dataWithContentsOfFile:path options:0 error:error];
  id object = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:error] : nil;
  if (![object isKindOfClass:NSDictionary.class] && error && !*error)
    *error = [NSError errorWithDomain:@"FiOTP" code:3 userInfo:@{NSLocalizedDescriptionKey: @"Kasa dosyası geçerli JSON değil."}];
  return [object isKindOfClass:NSDictionary.class] ? object : nil;
}
NSDictionary *openAtPath(NSString *path, NSString *password, BOOL keepKey, NSError **error) {
  NSDictionary *envelope = readEnvelope(path, error);
  NSData *salt = envelope ? [[NSData alloc] initWithBase64EncodedString:envelope[@"salt"] options:0] : nil;
  NSNumber *iterations = envelope[@"iterations"];
  if (!envelope) return nil;
  if (salt.length != kSaltLength || iterations.unsignedIntValue < 100000) {
    if (error) *error = [NSError errorWithDomain:@"FiOTP" code:4 userInfo:@{NSLocalizedDescriptionKey: @"Kasa KDF bilgileri geçersiz."}];
    return nil;
  }
  NSData *key = deriveKey(password, salt, iterations.unsignedIntValue, error);
  NSData *plaintext = key ? decryptPayload(envelope, key, error) : nil;
  NSString *text = plaintext ? [[NSString alloc] initWithData:plaintext encoding:NSUTF8StringEncoding] : nil;
  if (!text) return nil;
  if (keepKey) { gKey = [key mutableCopy]; gVaultPath = [path copy]; }
  NSData *jsonData = [text dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *payload = jsonData ? [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil] : nil;
  NSArray *accounts = [payload[@"accounts"] isKindOfClass:NSArray.class] ? payload[@"accounts"] : @[];
  return @{ @"path": path, @"plaintext": text, @"accountCount": @(accounts.count) };
}
BOOL savePlaintext(NSString *path, NSString *plaintext, NSData *key, BOOL backup, NSError **error) {
  NSDictionary *old = readEnvelope(path, error);
  NSDictionary *encrypted = old ? encryptPayload([plaintext dataUsingEncoding:NSUTF8StringEncoding], key, error) : nil;
  if (!encrypted) return NO;
  NSMutableDictionary *envelope = [encrypted mutableCopy];
  envelope[@"salt"] = old[@"salt"];
  envelope[@"iterations"] = old[@"iterations"];
  return writeEnvelope(envelope, path, backup, error);
}
NSString *choosePath(BOOL save, NSString *title, NSString *defaultName) {
  if (save) {
    NSSavePanel *panel = [NSSavePanel savePanel]; panel.title = title; panel.nameFieldStringValue = defaultName;
    return [panel runModal] == NSModalResponseOK ? panel.URL.path : nil;
  }
  NSOpenPanel *panel = [NSOpenPanel openPanel]; panel.title = title; panel.canChooseDirectories = NO; panel.allowsMultipleSelection = NO;
  return [panel runModal] == NSModalResponseOK ? panel.URL.path : nil;
}
}

std::string fiotp_host_invoke(const std::string &methodValue, const std::string &payloadValue) {
  @autoreleasepool {
    NSError *error = nil;
    NSDictionary *args = parseObject(payloadValue, &error);
    if (!args) return failure(error.localizedDescription ?: @"Geçersiz istek.", @"invalid_request");
    NSString *method = toNSString(methodValue);
    if ([method isEqual:@"vault.selectedPath"]) {
      NSString *saved = [NSUserDefaults.standardUserDefaults stringForKey:@"FiOTPSelectedVaultPath"];
      return response(YES, @{ @"path": saved ?: @"" });
    }
    if ([method isEqual:@"vault.rememberPath"]) {
      NSString *path = expandedPath(args[@"path"]);
      if (!path.length) return failure(@"Kasa yolu geçersiz.", @"invalid_path");
      [NSUserDefaults.standardUserDefaults setObject:path forKey:@"FiOTPSelectedVaultPath"];
      return response(YES, @{ @"path": path });
    }
    if ([method isEqual:@"vault.status"]) {
      NSString *path = expandedPath(args[@"path"]);
      return response(YES, @{ @"exists": @([NSFileManager.defaultManager fileExistsAtPath:path]), @"path": path });
    }
    if ([method isEqual:@"vault.create"]) {
      NSString *password = args[@"password"];
      if (password.length < 8) return failure(@"Master parola en az 8 karakter olmalıdır.", @"weak_password");
      NSString *path = expandedPath(args[@"path"]);
      if ([NSFileManager.defaultManager fileExistsAtPath:path]) {
        return failure(@"Bu konumda zaten bir kasa var. Mevcut kasayı açın veya başka bir konum seçin.", @"vault_exists");
      }
      NSData *salt = randomData(kSaltLength);
      NSData *key = deriveKey(password, salt, kIterations, &error);
      NSDictionary *encrypted = key ? encryptPayload([args[@"plaintext"] dataUsingEncoding:NSUTF8StringEncoding], key, &error) : nil;
      if (!encrypted) return failure(error.localizedDescription);
      NSMutableDictionary *envelope = [encrypted mutableCopy]; envelope[@"salt"] = [salt base64EncodedStringWithOptions:0];
      if (!writeEnvelope(envelope, path, YES, &error)) return failure(error.localizedDescription);
      gKey = [key mutableCopy]; gVaultPath = [path copy];
      return response(YES, @{ @"path": path });
    }
    if ([method isEqual:@"vault.open"] || [method isEqual:@"vault.readExternal"]) {
      NSString *path = expandedPath(args[@"path"]); BOOL keep = [method isEqual:@"vault.open"];
      NSDictionary *opened = openAtPath(path, args[@"password"], keep, &error);
      if (!opened && keep) {
        opened = openAtPath([path stringByAppendingString:@".bak"], args[@"password"], keep, nil);
        if (opened) { NSMutableDictionary *r = [opened mutableCopy]; r[@"path"] = path; r[@"recoveredFromBackup"] = @YES; gVaultPath = [path copy]; return response(YES, r); }
      }
      return opened ? response(YES, opened) : failure(error.localizedDescription, @"open_failed");
    }
    if ([method isEqual:@"vault.save"]) {
      if (!gKey) return failure(@"Kasa kilitli.", @"locked");
      NSString *path = expandedPath(args[@"path"] ?: gVaultPath);
      return savePlaintext(path, args[@"plaintext"], gKey, YES, &error) ? response(YES, @{}) : failure(error.localizedDescription);
    }
    if ([method isEqual:@"vault.lock"]) {
      if (gKey.length) memset(gKey.mutableBytes, 0, gKey.length); gKey = nil; gVaultPath = nil;
      return response(YES, @{});
    }
    if ([method isEqual:@"vault.changePassword"]) {
      NSString *path = expandedPath(args[@"path"] ?: gVaultPath);
      if (!openAtPath(path, args[@"currentPassword"], NO, &error)) return failure(error.localizedDescription, @"wrong_password");
      NSString *next = args[@"newPassword"]; if (next.length < 8) return failure(@"Yeni parola en az 8 karakter olmalıdır.", @"weak_password");
      NSData *salt = randomData(kSaltLength); NSData *key = deriveKey(next, salt, kIterations, &error);
      NSDictionary *encrypted = key ? encryptPayload([args[@"plaintext"] dataUsingEncoding:NSUTF8StringEncoding], key, &error) : nil;
      if (!encrypted) return failure(error.localizedDescription);
      NSMutableDictionary *envelope = [encrypted mutableCopy]; envelope[@"salt"] = [salt base64EncodedStringWithOptions:0];
      if (!writeEnvelope(envelope, path, YES, &error)) return failure(error.localizedDescription);
      if (gKey.length) memset(gKey.mutableBytes, 0, gKey.length); gKey = [key mutableCopy];
      return response(YES, @{});
    }
    if ([method isEqual:@"vault.export"]) {
      NSString *source = expandedPath(args[@"source"]), *destination = expandedPath(args[@"destination"]); NSFileManager *fm = NSFileManager.defaultManager;
      [fm removeItemAtPath:destination error:nil];
      if (![fm copyItemAtPath:source toPath:destination error:&error]) return failure(error.localizedDescription);
      chmod(destination.fileSystemRepresentation, S_IRUSR | S_IWUSR); return response(YES, @{ @"path": destination });
    }
    if ([method isEqual:@"clipboard.copy"]) {
      NSPasteboard *p = NSPasteboard.generalPasteboard; [p clearContents]; [p setString:args[@"text"] ?: @"" forType:NSPasteboardTypeString]; return response(YES, @{});
    }
    if ([method isEqual:@"crypto.hmac"]) {
      NSData *key = [[NSData alloc] initWithBase64EncodedString:args[@"key"] options:0];
      NSData *message = [[NSData alloc] initWithBase64EncodedString:args[@"message"] options:0];
      NSString *algorithm = args[@"algorithm"];
      CCHmacAlgorithm ccAlgorithm = kCCHmacAlgSHA1; size_t length = CC_SHA1_DIGEST_LENGTH;
      if ([algorithm isEqual:@"SHA256"]) { ccAlgorithm = kCCHmacAlgSHA256; length = CC_SHA256_DIGEST_LENGTH; }
      if ([algorithm isEqual:@"SHA512"]) { ccAlgorithm = kCCHmacAlgSHA512; length = CC_SHA512_DIGEST_LENGTH; }
      NSMutableData *digest = [NSMutableData dataWithLength:length];
      CCHmac(ccAlgorithm, key.bytes, key.length, message.bytes, message.length, digest.mutableBytes);
      return response(YES, @{ @"digest": [digest base64EncodedStringWithOptions:0] });
    }
    if ([method isEqual:@"qr.scanCamera"]) {
      FiOTPQRScanner *scanner = [FiOTPQRScanner new];
      NSString *value = [scanner scan:&error];
      return value ? response(YES, @{ @"value": value }) : failure(error.localizedDescription ?: @"QR tarama iptal edildi.", @"cancelled");
    }
    if ([method hasPrefix:@"dialog."]) {
      BOOL save = [method isEqual:@"dialog.saveVault"] || [method isEqual:@"dialog.saveBackup"];
      BOOL backup = [method containsString:@"Backup"];
      NSString *path = choosePath(save, backup ? @"FiOTP Şifreli Yedek" : @"FiOTP Kasası", backup ? @"fiotp-backup.json" : @"kasa.json");
      return path ? response(YES, @{ @"path": path }) : failure(@"İşlem iptal edildi.", @"cancelled");
    }
    return failure([NSString stringWithFormat:@"Bilinmeyen native işlem: %@", method], @"unknown_method");
  }
}

#ifndef FIOTP_HOST_STANDALONE
namespace {
std::string fiotp_host_thunk(void *, std::string method, std::string payload) {
  return fiotp_host_invoke(method, payload);
}
}

gea::CallableObject<std::string(std::string, std::string)> fiotpHostInvoke{fiotp_host_thunk, nullptr};
#endif
