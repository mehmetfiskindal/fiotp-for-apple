package com.fiskindal.fiotp.vault

import com.fiskindal.fiotp.crypto.Base64Codec
import com.fiskindal.fiotp.crypto.VaultPrimitives
import org.json.JSONObject
import java.security.SecureRandom

internal object VaultCrypto {
    const val DEFAULT_ITERATIONS = 600_000
    const val MIN_ITERATIONS = VaultPrimitives.MIN_ITERATIONS
    const val MAX_ITERATIONS = VaultPrimitives.MAX_ITERATIONS
    private const val SALT_BYTES = 16
    private const val KEY_BYTES = 32
    private const val NONCE_BYTES = 12
    private const val TAG_BYTES = 16
    private val random = SecureRandom()

    data class KeyMaterial(val salt: ByteArray, val iterations: Int, val key: ByteArray) {
        fun clear() { key.fill(0); salt.fill(0) }
    }

    fun create(password: String): Pair<KeyMaterial, JSONObject> {
        val salt = ByteArray(SALT_BYTES).also(random::nextBytes)
        val material = KeyMaterial(salt, DEFAULT_ITERATIONS, derive(password, salt, DEFAULT_ITERATIONS))
        return material to encrypt("{\"schema\":1,\"accounts\":[]}".toByteArray(Charsets.UTF_8), material)
    }

    fun unlock(envelope: JSONObject, password: String): Pair<KeyMaterial, ByteArray> {
        require(envelope.optInt("version", -1) == 1 && envelope.optString("cipher") == "AES-256-GCM" &&
            envelope.optString("kdf") == "PBKDF2-HMAC-SHA256") { "Desteklenmeyen veya geçersiz kasa biçimi." }
        val salt = decode(envelope, "salt", SALT_BYTES)
        val nonce = decode(envelope, "nonce", NONCE_BYTES)
        val ciphertext = decode(envelope, "ciphertext", null)
        val tag = decode(envelope, "tag", TAG_BYTES)
        val iterations = envelope.optInt("iterations", -1)
        VaultPrimitives.checkIterations(iterations)
        val material = KeyMaterial(salt, iterations, derive(password, salt, iterations))
        try {
            return material to VaultPrimitives.decrypt(ciphertext, tag, material.key, nonce)
        } catch (e: Exception) {
            material.clear()
            throw IllegalArgumentException("Parola hatalı veya kasa bozulmuş/kurcalanmış.", e)
        } finally {
            nonce.fill(0); ciphertext.fill(0); tag.fill(0)
        }
    }

    fun encrypt(plaintext: ByteArray, material: KeyMaterial): JSONObject {
        val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
        val sealed = VaultPrimitives.encrypt(plaintext, material.key, nonce)
        val ciphertext = sealed.copyOfRange(0, sealed.size - TAG_BYTES)
        val tag = sealed.copyOfRange(sealed.size - TAG_BYTES, sealed.size)
        return JSONObject()
            .put("version", 1)
            .put("cipher", "AES-256-GCM")
            .put("kdf", "PBKDF2-HMAC-SHA256")
            .put("iterations", material.iterations)
            .put("salt", encode(material.salt))
            .put("nonce", encode(nonce))
            .put("ciphertext", encode(ciphertext))
            .put("tag", encode(tag))
            .also { nonce.fill(0); sealed.fill(0); ciphertext.fill(0); tag.fill(0) }
    }

    fun derive(password: String, salt: ByteArray, iterations: Int): ByteArray = VaultPrimitives.derive(password, salt, iterations)

    private fun decode(json: JSONObject, key: String, expected: Int?): ByteArray {
        val value = json.optString(key, "")
        require(value.isNotEmpty()) { "Kasa şifreleme alanı eksik: $key" }
        val bytes = try { Base64Codec.decode(value) }
        catch (e: IllegalArgumentException) { throw IllegalArgumentException("Kasa alanı Base64 değil: $key", e) }
        require(expected == null || bytes.size == expected) { "Kasa alanı hatalı uzunlukta: $key" }
        return bytes
    }

    private fun encode(bytes: ByteArray) = Base64Codec.encode(bytes)
}
