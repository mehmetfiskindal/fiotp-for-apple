package com.fiskindal.fiotp.vault

import android.content.ContentResolver
import android.net.Uri
import com.fiskindal.fiotp.crypto.Base64Codec
import com.fiskindal.fiotp.model.Account
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class VaultRepository(private val root: File) {
    data class Opened(val accounts: List<Account>, val recoveredFromBackup: Boolean, val sourcePath: String)
    data class Backup(val accounts: List<Account>)

    private val vaultFile = File(root, "vault.json")
    private var material: VaultCrypto.KeyMaterial? = null
    val exists get() = vaultFile.isFile
    val path get() = vaultFile.absolutePath

    fun create(password: String): List<Account> {
        check(password.length >= 8) { "Master parola en az 8 karakter olmalıdır." }
        check(!vaultFile.exists()) { "Bu cihazda zaten bir kasa var." }
        val (next, envelope) = VaultCrypto.create(password)
        try { atomicWrite(vaultFile, envelope.toString().toByteArray(Charsets.UTF_8), false) }
        catch (e: Exception) { next.clear(); throw e }
        material?.clear(); material = next
        return emptyList()
    }

    fun open(password: String, resolver: ContentResolver? = null, selected: Uri? = null): Opened {
        if (selected != null) {
            val bytes = resolver?.openInputStream(selected)?.use { readAll(it) }
                ?: throw IllegalArgumentException("Seçilen kasa dosyası okunamadı.")
            val imported = File(root, "imported-vault.json")
            val staleBackup = File(imported.path + ".bak")
            if (staleBackup.exists() && !staleBackup.delete()) {
                bytes.fill(0); error("Önceki içe aktarma dosyası temizlenemedi.")
            }
            try { atomicWrite(imported, bytes, false) }
            catch (e: Exception) { bytes.fill(0); throw e }
            val result = try { decryptFile(imported, password) }
                catch (e: Exception) { bytes.fill(0); throw e }
            val importedAccounts = try {
                validatePayload(result.second)
                accounts(result.second)
            } catch (e: Exception) { result.first.clear(); bytes.fill(0); throw e }
            try { atomicWrite(vaultFile, bytes, vaultFile.exists()) }
            catch (e: Exception) { result.first.clear(); bytes.fill(0); throw e }
            bytes.fill(0)
            material?.clear(); material = result.first
            return Opened(importedAccounts, false, vaultFile.absolutePath)
        }
        check(vaultFile.isFile) { "Kasa dosyası bulunamadı." }
        return openFile(vaultFile, password, true)
    }

    private fun openFile(file: File, password: String, keep: Boolean): Opened {
        try {
            val result = decryptFile(file, password)
            val unlockedAccounts = try {
                validatePayload(result.second)
                accounts(result.second)
            } catch (e: Exception) { result.first.clear(); throw e }
            if (keep) { material?.clear(); material = result.first }
            else result.first.clear()
            return Opened(unlockedAccounts, false, file.absolutePath)
        } catch (primary: Exception) {
            val backup = File(file.path + ".bak")
            if (!backup.isFile) throw primary
            val result = try { decryptFile(backup, password) } catch (_: Exception) { throw primary }
            val unlockedAccounts = try {
                validatePayload(result.second)
                accounts(result.second)
            } catch (e: Exception) { result.first.clear(); throw e }
            if (keep) {
                try { atomicWrite(file, backup.readBytes(), false) }
                catch (e: Exception) { result.first.clear(); throw e }
                material?.clear(); material = result.first
            } else result.first.clear()
            return Opened(unlockedAccounts, true, file.absolutePath)
        }
    }

    fun save(accounts: List<Account>) {
        val active = material ?: error("Kasa kilitli.")
        val old = JSONObject(vaultFile.readText(Charsets.UTF_8))
        val payload = serialize(accounts).toByteArray(Charsets.UTF_8)
        try {
            val fresh = VaultCrypto.encrypt(payload, active)
            // Existing Apple vaults keep their salt and KDF iteration count on save.
            fresh.put("salt", old.getString("salt"))
                .put("iterations", old.getInt("iterations"))
            atomicWrite(vaultFile, fresh.toString().toByteArray(Charsets.UTF_8), true)
        } finally { payload.fill(0) }
    }

    fun changePassword(accounts: List<Account>, newPassword: String) {
        check(newPassword.length >= 8) { "Master parola en az 8 karakter olmalıdır." }
        val salt = ByteArray(16).also(java.security.SecureRandom()::nextBytes)
        val next = VaultCrypto.KeyMaterial(salt, VaultCrypto.DEFAULT_ITERATIONS,
            VaultCrypto.derive(newPassword, salt, VaultCrypto.DEFAULT_ITERATIONS))
        val payload = serialize(accounts).toByteArray(Charsets.UTF_8)
        var saved = false
        try {
            val encrypted = VaultCrypto.encrypt(payload, next)
            encrypted.put("salt", Base64Codec.encode(salt))
            atomicWrite(vaultFile, encrypted.toString().toByteArray(Charsets.UTF_8), true)
            material?.clear(); material = next; saved = true
        } finally {
            payload.fill(0)
            if (!saved) next.clear()
        }
    }

    fun exportEncrypted(resolver: ContentResolver, destination: Uri) {
        check(material != null) { "Kasa kilitli." }
        resolver.openOutputStream(destination, "wt")?.use { out -> FileInputStream(vaultFile).use { it.copyTo(out) } }
            ?: error("Yedek dosyası oluşturulamadı.")
    }

    fun readBackup(resolver: ContentResolver, source: Uri, password: String): Backup {
        val bytes = resolver.openInputStream(source)?.use { readAll(it) }
            ?: throw IllegalArgumentException("Yedek dosyası okunamadı.")
        val (key, plaintext) = VaultCrypto.unlock(JSONObject(String(bytes, Charsets.UTF_8)), password)
        key.clear()
        return try {
            validatePayload(String(plaintext, Charsets.UTF_8))
            Backup(accounts(String(plaintext, Charsets.UTF_8)))
        } finally { plaintext.fill(0); bytes.fill(0) }
    }

    fun writeImportedBackup(backup: Backup, merge: Boolean, current: List<Account>): List<Account> {
        val result = if (!merge) backup.accounts else {
            val existing = current.toMutableList()
            val identities = existing.map { identity(it) }.toMutableSet()
            backup.accounts.forEach { if (identities.add(identity(it))) existing.add(it.copy(id = java.util.UUID.randomUUID().toString())) }
            existing
        }
        save(result)
        return result
    }

    fun lock() { material?.clear(); material = null }
    fun hasActiveKey() = material != null
    fun encryptedBytes(): ByteArray = vaultFile.readBytes()

    private fun decryptFile(file: File, password: String): Pair<VaultCrypto.KeyMaterial, String> {
        val bytes = file.readBytes()
        try {
            val (key, plaintext) = VaultCrypto.unlock(JSONObject(String(bytes, Charsets.UTF_8)), password)
            return key to String(plaintext, Charsets.UTF_8).also { plaintext.fill(0) }
        } finally { bytes.fill(0) }
    }

    private fun serialize(accounts: List<Account>) = JSONObject().put("schema", 1).put("accounts", JSONArray().apply {
        accounts.forEach { a ->
            put(JSONObject().put("id", a.id).put("issuer", a.issuer).put("account", a.account)
                .put("secret", a.secret).put("algorithm", a.algorithm).put("digits", a.digits)
                .put("period", a.period).put("type", a.type).put("counter", a.counter)
                .put("favorite", a.favorite).put("tags", JSONArray(a.tags)).put("createdAt", a.createdAt))
        }
    }).toString()

    private fun validatePayload(text: String) {
        val json = JSONObject(text)
        require(json.optInt("schema") == 1 && json.optJSONArray("accounts") != null) { "FiOTP kasa içeriği geçersiz." }
    }

    private fun accounts(text: String): List<Account> {
        val arr = JSONObject(text).getJSONArray("accounts")
        val ids = mutableSetOf<String>()
        return (0 until arr.length()).map { i ->
            val a = arr.getJSONObject(i)
            val tags = a.optJSONArray("tags")?.let { t -> (0 until t.length()).map { t.getString(it) } } ?: emptyList()
            val account = Account(a.getString("id"), a.getString("issuer"), a.getString("account"), a.getString("secret"),
                a.optString("algorithm", "SHA1"), a.optInt("digits", 6), a.optInt("period", 30), a.optString("type", "totp"),
                a.optLong("counter", 0), a.optBoolean("favorite", false), tags, a.optLong("createdAt", 0))
            require(account.id.isNotBlank() && ids.add(account.id) && account.secret.isNotBlank() &&
                account.type in setOf("totp", "hotp") && account.digits in 6..8 && account.period > 0) { "Kasada geçersiz hesap kaydı var." }
            account
        }
    }

    private fun identity(a: Account) = "${a.issuer.lowercase()}|${a.account.lowercase()}|${a.secret}"

    private fun atomicWrite(file: File, bytes: ByteArray, keepBackup: Boolean) {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        FileOutputStream(tmp).use { it.write(bytes); it.fd.sync() }
        val backup = File(file.path + ".bak")
        if (keepBackup && file.exists()) {
            if (backup.exists() && !backup.delete()) { tmp.delete(); error("Eski yedek temizlenemedi.") }
            if (!file.copyTo(backup, overwrite = true).exists()) { tmp.delete(); error("Kasa yedeği oluşturulamadı.") }
        }
        if (file.exists() && !file.delete()) { tmp.delete(); error("Eski kasa dosyası değiştirilemedi.") }
        if (!tmp.renameTo(file)) {
            if (backup.exists()) backup.copyTo(file, overwrite = true)
            tmp.delete()
            error("Yeni kasa dosyası kaydedilemedi.")
        }
    }

    private fun readAll(input: java.io.InputStream): ByteArray {
        val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (true) { val n = input.read(buffer); if (n < 0) break; output.write(buffer, 0, n) }
        buffer.fill(0); return output.toByteArray()
    }
}
