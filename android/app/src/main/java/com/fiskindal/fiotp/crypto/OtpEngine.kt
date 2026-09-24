package com.fiskindal.fiotp.crypto

import java.net.URI
import java.net.URLDecoder
import com.fiskindal.fiotp.model.Account
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object OtpEngine {
    private const val BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun base32Decode(value: String): ByteArray {
        val clean = value.uppercase().filter { it != '=' && !it.isWhitespace() && it != '-' }
        require(clean.isNotEmpty()) { "Secret boş olamaz." }
        var bits = 0
        var buffer = 0
        val out = ByteArrayOutputStream()
        clean.forEach { ch ->
            val n = BASE32.indexOf(ch)
            require(n >= 0) { "Secret geçerli Base32 değil." }
            buffer = (buffer shl 5) or n
            bits += 5
            if (bits >= 8) {
                bits -= 8
                out.write((buffer shr bits) and 0xff)
            }
        }
        return out.toByteArray().also { require(it.isNotEmpty()) { "Secret geçersiz." } }
    }

    fun base32Encode(bytes: ByteArray): String {
        var buffer = 0
        var bits = 0
        val out = StringBuilder()
        bytes.forEach { b ->
            buffer = (buffer shl 8) or (b.toInt() and 0xff)
            bits += 8
            while (bits >= 5) {
                bits -= 5
                out.append(BASE32[(buffer shr bits) and 31])
            }
        }
        if (bits > 0) out.append(BASE32[(buffer shl (5 - bits)) and 31])
        return out.toString()
    }

    fun code(account: Account, epochSeconds: Long = System.currentTimeMillis() / 1000): String {
        val movingFactor = if (account.type.equals("hotp", true)) account.counter
        else epochSeconds / account.period.coerceAtLeast(1)
        return hotp(account.secret, movingFactor, account.algorithm, account.digits)
    }

    fun hotp(secret: String, counter: Long, algorithm: String = "SHA1", digits: Int = 6): String {
        require(counter >= 0) { "Sayaç negatif olamaz." }
        require(digits in 6..8) { "Kod uzunluğu 6–8 hane olmalıdır." }
        val macName = when (algorithm.uppercase()) {
            "SHA1" -> "HmacSHA1"
            "SHA256" -> "HmacSHA256"
            "SHA512" -> "HmacSHA512"
            else -> throw IllegalArgumentException("Desteklenmeyen algoritma.")
        }
        val mac = Mac.getInstance(macName)
        mac.init(SecretKeySpec(base32Decode(secret), macName))
        val hash = mac.doFinal(ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(counter).array())
        val offset = hash.last().toInt() and 0x0f
        val binary = ((hash[offset].toInt() and 0x7f) shl 24) or
            ((hash[offset + 1].toInt() and 0xff) shl 16) or
            ((hash[offset + 2].toInt() and 0xff) shl 8) or
            (hash[offset + 3].toInt() and 0xff)
        val modulus = when (digits) { 6 -> 1_000_000; 7 -> 10_000_000; else -> 100_000_000 }
        return (binary % modulus).toString().padStart(digits, '0')
    }

    data class Parsed(
        val issuer: String, val account: String, val secret: String,
        val algorithm: String, val digits: Int, val period: Int,
        val type: String, val counter: Long,
    )

    fun parseOtpAuth(uri: String): Parsed {
        val parsed = URI(uri.trim())
        val kind = parsed.host?.lowercase()
        require(parsed.scheme == "otpauth" && kind in setOf("totp", "hotp")) {
            "otpauth://totp veya otpauth://hotp URI girin."
        }
        val label = decodeComponent(parsed.rawPath.orEmpty().removePrefix("/"))
        val issuerLabel = label.substringBefore(':', "").trim()
        val accountLabel = if (':' in label) label.substringAfter(':').trim() else label.trim()
        val params = queryParameters(parsed.rawQuery)
        val secret = params["secret"]?.replace(Regex("[\\s-]"), "")?.uppercase()
            ?: throw IllegalArgumentException("URI içinde secret bulunamadı.")
        base32Decode(secret)
        val algorithm = params["algorithm"]?.uppercase()
            ?.takeIf { it in setOf("SHA1", "SHA256", "SHA512") } ?: "SHA1"
        val digits = params["digits"]?.toIntOrNull() ?: 6
        val period = params["period"]?.toIntOrNull() ?: 30
        val counter = params["counter"]?.toLongOrNull() ?: 0L
        require(digits in 6..8 && period in 1..86400 && counter >= 0) { "URI ayarları geçersiz." }
        return Parsed(params["issuer"]?.takeIf { it.isNotBlank() } ?: issuerLabel.ifBlank { "Hesap" },
            accountLabel.ifBlank { "kullanici" }, secret, algorithm, digits, period, kind!!, counter)
    }

    fun parseMigration(uri: String): List<Parsed> {
        val data = queryParameters(URI(uri.trim()).rawQuery)["data"]
            ?: throw IllegalArgumentException("Aktarım QR'ında data alanı yok.")
        val bytes = base64Decode(data)
        val outer = ProtoReader(bytes)
        val results = mutableListOf<Parsed>()
        while (!outer.eof) {
            val (number, wire) = outer.field()
            if (number == 1 && wire == 2) {
                val inner = ProtoReader(outer.bytes())
                var secret = byteArrayOf(); var name = ""; var issuer = ""
                var algorithm = 1; var digits = 1; var type = 2; var counter = 0L
                while (!inner.eof) {
                    val (f, w) = inner.field()
                    when (f) {
                        1 -> secret = inner.bytes()
                        2 -> name = String(inner.bytes(), StandardCharsets.UTF_8)
                        3 -> issuer = String(inner.bytes(), StandardCharsets.UTF_8)
                        4 -> algorithm = inner.varint().toInt()
                        5 -> digits = inner.varint().toInt()
                        6 -> type = inner.varint().toInt()
                        7 -> counter = inner.varint()
                        else -> inner.skip(w)
                    }
                }
                if (secret.isNotEmpty()) {
                    val sha = when (algorithm) { 2 -> "SHA256"; 3 -> "SHA512"; else -> "SHA1" }
                    val labelIssuer = name.substringBefore(':', "").trim()
                    val labelAccount = if (':' in name) name.substringAfter(':').trim() else name.trim()
                    results += Parsed(issuer.ifBlank { labelIssuer.ifBlank { "Hesap" } }, labelAccount.ifBlank { "kullanici" },
                        base32Encode(secret), sha, if (digits == 2) 8 else 6, 30,
                        if (type == 1) "hotp" else "totp", counter)
                }
            } else outer.skip(wire)
        }
        return results
    }

    fun migrationUri(accounts: List<Account>): String {
        val out = ByteArrayOutputStream()
        accounts.forEach { account ->
            val item = ByteArrayOutputStream()
            writeBytes(item, 1, base32Decode(account.secret))
            writeBytes(item, 2, "${account.issuer}:${account.account}".toByteArray(StandardCharsets.UTF_8))
            writeBytes(item, 3, account.issuer.toByteArray(StandardCharsets.UTF_8))
            writeVarintField(item, 4, when (account.algorithm.uppercase()) { "SHA256" -> 2; "SHA512" -> 3; else -> 1 }.toLong())
            writeVarintField(item, 5, if (account.digits == 8) 2 else 1)
            writeVarintField(item, 6, if (account.type == "hotp") 1 else 2)
            if (account.type == "hotp") writeVarintField(item, 7, account.counter)
            writeBytes(out, 1, item.toByteArray())
        }
        val encoded = base64UrlEncode(out.toByteArray())
        return "otpauth-migration://offline?data=$encoded&lock=0"
    }


    private fun queryParameters(query: String?): Map<String, String> = query.orEmpty().split('&').mapNotNull { pair ->
        if (pair.isEmpty()) null else {
            val key = pair.substringBefore('=')
            val value = pair.substringAfter('=', "")
            decodeComponent(key).lowercase() to decodeComponent(value)
        }
    }.toMap()

    private fun decodeComponent(value: String): String = URLDecoder.decode(value.replace("+", "%2B"), "UTF-8")

    private fun base64Decode(value: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        val clean = value.replace('-', '+').replace('_', '/').filter { it in alphabet }
        var buffer = 0
        var bits = 0
        val out = ByteArrayOutputStream()
        clean.forEach { ch ->
            buffer = (buffer shl 6) or alphabet.indexOf(ch)
            bits += 6
            if (bits >= 8) { bits -= 8; out.write((buffer shr bits) and 255) }
        }
        return out.toByteArray()
    }

    private fun base64UrlEncode(bytes: ByteArray): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val out = StringBuilder()
        var buffer = 0
        var bits = 0
        bytes.forEach { byte ->
            buffer = (buffer shl 8) or (byte.toInt() and 255)
            bits += 8
            while (bits >= 6) { bits -= 6; out.append(alphabet[(buffer shr bits) and 63]) }
        }
        if (bits > 0) out.append(alphabet[(buffer shl (6 - bits)) and 63])
        return out.toString()
    }

    private fun writeBytes(out: ByteArrayOutputStream, field: Int, bytes: ByteArray) {
        writeVarint(out, ((field shl 3) or 2).toLong()); writeVarint(out, bytes.size.toLong()); out.write(bytes)
    }
    private fun writeVarintField(out: ByteArrayOutputStream, field: Int, value: Long) {
        writeVarint(out, (field shl 3).toLong()); writeVarint(out, value)
    }
    private fun writeVarint(out: ByteArrayOutputStream, value: Long) {
        var n = value
        while (n and -128L != 0L) { out.write(((n and 127) or 128).toInt()); n = n ushr 7 }
        out.write(n.toInt())
    }

    private class ProtoReader(private val data: ByteArray) {
        private var position = 0
        val eof get() = position >= data.size
        fun varint(): Long {
            var result = 0L; var shift = 0
            do {
                require(position < data.size && shift <= 63) { "Google aktarım verisi bozuk." }
                val b = data[position++].toInt() and 255
                result = result or ((b and 127).toLong() shl shift)
                if (b and 128 == 0) return result
                shift += 7
            } while (true)
        }
        fun field(): Pair<Int, Int> { val tag = varint(); return (tag ushr 3).toInt() to (tag and 7).toInt() }
        fun bytes(): ByteArray {
            val size = varint().toInt(); require(size >= 0 && position + size <= data.size) { "Google aktarım verisi kesilmiş." }
            return data.copyOfRange(position, position + size).also { position += size }
        }
        fun skip(wire: Int) { when (wire) { 0 -> varint(); 1 -> position += 8; 2 -> bytes(); 5 -> position += 4; else -> error("Desteklenmeyen aktarım alanı.") }; require(position <= data.size) }
    }
}
