/**
 * FiOTP Core Crypto & OTP Engine (RFC 6238 / RFC 4226 / RFC 4648)
 * Pure TypeScript implementation with zero external dependencies.
 * Fully compatible with Web, macOS native, Node, and embedded targets.
 */

export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'
export type OtpType = 'totp' | 'hotp'

export interface OtpOptions {
  digits?: number
  algorithm?: OtpAlgorithm
  period?: number
}

export interface TotpCode {
  code: string
  formattedCode: string
  remainingSeconds: number
  periodSeconds: number
  percentRemaining: number
}

// ==========================================
// Base32 (RFC 4648) Encode & Decode
// ==========================================
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (clean.length === 0) {
    throw new Error('Base32 anahtarı boş olamaz')
  }

  let bits = 0
  let value = 0
  const output: number[] = []

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i])
    if (idx === -1) {
      throw new Error(`Geçersiz Base32 karakteri: '${clean[i]}'`)
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }

  return output
}

// ==========================================
// SHA-1 (RFC 3174)
// ==========================================
export function sha1(message: Uint8Array): Uint8Array {
  const ml = message.length
  const bitLen = ml * 8

  const withPadLen = (((ml + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(withPadLen)
  padded.set(message)
  padded[ml] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(withPadLen - 4, bitLen, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Uint32Array(80)

  for (let chunk = 0; chunk < withPadLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4, false)
    }
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (v << 1) | (v >>> 31)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = temp
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }

  const result = new Uint8Array(20)
  const resView = new DataView(result.buffer)
  resView.setUint32(0, h0, false)
  resView.setUint32(4, h1, false)
  resView.setUint32(8, h2, false)
  resView.setUint32(12, h3, false)
  resView.setUint32(16, h4, false)
  return result
}

// ==========================================
// SHA-256 (FIPS 180-4)
// ==========================================
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256(message: Uint8Array): Uint8Array {
  const ml = message.length
  const bitLen = ml * 8

  const withPadLen = (((ml + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(withPadLen)
  padded.set(message)
  padded[ml] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(withPadLen - 4, bitLen, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const w = new Uint32Array(64)

  for (let chunk = 0; chunk < withPadLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(chunk + i * 4, false)
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + K256[i] + w[i]) | 0
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }

  const result = new Uint8Array(32)
  const resView = new DataView(result.buffer)
  resView.setUint32(0, h0, false)
  resView.setUint32(4, h1, false)
  resView.setUint32(8, h2, false)
  resView.setUint32(12, h3, false)
  resView.setUint32(16, h4, false)
  resView.setUint32(20, h5, false)
  resView.setUint32(24, h6, false)
  resView.setUint32(28, h7, false)
  return result
}

// ==========================================
// SHA-512 (FIPS 180-4)
// ==========================================
const K512_HEX = [
  '428a2f98d728ae22','7137449123ef65cd','b5c0fbcfec4d3b2f','e9b5dba58189dbbc','3956c25bf348b538','59f111f1b605d019','923f82a4af194f9b','ab1c5ed5da6d8118',
  'd807aa98a3030242','12835b0145706fbe','243185be4ee4b28c','550c7dc3d5ffb4e2','72be5d74f27b896f','80deb1fe3b1696b1','9bdc06a725c71235','c19bf174cf692694',
  'e49b69c19ef14ad2','efbe4786384f25e3','0fc19dc68b8cd5b5','240ca1cc77ac9c65','2de92c6f592b0275','4a7484aa6ea6e483','5cb0a9dcbd41fbd4','76f988da831153b5',
  '983e5152ee66dfab','a831c66d2db43210','b00327c898fb213f','bf597fc7beef0ee4','c6e00bf33da88fc2','d5a79147930aa725','06ca6351e003826f','142929670a0e6e70',
  '27b70a8546d22ffc','2e1b21385c26c926','4d2c6dfc5ac42aed','53380d139d95b3df','650a73548baf63de','766a0abb3c77b2a8','81c2c92e47edaee6','92722c851482353b',
  'a2bfe8a14cf10364','a81a664bbc423001','c24b8b70d0f89791','c76c51a30654be30','d192e819d6ef5218','d69906245565a910','f40e35855771202a','106aa07032bbd1b8',
  '19a4c116b8d2d0c8','1e376c085141ab53','2748774cdf8eeb99','34b0bcb5e19b48a8','391c0cb3c5c95a63','4ed8aa4ae3418acb','5b9cca4f7763e373','682e6ff3d6b2b8a3',
  '748f82ee5defb2fc','78a5636f43172f60','84c87814a1f0ab72','8cc702081a6439ec','90befffa23631e28','a4506cebde82bde9','bef9a3f7b2c67915','c67178f2e372532b',
  'ca273eceea26619c','d186b8c721c0c207','eada7dd6cde0eb1e','f57d4f7fee6ed178','06f067aa72176fba','0a637dc5a2c898a6','113f9804bef90dae','1b710b35131c471b',
  '28db77f523047d84','32caab7b40c72493','3c9ebe0a15c9bebc','431d67c49c100d4c','4cc5d4becb3e42b6','597f299cfc657e2a','5fcb6fab3ad6faec','6c44198c4a475817',
]
const K512_HI = K512_HEX.map((word) => parseInt(word.slice(0, 8), 16) >>> 0)
const K512_LO = K512_HEX.map((word) => parseInt(word.slice(8), 16) >>> 0)

function rotr64(hi: number, lo: number, amount: number): [number, number] {
  if (amount === 32) return [lo, hi]
  if (amount > 32) return rotr64(lo, hi, amount - 32)
  return [((hi >>> amount) | (lo << (32 - amount))) >>> 0, ((lo >>> amount) | (hi << (32 - amount))) >>> 0]
}

function add64(hi: number[], lo: number[], indexes: number[]): [number, number] {
  let lowSum = 0
  let highSum = 0
  for (const index of indexes) { lowSum += lo[index]; highSum += hi[index] }
  const low = lowSum >>> 0
  return [(highSum + Math.floor(lowSum / 0x100000000)) >>> 0, low]
}

export function sha512(message: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((message.length + 17) / 128) * 128
  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = message.length * 8
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const stateHi = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  const stateLo = [0xf3bcc908,0x84caa73b,0xfe94f82b,0x5f1d36f1,0xade682d1,0x2b3e6c1f,0xfb41bd6b,0x137e2179]
  const wordsHi = new Array<number>(80)
  const wordsLo = new Array<number>(80)

  for (let offset = 0; offset < paddedLength; offset += 128) {
    for (let i = 0; i < 16; i++) {
      wordsHi[i] = view.getUint32(offset + i * 8, false)
      wordsLo[i] = view.getUint32(offset + i * 8 + 4, false)
    }
    for (let i = 16; i < 80; i++) {
      const xh = wordsHi[i - 15], xl = wordsLo[i - 15], yh = wordsHi[i - 2], yl = wordsLo[i - 2]
      const r01 = rotr64(xh, xl, 1), r08 = rotr64(xh, xl, 8)
      const s0h = (r01[0] ^ r08[0] ^ (xh >>> 7)) >>> 0
      const s0l = (r01[1] ^ r08[1] ^ ((xh << 25) | (xl >>> 7))) >>> 0
      const r19 = rotr64(yh, yl, 19), r61 = rotr64(yh, yl, 61)
      const s1h = (r19[0] ^ r61[0] ^ (yh >>> 6)) >>> 0
      const s1l = (r19[1] ^ r61[1] ^ ((yh << 26) | (yl >>> 6))) >>> 0
      const lowSum = wordsLo[i - 16] + wordsLo[i - 7] + s0l + s1l
      wordsLo[i] = lowSum >>> 0
      wordsHi[i] = (wordsHi[i - 16] + wordsHi[i - 7] + s0h + s1h + Math.floor(lowSum / 0x100000000)) >>> 0
    }

    let ah = stateHi[0], bh = stateHi[1], ch = stateHi[2], dh = stateHi[3]
    let eh = stateHi[4], fh = stateHi[5], gh = stateHi[6], hh = stateHi[7]
    let al = stateLo[0], bl = stateLo[1], cl = stateLo[2], dl = stateLo[3]
    let el = stateLo[4], fl = stateLo[5], gl = stateLo[6], hl = stateLo[7]
    for (let i = 0; i < 80; i++) {
      const r14 = rotr64(eh, el, 14), r18 = rotr64(eh, el, 18), r41 = rotr64(eh, el, 41)
      const s1h = (r14[0] ^ r18[0] ^ r41[0]) >>> 0, s1l = (r14[1] ^ r18[1] ^ r41[1]) >>> 0
      const choiceH = ((eh & fh) ^ (~eh & gh)) >>> 0, choiceL = ((el & fl) ^ (~el & gl)) >>> 0
      const t1LowSum = hl + s1l + choiceL + K512_LO[i] + wordsLo[i]
      const t1l = t1LowSum >>> 0
      const t1h = (hh + s1h + choiceH + K512_HI[i] + wordsHi[i] + Math.floor(t1LowSum / 0x100000000)) >>> 0
      const r28 = rotr64(ah, al, 28), r34 = rotr64(ah, al, 34), r39 = rotr64(ah, al, 39)
      const s0h = (r28[0] ^ r34[0] ^ r39[0]) >>> 0, s0l = (r28[1] ^ r34[1] ^ r39[1]) >>> 0
      const majorityH = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0
      const majorityL = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0
      const t2LowSum = s0l + majorityL
      const t2l = t2LowSum >>> 0, t2h = (s0h + majorityH + Math.floor(t2LowSum / 0x100000000)) >>> 0
      const nextElSum = dl + t1l
      const nextEl = nextElSum >>> 0, nextEh = (dh + t1h + Math.floor(nextElSum / 0x100000000)) >>> 0
      const nextAlSum = t1l + t2l
      const nextAl = nextAlSum >>> 0, nextAh = (t1h + t2h + Math.floor(nextAlSum / 0x100000000)) >>> 0
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el; eh = nextEh; el = nextEl
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al; ah = nextAh; al = nextAl
    }
    for (let i = 0; i < 8; i++) {
      const sum = stateLo[i] + [al, bl, cl, dl, el, fl, gl, hl][i]
      stateLo[i] = sum >>> 0
      stateHi[i] = (stateHi[i] + [ah, bh, ch, dh, eh, fh, gh, hh][i] + Math.floor(sum / 0x100000000)) >>> 0
    }
  }

  const result = new Uint8Array(64)
  const resultView = new DataView(result.buffer)
  for (let i = 0; i < 8; i++) {
    resultView.setUint32(i * 8, stateHi[i], false)
    resultView.setUint32(i * 8 + 4, stateLo[i], false)
  }
  return result
}

// ==========================================
// HMAC (RFC 2104)
// ==========================================
export function hmac(algorithm: OtpAlgorithm, key: Uint8Array, message: Uint8Array): Uint8Array {
  const hashFn = algorithm === 'SHA512' ? sha512 : algorithm === 'SHA256' ? sha256 : sha1
  const blockSize = algorithm === 'SHA512' ? 128 : 64
  let k = key
  if (k.length > blockSize) {
    k = hashFn(k)
  }

  const kPadded = new Uint8Array(blockSize)
  kPadded.set(k)

  const ipad = new Uint8Array(blockSize)
  const opad = new Uint8Array(blockSize)
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = kPadded[i] ^ 0x36
    opad[i] = kPadded[i] ^ 0x5c
  }

  const inner = new Uint8Array(blockSize + message.length)
  inner.set(ipad)
  inner.set(message, blockSize)
  const innerHash = hashFn(inner)

  const outer = new Uint8Array(blockSize + innerHash.length)
  outer.set(opad)
  outer.set(innerHash, blockSize)
  return hashFn(outer)
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c
    out += BASE64_ALPHABET[(triple >>> 18) & 63]
    out += BASE64_ALPHABET[(triple >>> 12) & 63]
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >>> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '='
  }
  return out
}

// ==========================================
// HOTP (RFC 4226) & Dynamic Truncation
// ==========================================
export function generateHotp(key: Uint8Array, counter: number, options?: OtpOptions): string {
  const digits = options?.digits ?? 6
  const algorithm = options?.algorithm ?? 'SHA1'

  const counterBytes = new Uint8Array(8)
  let c = Math.floor(counter)
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = c & 0xff
    c = Math.floor(c / 256)
  }

  const digest = hmac(algorithm, key, counterBytes)

  // RFC 4226 §5.3 Dynamic Truncation
  const offset = digest[digest.length - 1] & 0x0f
  const codeInt =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  const mod = 10 ** digits
  const code = (codeInt % mod).toString().padStart(digits, '0')
  return code
}

// ==========================================
// TOTP (RFC 6238)
// ==========================================
export function formatCode(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`
  }
  if (code.length === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`
  }
  return code
}

export function generateTotp(
  secretBase32: string,
  period = 30,
  digits = 6,
  algorithm: OtpAlgorithm = 'SHA1',
  nowMs = Date.now()
): TotpCode {
  const key = base32Decode(secretBase32)
  const epochSec = Math.floor(nowMs / 1000)
  const counter = Math.floor(epochSec / period)
  const remainingSeconds = period - (epochSec % period)
  const code = generateHotp(key, counter, { digits, algorithm })
  const formatted = formatCode(code)
  const percentRemaining = Math.max(0, Math.min(100, (remainingSeconds / period) * 100))

  return {
    code,
    formattedCode: formatted,
    remainingSeconds,
    periodSeconds: period,
    percentRemaining,
  }
}

/**
 * Verify a TOTP code with time-drift tolerance (±1 period).
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  period = 30,
  digits = 6,
  algorithm: OtpAlgorithm = 'SHA1',
  tolerance = 1,
  nowMs = Date.now()
): boolean {
  const cleanToken = token.trim().replace(/\s/g, '')
  if (cleanToken.length !== digits || !/^\d+$/.test(cleanToken)) {
    return false
  }

  const key = base32Decode(secretBase32)
  const epochSec = Math.floor(nowMs / 1000)
  const currentCounter = Math.floor(epochSec / period)

  for (let drift = -tolerance; drift <= tolerance; drift++) {
    const candidate = generateHotp(key, currentCounter + drift, { digits, algorithm })
    let different = 0
    for (let i = 0; i < candidate.length; i++) {
      different |= candidate.charCodeAt(i) ^ cleanToken.charCodeAt(i)
    }
    if (different === 0) {
      return true
    }
  }

  return false
}

// ==========================================
// otpauth:// URI Parser & Builder
// ==========================================
export interface ParsedOtpAuth {
  type: OtpType
  issuer: string
  account: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  counter: number
}

export function parseOtpAuthUri(uri: string): ParsedOtpAuth {
  const clean = uri.trim()
  if (!clean.startsWith('otpauth://')) {
    throw new Error('Şema otpauth olmalıdır (örn: otpauth://totp/...)')
  }

  const isHotp = clean.startsWith('otpauth://hotp/')
  const isTotp = clean.startsWith('otpauth://totp/')
  if (!isHotp && !isTotp) {
    throw new Error('Tip totp veya hotp olmalıdır')
  }

  const type: OtpType = isHotp ? 'hotp' : 'totp'

  // Extract path and query
  const questionIdx = clean.indexOf('?')
  const pathPart = questionIdx >= 0 ? clean.slice(type === 'totp' ? 15 : 15, questionIdx) : clean.slice(15)
  const queryString = questionIdx >= 0 ? clean.slice(questionIdx + 1) : ''

  // Label decoding (Issuer:Account or just Account)
  const decodedLabel = decodeURIComponent(pathPart.replace(/^\/+/, ''))
  const colonIdx = decodedLabel.indexOf(':')
  let labelIssuer = colonIdx >= 0 ? decodedLabel.slice(0, colonIdx).trim() : ''
  let labelAccount = colonIdx >= 0 ? decodedLabel.slice(colonIdx + 1).trim() : decodedLabel.trim()

  // Parse query parameters
  const params: Record<string, string> = {}
  for (const pair of queryString.split('&')) {
    if (!pair) continue
    const eqIdx = pair.indexOf('=')
    if (eqIdx >= 0) {
      const k = decodeURIComponent(pair.slice(0, eqIdx)).toLowerCase()
      const v = decodeURIComponent(pair.slice(eqIdx + 1))
      params[k] = v
    }
  }

  const secretRaw = params['secret']
  if (!secretRaw) {
    throw new Error('URI içinde secret parametresi bulunamadı')
  }
  const secret = secretRaw.replace(/[\s-]/g, '').toUpperCase()
  base32Decode(secret) // validate

  const issuerParam = params['issuer']?.trim()
  const issuer = issuerParam || labelIssuer || 'Hesap'
  const account = labelAccount || 'kullanici'

  let algorithm: OtpAlgorithm = 'SHA1'
  if (params['algorithm']) {
    const a = params['algorithm'].toUpperCase()
    if (a === 'SHA256') algorithm = 'SHA256'
    else if (a === 'SHA512') algorithm = 'SHA512'
  }

  const digits = params['digits'] ? parseInt(params['digits'], 10) : 6
  const period = params['period'] ? parseInt(params['period'], 10) : 30
  const counter = params['counter'] ? parseInt(params['counter'], 10) : 0

  return {
    type,
    issuer,
    account,
    secret,
    algorithm,
    digits,
    period,
    counter,
  }
}

export function buildOtpAuthUri(acc: {
  type: OtpType
  issuer: string
  account: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  counter?: number
}): string {
  const encIssuer = encodeURIComponent(acc.issuer || 'Hesap')
  const encAccount = encodeURIComponent(acc.account || '')
  let url = `otpauth://${acc.type}/${encIssuer}:${encAccount}?secret=${acc.secret}&issuer=${encIssuer}`
  if (acc.algorithm !== 'SHA1') url += `&algorithm=${acc.algorithm}`
  if (acc.digits !== 6) url += `&digits=${acc.digits}`
  if (acc.type === 'totp' && acc.period !== 30) url += `&period=${acc.period}`
  if (acc.type === 'hotp') url += `&counter=${acc.counter ?? 0}`
  return url
}

// ==========================================
// Google Authenticator Migration Protobuf
// (otpauth-migration://offline?data=...)
// ==========================================
export class ProtobufReader {
  private offset = 0
  private readonly buffer: Uint8Array
  constructor(buffer: Uint8Array) {
    this.buffer = buffer
  }

  get eof(): boolean {
    return this.offset >= this.buffer.length
  }

  readField(): { fieldNumber: number; wireType: number } | null {
    if (this.eof) return null
    const tag = this.readVarint()
    return {
      fieldNumber: Number(tag >> 3n),
      wireType: Number(tag & 0x07n),
    }
  }

  readVarint(): bigint {
    let result = 0n
    let shift = 0n
    for (;;) {
      if (this.offset >= this.buffer.length) throw new Error('Kesik varint')
      const byte = this.buffer[this.offset++]
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) break
      shift += 7n
      if (shift > 63n) throw new Error('Varint taşması')
    }
    return result
  }

  readLengthDelimited(): Uint8Array {
    const length = Number(this.readVarint())
    if (length < 0 || this.offset + length > this.buffer.length) {
      throw new Error('Kesik veri alanı')
    }
    const slice = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  skipField(wireType: number): void {
    switch (wireType) {
      case 0:
        this.readVarint()
        break
      case 1:
        this.offset += 8
        break
      case 2:
        this.readLengthDelimited()
        break
      case 5:
        this.offset += 4
        break
      default:
        throw new Error(`Desteklenmeyen wire type: ${wireType}`)
    }
  }

  static decodeUtf8(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i])
    }
    return out
  }
}

export interface MigrationAccount {
  issuer: string
  account: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  type: OtpType
  counter: number
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Decode(str: string): Uint8Array {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '')
  const len = clean.length
  const output: number[] = []

  let bits = 0
  let value = 0

  for (let i = 0; i < len; i++) {
    const idx = B64_CHARS.indexOf(clean[i])
    if (idx < 0) continue
    value = (value << 6) | idx
    bits += 6
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}

export function parseMigrationUri(uri: string): MigrationAccount[] {
  const match = /(?:^|[&?])data=([^&]*)/.exec(uri)
  if (!match) {
    throw new Error('data parametresi bulunamadı')
  }

  const dataText = decodeURIComponent(match[1])
  const normalized = dataText.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = base64Decode(normalized)

  const reader = new ProtobufReader(bytes)
  const accounts: MigrationAccount[] = []

  while (!reader.eof) {
    const field = reader.readField()
    if (!field) break
    if (field.fieldNumber === 1 && field.wireType === 2) {
      // OtpParameters message
      const inner = new ProtobufReader(reader.readLengthDelimited())
      let secretBytes: Uint8Array | null = null
      let name = ''
      let issuer = ''
      let algorithmNum = 1
      let digitsNum = 1
      let typeNum = 2
      let counter = 0

      while (!inner.eof) {
        const inField = inner.readField()
        if (!inField) break
        switch (inField.fieldNumber) {
          case 1:
            secretBytes = inner.readLengthDelimited()
            break
          case 2:
            name = ProtobufReader.decodeUtf8(inner.readLengthDelimited())
            break
          case 3:
            issuer = ProtobufReader.decodeUtf8(inner.readLengthDelimited())
            break
          case 4:
            algorithmNum = Number(inner.readVarint())
            break
          case 5:
            digitsNum = Number(inner.readVarint())
            break
          case 6:
            typeNum = Number(inner.readVarint())
            break
          case 7:
            counter = Number(inner.readVarint())
            break
          default:
            inner.skipField(inField.wireType)
        }
      }

      if (secretBytes && secretBytes.length > 0) {
        const secret = base32Encode(secretBytes)
        let algorithm: OtpAlgorithm = 'SHA1'
        if (algorithmNum === 2) algorithm = 'SHA256'
        else if (algorithmNum === 3) algorithm = 'SHA512'

        const type: OtpType = typeNum === 1 ? 'hotp' : 'totp'
        const digits = digitsNum === 2 ? 8 : 6
        const account = name.includes(':') ? name.split(':')[1].trim() : name

        accounts.push({
          issuer: issuer || (name.includes(':') ? name.split(':')[0].trim() : 'Hesap'),
          account: account || 'kullanici',
          secret,
          algorithm,
          digits,
          type,
          counter,
        })
      }
    } else {
      reader.skipField(field.wireType)
    }
  }

  return accounts
}
