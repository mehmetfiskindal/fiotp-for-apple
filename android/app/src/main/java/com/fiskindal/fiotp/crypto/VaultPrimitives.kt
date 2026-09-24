package com.fiskindal.fiotp.crypto

import java.security.GeneralSecurityException
import javax.crypto.AEADBadTagException
import javax.crypto.Mac
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal object VaultPrimitives {
    const val MIN_ITERATIONS = 100_000
    const val MAX_ITERATIONS = 5_000_000

    fun checkIterations(iterations: Int) {
        require(iterations in MIN_ITERATIONS..MAX_ITERATIONS) { "Kasa KDF tur sayısı desteklenmiyor." }
    }

    fun derive(password: String, salt: ByteArray, iterations: Int): ByteArray {
        checkIterations(iterations)
        val passwordBytes = password.toByteArray(Charsets.UTF_8)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(passwordBytes, "HmacSHA256"))
        val firstBlock = ByteArray(salt.size + 4)
        salt.copyInto(firstBlock)
        firstBlock[firstBlock.lastIndex - 3] = 0
        firstBlock[firstBlock.lastIndex - 2] = 0
        firstBlock[firstBlock.lastIndex - 1] = 0
        firstBlock[firstBlock.lastIndex] = 1
        var u = mac.doFinal(firstBlock)
        val result = u.copyOf()
        firstBlock.fill(0)
        try {
            repeat(iterations - 1) {
                val next = mac.doFinal(u)
                for (i in result.indices) result[i] = (result[i].toInt() xor next[i].toInt()).toByte()
                u.fill(0)
                u = next
            }
            return result.copyOf()
        } finally {
            passwordBytes.fill(0); u.fill(0); result.fill(0)
        }
    }

    fun encrypt(plaintext: ByteArray, key: ByteArray, nonce: ByteArray): ByteArray {
        require(key.size == 32 && nonce.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return cipher.doFinal(plaintext)
    }

    @Throws(GeneralSecurityException::class, AEADBadTagException::class)
    fun decrypt(ciphertext: ByteArray, tag: ByteArray, key: ByteArray, nonce: ByteArray): ByteArray {
        require(key.size == 32 && nonce.size == 12 && tag.size == 16)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        return cipher.doFinal(ciphertext + tag)
    }
}
