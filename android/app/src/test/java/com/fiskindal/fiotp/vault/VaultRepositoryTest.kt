package com.fiskindal.fiotp.vault

import com.fiskindal.fiotp.crypto.Base64Codec
import com.fiskindal.fiotp.model.Account
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultRepositoryTest {
    @Test fun malformedCurrentVaultRecoversPreviousEncryptedBak() {
        val root = Files.createTempDirectory("fiotp-vault-test").toFile()
        try {
            val writer = VaultRepository(root)
            writer.create("correct horse battery")
            val first = Account("one", "Example", "alice", "JBSWY3DPEHPK3PXP", createdAt = 1)
            val second = Account("two", "Example", "bob", "MFRGGZDFMZTWQ2LK", createdAt = 2)
            writer.save(listOf(first))
            writer.save(listOf(first, second))
            File(root, "vault.json").writeText("not a valid envelope")

            val recovered = VaultRepository(root).open("correct horse battery")
            assertTrue(recovered.recoveredFromBackup)
            assertEquals(listOf("alice"), recovered.accounts.map { it.account })
            assertTrue(File(root, "vault.json.bak").isFile)
        } finally { root.deleteRecursively() }
    }

    @Test fun wrongPasswordDoesNotUnlockVault() {
        val root = Files.createTempDirectory("fiotp-vault-password").toFile()
        try {
            VaultRepository(root).create("correct horse battery")
            val failure = runCatching { VaultRepository(root).open("incorrect password") }.exceptionOrNull()
            assertTrue(failure != null)
            assertTrue(failure!!.message.orEmpty().contains("Parola hatalı"))
        } finally { root.deleteRecursively() }
    }
    @Test fun appleEnvelopeJsonFieldsUnlockAndPreserveExistingKdfOnSave() {
        val root = Files.createTempDirectory("fiotp-vault-interop").toFile()
        val password = "correct horse battery"
        val salt = ByteArray(16) { it.toByte() }
        val material = VaultCrypto.KeyMaterial(salt, 100_000, VaultCrypto.derive(password, salt, 100_000))
        try {
            val envelope = VaultCrypto.encrypt("{\"schema\":1,\"accounts\":[]} ".trim().toByteArray(), material)
                .put("salt", Base64Codec.encode(salt)).put("iterations", 100_000)
            File(root, "vault.json").writeText(envelope.toString())
            val repository = VaultRepository(root)
            repository.open(password)
            val account = Account("one", "Example", "alice", "JBSWY3DPEHPK3PXP")
            repository.save(listOf(account))
            val saved = JSONObject(File(root, "vault.json").readText())
            assertEquals(100_000, saved.getInt("iterations"))
            assertEquals(Base64Codec.encode(salt), saved.getString("salt"))
            repository.lock()
        } finally { material.clear(); root.deleteRecursively() }
    }

    @Test fun unsupportedKdfEnvelopeIsRejectedBeforeDerivation() {
        val salt = ByteArray(16) { it.toByte() }
        val envelope = JSONObject().put("version", 1).put("cipher", "AES-256-GCM")
            .put("kdf", "PBKDF2-HMAC-SHA256").put("iterations", 99_999)
            .put("salt", Base64Codec.encode(salt)).put("nonce", Base64Codec.encode(ByteArray(12)))
            .put("ciphertext", "").put("tag", Base64Codec.encode(ByteArray(16)))
        assertTrue(runCatching { VaultCrypto.unlock(envelope, "correct horse battery") }.isFailure)
    }

}
