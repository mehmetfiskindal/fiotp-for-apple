#import <Foundation/Foundation.h>
#include <cassert>
#include <fstream>
#include <string>
#include "fiotp_host.h"

static NSDictionary *call(const char *method, NSDictionary *payload) {
  NSData *input = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  std::string raw((const char *)input.bytes, input.length);
  std::string result = fiotp_host_invoke(method, raw);
  NSData *output = [NSData dataWithBytes:result.data() length:result.size()];
  return [NSJSONSerialization JSONObjectWithData:output options:0 error:nil];
}

int main() {
  @autoreleasepool {
    NSString *dir = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    NSString *path = [dir stringByAppendingPathComponent:@"vault.json"];
    NSString *plaintext = @"{\"schema\":1,\"accounts\":[{\"secret\":\"TOPSECRET\"}]}";

    NSDictionary *created = call("vault.create", @{ @"path": path, @"password": @"correct horse battery", @"plaintext": plaintext });
    assert([created[@"ok"] boolValue]);
    NSString *stored = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
    assert(![stored containsString:@"TOPSECRET"]);
    assert([stored containsString:@"AES-256-GCM"]);

    call("vault.lock", @{});
    NSDictionary *wrong = call("vault.open", @{ @"path": path, @"password": @"wrong password" });
    assert(![wrong[@"ok"] boolValue]);
    NSDictionary *opened = call("vault.open", @{ @"path": path, @"password": @"correct horse battery" });
    assert([opened[@"ok"] boolValue]);
    assert([opened[@"data"][@"plaintext"] isEqual:plaintext]);

    // Exercise the same multi-kilobyte save/reopen path used by Google
    // Authenticator migration imports, not only initial vault creation.
    NSMutableArray *accounts = [NSMutableArray array];
    for (NSUInteger i = 0; i < 24; i++) {
      [accounts addObject:@{ @"id": [NSString stringWithFormat:@"act-%lu", (unsigned long)i],
                             @"issuer": @"Migration Test", @"account": [NSString stringWithFormat:@"user%lu@example.com", (unsigned long)i],
                             @"secret": @"JBSWY3DPEHPK3PXP", @"type": @"totp" }];
    }
    NSData *largeData = [NSJSONSerialization dataWithJSONObject:@{ @"schema": @1, @"accounts": accounts } options:0 error:nil];
    NSString *largePlaintext = [[NSString alloc] initWithData:largeData encoding:NSUTF8StringEncoding];
    NSDictionary *saved = call("vault.save", @{ @"path": path, @"plaintext": largePlaintext });
    assert([saved[@"ok"] boolValue]);
    call("vault.lock", @{});
    NSDictionary *reopenedLarge = call("vault.open", @{ @"path": path, @"password": @"correct horse battery" });
    assert([reopenedLarge[@"ok"] boolValue]);
    assert([reopenedLarge[@"data"][@"accountCount"] unsignedIntegerValue] == accounts.count);
    assert([reopenedLarge[@"data"][@"plaintext"] isEqual:largePlaintext]);

    stored = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
    NSMutableDictionary *envelope = [[NSJSONSerialization JSONObjectWithData:[stored dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:nil] mutableCopy];
    NSDictionary *validEnvelope = [envelope copy];
    NSString *ciphertext = envelope[@"ciphertext"];
    unichar replacement = [ciphertext characterAtIndex:0] == 'A' ? 'B' : 'A';
    envelope[@"ciphertext"] = [NSString stringWithFormat:@"%C%@", replacement, [ciphertext substringFromIndex:1]];
    NSData *tampered = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
    [tampered writeToFile:path atomically:YES];
    call("vault.lock", @{});
    NSDictionary *rejected = call("vault.open", @{ @"path": path, @"password": @"correct horse battery" });
    // The valid .bak may recover the primary. External-open must always reject tampering.
    NSDictionary *externalRejected = call("vault.readExternal", @{ @"path": path, @"password": @"correct horse battery" });
    assert(![externalRejected[@"ok"] boolValue]);
    (void)rejected;

    // A Files-picked JSON document may look like a backup but contain fields
    // of the wrong type. Native decoding must return an error, never abort.
    NSString *invalidPath = [dir stringByAppendingPathComponent:@"invalid-backup.json"];
    NSArray<NSDictionary *> *invalidFields = @[
      @{ @"salt": @42 }, @{ @"iterations": @"600000" },
      @{ @"nonce": @42 }, @{ @"ciphertext": @[] }, @{ @"tag": NSNull.null },
    ];
    for (NSDictionary *replacementFields in invalidFields) {
      NSMutableDictionary *invalid = [validEnvelope mutableCopy];
      [invalid addEntriesFromDictionary:replacementFields];
      NSData *invalidJson = [NSJSONSerialization dataWithJSONObject:invalid options:0 error:nil];
      assert([invalidJson writeToFile:invalidPath atomically:YES]);
      NSDictionary *result = call("vault.readExternal", @{ @"path": invalidPath, @"password": @"correct horse battery" });
      assert(![result[@"ok"] boolValue]);
    }

    [[NSFileManager defaultManager] removeItemAtPath:dir error:nil];
    NSLog(@"Native encrypted vault tests passed");
  }
  return 0;
}
