package com.fiskindal.fiotp.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultKeyDerivationTest {
    private val salt = ByteArray(16) { it.toByte() }
    private val nonce = ByteArray(12) { it.toByte() }
    private val plaintext = "{\"schema\":1,\"accounts\":[]}".toByteArray()
    private val keyHex = "bb06c8c0b1dd5bfd4e40f4e297a2d0e64da7ef94b4b8ec20989021c8b41536ad"
    private val expectedCiphertext = "Uey4LovVhkH0r/3jb1jll1U5bm4XUj55o7s="
    private val expectedTag = "S4SdjH1EZaEukuykAE1InQ=="

    @Test fun appleEnvelopePbkdfAndGcmFixtureRoundTrips() {
        val key = VaultPrimitives.derive("correct horse battery", salt, 600_000)
        assertEquals(keyHex, key.joinToString("") { "%02x".format(it.toInt() and 255) })
        val sealed = VaultPrimitives.encrypt(plaintext, key, nonce)
        val ciphertext = sealed.copyOfRange(0, sealed.size - 16)
        val tag = sealed.copyOfRange(sealed.size - 16, sealed.size)
        assertEquals(expectedCiphertext, Base64Codec.encode(ciphertext))
        assertEquals(expectedTag, Base64Codec.encode(tag))
        assertArrayEquals(plaintext, VaultPrimitives.decrypt(ciphertext, tag, key, nonce))
        key.fill(0); sealed.fill(0); ciphertext.fill(0); tag.fill(0)
    }

    @Test fun wrongPasswordAndModifiedCiphertextOrTagAreRejected() {
        val key = VaultPrimitives.derive("correct horse battery", salt, 600_000)
        val sealed = VaultPrimitives.encrypt(plaintext, key, nonce)
        val ciphertext = sealed.copyOfRange(0, sealed.size - 16)
        val tag = sealed.copyOfRange(sealed.size - 16, sealed.size)
        val wrongKey = VaultPrimitives.derive("wrong password", salt, 600_000)
        assertThrows(Exception::class.java) { VaultPrimitives.decrypt(ciphertext, tag, wrongKey, nonce) }
        val alteredCiphertext = ciphertext.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) { VaultPrimitives.decrypt(alteredCiphertext, tag, key, nonce) }
        val alteredTag = tag.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) { VaultPrimitives.decrypt(ciphertext, alteredTag, key, nonce) }
        key.fill(0); wrongKey.fill(0); sealed.fill(0); ciphertext.fill(0); tag.fill(0)
    }

    @Test fun kdfIterationBoundsRejectUnsupportedFiles() {
        VaultPrimitives.checkIterations(100_000)
        VaultPrimitives.checkIterations(5_000_000)
        assertThrows(IllegalArgumentException::class.java) { VaultPrimitives.checkIterations(99_999) }
        assertThrows(IllegalArgumentException::class.java) { VaultPrimitives.checkIterations(5_000_001) }
    }
}
