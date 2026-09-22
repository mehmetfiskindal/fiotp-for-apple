import assert from 'node:assert/strict'
import { base32Decode, generateHotp, generateTotp, parseOtpAuthUri } from '../src/crypto/totp.ts'

const hotpSecret = base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
const expectedHotp = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
for (let counter = 0; counter < expectedHotp.length; counter++) {
  assert.equal(generateHotp(hotpSecret, counter), expectedHotp[counter])
}

const sha1Secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const sha256Secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'
const times = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000]
const sha1Expected = ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130']
const sha256Expected = ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706']
for (let i = 0; i < times.length; i++) {
  assert.equal(generateTotp(sha1Secret, 30, 8, 'SHA1', times[i] * 1000).code, sha1Expected[i])
  assert.equal(generateTotp(sha256Secret, 30, 8, 'SHA256', times[i] * 1000).code, sha256Expected[i])
}

const parsed = parseOtpAuthUri('otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=45')
assert.equal(parsed.issuer, 'Example')
assert.equal(parsed.account, 'alice')
assert.equal(parsed.algorithm, 'SHA256')
assert.equal(parsed.digits, 8)
assert.equal(parsed.period, 45)

console.log('OTP RFC vectors passed')
