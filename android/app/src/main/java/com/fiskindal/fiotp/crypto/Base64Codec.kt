package com.fiskindal.fiotp.crypto

internal object Base64Codec {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    fun encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size + 2) / 3 * 4)
        var i = 0
        while (i < bytes.size) {
            val a = bytes[i++].toInt() and 255
            val hasB = i < bytes.size
            val b = if (hasB) bytes[i++].toInt() and 255 else 0
            val hasC = i < bytes.size
            val c = if (hasC) bytes[i++].toInt() and 255 else 0
            out.append(ALPHABET[a ushr 2])
            out.append(ALPHABET[((a and 3) shl 4) or (b ushr 4)])
            out.append(if (hasB) ALPHABET[((b and 15) shl 2) or (c ushr 6)] else '=')
            out.append(if (hasC) ALPHABET[c and 63] else '=')
        }
        return out.toString()
    }

    fun decode(value: String): ByteArray {
        val clean = value.filterNot(Char::isWhitespace)
        require(clean.all { it == '=' || it in ALPHABET }) { "Geçersiz Base64 verisi." }
        val firstPadding = clean.indexOf('=')
        require(firstPadding < 0 || clean.substring(firstPadding).all { it == '=' }) { "Geçersiz Base64 padding." }
        val chars = if (firstPadding < 0) clean else clean.substring(0, firstPadding)
        require(chars.length % 4 != 1) { "Geçersiz Base64 uzunluğu." }
        val out = ByteArray((chars.length * 6) / 8)
        var buffer = 0
        var bits = 0
        var offset = 0
        chars.forEach { ch ->
            buffer = (buffer shl 6) or ALPHABET.indexOf(ch)
            bits += 6
            if (bits >= 8) { bits -= 8; out[offset++] = (buffer shr bits).toByte() }
        }
        return out
    }
}
