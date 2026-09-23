import assert from 'node:assert/strict'
import { base32Decode, base32Encode, generateHotp, generateTotp, parseOtpAuthUri, sha512 } from '../src/crypto/totp.ts'

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
const sha512Secret = base32Encode(new TextEncoder().encode('1234567890123456789012345678901234567890123456789012345678901234'))
const sha512Expected = ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826']
for (let i = 0; i < times.length; i++) {
  assert.equal(generateTotp(sha1Secret, 30, 8, 'SHA1', times[i] * 1000).code, sha1Expected[i])
  assert.equal(generateTotp(sha256Secret, 30, 8, 'SHA256', times[i] * 1000).code, sha256Expected[i])
  assert.equal(generateTotp(sha512Secret, 30, 8, 'SHA512', times[i] * 1000).code, sha512Expected[i])
}

const text = new TextEncoder().encode('abc')
const digest = [...sha512(text)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
assert.equal(digest, 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f')

const parsed = parseOtpAuthUri('otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=45')
assert.equal(parsed.issuer, 'Example')
assert.equal(parsed.account, 'alice')
assert.equal(parsed.algorithm, 'SHA256')
assert.equal(parsed.digits, 8)
assert.equal(parsed.period, 45)

console.log('OTP RFC vectors passed')
