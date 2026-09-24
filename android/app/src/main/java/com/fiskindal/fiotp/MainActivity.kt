package com.fiskindal.fiotp

import android.content.ContentResolver
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.fiskindal.fiotp.model.Account
import com.fiskindal.fiotp.vault.VaultRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class MainActivity : ComponentActivity() {
    private lateinit var repository: VaultRepository
    val accounts = androidx.compose.runtime.mutableStateListOf<Account>()
    var hasVault by androidx.compose.runtime.mutableStateOf(false); private set
    var unlocked by androidx.compose.runtime.mutableStateOf(false); private set
    var busy by androidx.compose.runtime.mutableStateOf(false); private set
    var message by androidx.compose.runtime.mutableStateOf(""); private set
    var recovered by androidx.compose.runtime.mutableStateOf(false); private set
    var backupToRestore by androidx.compose.runtime.mutableStateOf<VaultRepository.Backup?>(null); private set

    private val handler = Handler(Looper.getMainLooper())
    private var lastActiveAt = 0L
    private var lastBackgroundAt = 0L
    private val lockAfterMs = 5 * 60 * 1000L
    private val autoLock = Runnable { if (unlocked && SystemClock.elapsedRealtime() - lastActiveAt >= lockAfterMs) lockNow() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = VaultRepository(File(filesDir, "fiotp"))
        hasVault = repository.exists
        setContent { FiOtpApp(this) }
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        markActive()
    }

    override fun onStop() {
        if (unlocked) {
            lastBackgroundAt = SystemClock.elapsedRealtime()
            scheduleLock((lockAfterMs - (lastBackgroundAt - lastActiveAt)).coerceAtLeast(0))
        }
        super.onStop()
    }

    override fun onStart() {
        super.onStart()
        if (unlocked) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastActiveAt >= lockAfterMs) lockNow()
            else scheduleLock((lockAfterMs - (now - lastActiveAt)).coerceAtLeast(0))
            lastBackgroundAt = 0
        }
    }

    private fun scheduleLock(delay: Long) {
        handler.removeCallbacks(autoLock)
        handler.postDelayed(autoLock, delay.coerceAtLeast(0))
    }

    fun showMessage(value: String) { message = value }

    fun markActive() {
        if (unlocked) {
            lastActiveAt = SystemClock.elapsedRealtime()
            scheduleLock(lockAfterMs)
        }
    }

    fun createVault(password: String) {
        work {
            val created = withContext(Dispatchers.IO) { repository.create(password) }
            replaceAccounts(created)
            hasVault = true; unlocked = true; recovered = false
            lastActiveAt = SystemClock.elapsedRealtime(); scheduleLock(lockAfterMs)
            message = "Yeni şifreli kasa oluşturuldu."
        }
    }

    fun openVault(password: String, selected: Uri? = null) {
        work {
            val result = withContext(Dispatchers.IO) { repository.open(password, contentResolver, selected) }
            replaceAccounts(result.accounts)
            hasVault = true; unlocked = true; recovered = result.recoveredFromBackup
            lastActiveAt = SystemClock.elapsedRealtime(); scheduleLock(lockAfterMs)
            message = if (result.recoveredFromBackup) "Kasa .bak dosyasından kurtarıldı." else "Kasa açıldı."
        }
    }

    fun importBackup(uri: Uri, password: String) {
        work {
            backupToRestore = withContext(Dispatchers.IO) { repository.readBackup(contentResolver, uri, password) }
            message = "Yedek doğrulandı. Birleştirme veya değiştirme seçin."
        }
    }

    fun restoreBackup(merge: Boolean) {
        val backup = backupToRestore ?: return
        work {
            val result = withContext(Dispatchers.IO) { repository.writeImportedBackup(backup, merge, accounts.toList()) }
            replaceAccounts(result); backupToRestore = null
            message = if (merge) "Yedek hesapları birleştirildi." else "Kasa yedekten geri yüklendi."
        }
    }

    fun cancelBackupRestore() {
        backupToRestore?.accounts?.forEach { it.secret = "" }
        backupToRestore = null
    }

    fun exportBackup(resolver: ContentResolver, uri: Uri) {
        work {
            withContext(Dispatchers.IO) { repository.exportEncrypted(resolver, uri) }
            message = "Şifreli yedek dışa aktarıldı."
        }
    }

    fun changePassword(password: String) {
        work {
            withContext(Dispatchers.IO) { repository.changePassword(accounts.toList(), password) }
            message = "Master parola değiştirildi."
        }
    }

    fun addAccount(account: Account) {
        val value = account.copy(id = UUID.randomUUID().toString(), tags = account.tags.toList())
        val updated = listOf(value) + accounts
        persist(updated)
        message = "${value.issuer} hesabı eklendi."
    }

    fun addAccounts(newAccounts: List<Account>) {
        val known = accounts.map { "${it.issuer.lowercase()}|${it.account.lowercase()}|${it.secret}" }.toMutableSet()
        val additions = newAccounts.filter { known.add("${it.issuer.lowercase()}|${it.account.lowercase()}|${it.secret}") }
            .map { it.copy(id = UUID.randomUUID().toString()) }
        if (additions.isEmpty()) { message = "Yeni ve yinelenmeyen hesap bulunamadı."; return }
        persist(additions + accounts)
        message = "${additions.size} hesap aktarıldı."
    }

    fun toggleFavorite(id: String) = update(id) { it.copy(favorite = !it.favorite) }
    fun toggleTag(id: String, tag: String) = update(id) {
        val tags = if (tag in it.tags) it.tags - tag else it.tags + tag
        it.copy(tags = tags)
    }
    fun deleteAccount(id: String) {
        persist(accounts.filterNot { it.id == id })
    }
    fun incrementCounter(id: String) = update(id) { it.copy(counter = it.counter + 1) }

    private fun update(id: String, transform: (Account) -> Account) {
        persist(accounts.map { if (it.id == id) transform(it) else it })
    }

    private fun persist(values: List<Account>) {
        try {
            repository.save(values)
            wipeReplacedAccounts(values)
            accounts.clear(); accounts.addAll(values)
        } catch (e: Exception) { message = e.message ?: "Kasa kaydedilemedi." }
    }

    private fun replaceAccounts(values: List<Account>) {
        wipeReplacedAccounts(values)
        accounts.clear(); accounts.addAll(values)
    }

    private fun wipeReplacedAccounts(retained: List<Account>) {
        val keep = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<Account, Boolean>())
        keep.addAll(retained)
        accounts.forEach { if (!keep.contains(it)) it.secret = "" }
    }

    fun lockNow() {
        handler.removeCallbacks(autoLock)
        repository.lock()
        accounts.forEach { it.secret = "" }
        accounts.clear()
        backupToRestore?.accounts?.forEach { it.secret = "" }
        backupToRestore = null
        unlocked = false; recovered = false; lastActiveAt = 0; lastBackgroundAt = 0
        message = "Kasa kilitlendi."
    }

    private fun work(block: suspend () -> Unit) {
        if (busy) return
        busy = true; message = ""
        lifecycleScope.launch {
            try { block() }
            catch (e: Exception) { message = e.message ?: "İşlem tamamlanamadı." }
            finally { busy = false }
        }
    }

    fun vaultExists() = hasVault
}
