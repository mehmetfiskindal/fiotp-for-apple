import { MacHost } from '../platform/macHost.ts'

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
// HMAC (RFC 2104)
// ==========================================
export function hmac(algorithm: OtpAlgorithm, key: Uint8Array, message: Uint8Array): Uint8Array {
  if (algorithm === 'SHA512') {
    if (!MacHost.available) {
      throw new Error('SHA-512 OTP yalnız native macOS hedefinde desteklenir')
    }
    const envelope = JSON.parse(MacHost.invoke('crypto.hmac', {
      algorithm,
      key: bytesToBase64(key),
      message: bytesToBase64(message),
    })) as { ok: boolean; data: { digest: string } }
    return base64Decode(envelope.data.digest)
  }
  const hashFn = algorithm === 'SHA256' ? sha256 : sha1
  const blockSize = 64
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
