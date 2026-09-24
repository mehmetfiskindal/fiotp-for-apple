package com.fiskindal.fiotp

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.fiskindal.fiotp.crypto.OtpEngine
import com.fiskindal.fiotp.model.Account
import com.fiskindal.fiotp.vault.VaultRepository
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private val FiOtpColors = darkColorScheme(
    primary = Color(0xFF5EEAD4),
    onPrimary = Color(0xFF062A27),
    secondary = Color(0xFF8EB7FF),
    background = Color(0xFF0B1015),
    surface = Color(0xFF151D25),
    surfaceVariant = Color(0xFF202B35),
    onBackground = Color(0xFFE6EDF3),
    onSurface = Color(0xFFE6EDF3),
    onSurfaceVariant = Color(0xFFA5B2BF),
    error = Color(0xFFFF8A80),
)

@Composable
fun FiOtpApp(activity: MainActivity) {
    MaterialTheme(colorScheme = FiOtpColors) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            var selectedVault by remember { mutableStateOf<Uri?>(null) }
            var openPassword by remember { mutableStateOf(false) }
            var backupSource by remember { mutableStateOf<Uri?>(null) }
            var backupPassword by remember { mutableStateOf(false) }
            var showAdd by remember { mutableStateOf(false) }
            var showChangePassword by remember { mutableStateOf(false) }
            var showMigrationQr by remember { mutableStateOf(false) }
            var showScanner by remember { mutableStateOf(false) }
            var scannerPermission by remember { mutableStateOf(false) }

            val vaultPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null) { selectedVault = uri; openPassword = true }
            }
            val backupPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null) { backupSource = uri; backupPassword = true }
            }
            val backupSaver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
                if (uri != null) activity.exportBackup(activity.contentResolver, uri)
            }
            val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                scannerPermission = granted
                if (granted) showScanner = true else activity.showMessage("Kamera izni verilmedi. URI alanına aktarım bağlantısını yapıştırabilirsiniz.")
            }

            if (activity.unlocked) {
                HomeScreen(
                    activity = activity,
                    onAdd = { showAdd = true },
                    onScan = {
                        showAdd = false
                        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            scannerPermission = true; showScanner = true
                        } else permission.launch(Manifest.permission.CAMERA)
                    },
                    onSelectVault = { vaultPicker.launch(arrayOf("application/json", "text/plain", "*/*")) },
                    onImportBackup = { backupPicker.launch(arrayOf("application/json", "text/plain", "*/*")) },
                    onExportBackup = { backupSaver.launch("fiotp-backup.json") },
                    onChangePassword = { showChangePassword = true },
                    onMigrationQr = { showMigrationQr = true },
                    onLock = { activity.lockNow() },
                )
            } else {
                LockScreen(
                    hasVault = activity.vaultExists(), busy = activity.busy, message = activity.message,
                    onCreate = activity::createVault,
                    onOpen = { activity.openVault(it) },
                    onPick = { vaultPicker.launch(arrayOf("application/json", "text/plain", "*/*")) },
                )
            }

            if (showAdd && activity.unlocked) AddAccountDialog(
                onDismiss = { showAdd = false },
                onScan = { showAdd = false; if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { scannerPermission = true; showScanner = true } else permission.launch(Manifest.permission.CAMERA) },
                onAccount = { activity.addAccount(it); showAdd = false },
                onUri = { uri ->
                    try {
                        val accounts = parseAccounts(uri)
                        activity.addAccounts(accounts)
                        showAdd = false
                    } catch (e: Exception) { activity.showMessage(e.message ?: "URI okunamadı.") }
                },
            )

            if (openPassword && selectedVault != null) PasswordDialog(
                title = "Seçilen kasayı aç",
                confirmLabel = "Kasayı aç",
                busy = activity.busy,
                message = activity.message,
                onDismiss = { openPassword = false; selectedVault = null },
                onConfirm = { password -> activity.openVault(password, selectedVault); openPassword = false; selectedVault = null },
            )
            if (backupPassword && backupSource != null) PasswordDialog(
                title = "Şifreli yedeği doğrula",
                confirmLabel = "Yedeği doğrula",
                busy = activity.busy,
                message = activity.message,
                onDismiss = { backupPassword = false; backupSource = null },
                onConfirm = { password -> activity.importBackup(backupSource!!, password); backupPassword = false; backupSource = null },
            )
            activity.backupToRestore?.let { backup -> RestoreBackupDialog(
                busy = activity.busy,
                count = backup.accounts.size,
                onMerge = { activity.restoreBackup(true) },
                onReplace = { activity.restoreBackup(false) },
                onDismiss = activity::cancelBackupRestore,
            ) }
            if (showChangePassword) ChangePasswordDialog(
                busy = activity.busy,
                onDismiss = { showChangePassword = false },
                onConfirm = { activity.changePassword(it); showChangePassword = false },
            )
            if (showMigrationQr) MigrationQrDialog(activity.accounts.toList(), onDismiss = { showMigrationQr = false })
            if (showScanner && scannerPermission) QrScannerDialog(
                onDismiss = { showScanner = false },
                onDetected = { value ->
                    try { activity.addAccounts(parseAccounts(value)); showScanner = false }
                    catch (e: Exception) { activity.showMessage(e.message ?: "QR kod okunamadı.") }
                },
                onCameraError = { activity.showMessage(it); showScanner = false },
            )
        }
    }
}

@Composable
private fun LockScreen(
    hasVault: Boolean,
    busy: Boolean,
    message: String,
    onCreate: (String) -> Unit,
    onOpen: (String) -> Unit,
    onPick: () -> Unit,
) {
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("FiOTP", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(8.dp))
        Text(if (hasVault) "Şifreli kasanızı açın" else "Yeni şifreli kasa oluşturun", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Master parola") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        if (!hasVault) {
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(confirm, { confirm = it }, Modifier.fillMaxWidth(), label = { Text("Parolayı doğrula") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        }
        if (message.isNotBlank()) { Spacer(Modifier.height(12.dp)); Text(message, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
        Spacer(Modifier.height(18.dp))
        Button(
            onClick = {
                when {
                    password.length < 8 -> Unit
                    hasVault -> onOpen(password)
                    password != confirm -> Unit
                    else -> onCreate(password)
                }
            },
            enabled = !busy && password.length >= 8 && (hasVault || password == confirm),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Text(if (hasVault) "Kilidi aç" else "Kasa oluştur")
        }
        if (password.isNotEmpty() && password.length < 8) Text("Master parola en az 8 karakter olmalıdır.", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        else if (!hasVault && confirm.isNotEmpty() && password != confirm) Text("Parolalar eşleşmiyor.", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onPick, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Dosyadan kasa seç") }
        Text("Hesap sırları yalnızca bu cihazdaki şifreli kasada saklanır.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 18.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeScreen(
    activity: MainActivity,
    onAdd: () -> Unit,
    onScan: () -> Unit,
    onSelectVault: () -> Unit,
    onImportBackup: () -> Unit,
    onExportBackup: () -> Unit,
    onChangePassword: () -> Unit,
    onMigrationQr: () -> Unit,
    onLock: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    var query by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("Tümü") }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    var menuOpen by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(500) } }
    val shown = activity.accounts.filter { a ->
        val matchesQuery = query.isBlank() || "${a.issuer} ${a.account} ${a.tags.joinToString()}".contains(query, ignoreCase = true)
        val matchesCategory = when (category) {
            "Favoriler" -> a.favorite
            "İş" -> "is" in a.tags
            "Kişisel" -> "kisisel" in a.tags
            else -> true
        }
        matchesQuery && matchesCategory
    }.sortedWith(compareByDescending<Account> { it.favorite }.thenBy { it.issuer.lowercase() }.thenBy { it.account.lowercase() })

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("FiOTP", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Text("${activity.accounts.size} hesap · çevrimdışı", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Box {
                TextButton(onClick = { menuOpen = true }) { Text("Yönet ▾") }
                androidx.compose.material3.DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Şifreli yedeği dışa aktar") }, onClick = { menuOpen = false; onExportBackup() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Yedekten içe aktar") }, onClick = { menuOpen = false; onImportBackup() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Farklı kasa aç") }, onClick = { menuOpen = false; onSelectVault() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Google Authenticator aktarım QR'ı") }, onClick = { menuOpen = false; onMigrationQr() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Master parolayı değiştir") }, onClick = { menuOpen = false; onChangePassword() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Kasayı kilitle") }, onClick = { menuOpen = false; onLock() })
                }
            }
        }
        if (activity.message.isNotBlank()) Text(activity.message, color = if (activity.message.contains("hata", true) || activity.message.contains("geçersiz", true)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
        OutlinedTextField(query, { query = it; activity.markActive() }, Modifier.fillMaxWidth(), label = { Text("Hesaplarda ara") }, singleLine = true)
        androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 10.dp)) {
            items(listOf("Tümü", "Favoriler", "İş", "Kişisel")) { item -> FilterChip(selected = category == item, onClick = { category = item }, label = { Text(item) }) }
        }
        if (shown.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(if (activity.accounts.isEmpty()) "Henüz hesap yok. Bir URI girin veya QR kodu tarayın." else "Aramanızla eşleşen hesap yok.", color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        } else {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 12.dp)) {
                items(shown, key = { it.id }) { account ->
                    val code = remember(account.secret, account.counter, now / (account.period.coerceAtLeast(1) * 1000L)) { OtpEngine.code(account, now / 1000) }
                    AccountCard(account, code, now,
                        onCopy = {
                            clipboard.setText(AnnotatedString(code))
                            if (account.type == "hotp") activity.incrementCounter(account.id) else activity.showMessage("Kod panoya kopyalandı.")
                            activity.markActive()
                        },
                        onFavorite = { activity.toggleFavorite(account.id) },
                        onTag = { activity.toggleTag(account.id, it) },
                        onDelete = { activity.deleteAccount(account.id) },
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = onScan, modifier = Modifier.weight(1f)) { Text("QR tara") }
            Button(onClick = onAdd, modifier = Modifier.weight(1f)) { Text("＋ Hesap ekle") }
        }
    }
}

@Composable
private fun AccountCard(
    account: Account,
    code: String,
    now: Long,
    onCopy: () -> Unit,
    onFavorite: () -> Unit,
    onTag: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val periodMs = account.period.coerceAtLeast(1) * 1000L
    val progress = if (account.type == "hotp") 1f else 1f - ((now % periodMs).toFloat() / periodMs)
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(account.issuer, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(account.account, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = onFavorite) { Text(if (account.favorite) "★" else "☆", fontSize = 24.sp, color = MaterialTheme.colorScheme.primary) }
                TextButton(onClick = onDelete) { Text("×", fontSize = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            Spacer(Modifier.height(5.dp))
            Text(code.chunked(3).joinToString(" "), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, color = MaterialTheme.colorScheme.primary)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${account.type.uppercase()} · ${account.algorithm}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (account.type == "hotp") "Sayaç ${account.counter}" else "${(periodMs - now % periodMs) / 1000}s", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (account.type == "totp") LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp), color = MaterialTheme.colorScheme.primary)
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onCopy) { Text(if (account.type == "hotp") "Kopyala ve ilerlet" else "Kodu kopyala") }
                Spacer(Modifier.width(8.dp))
                Text(if ("is" in account.tags) "İş" else "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                TextButton(onClick = { onTag("is") }) { Text("İş") }
                TextButton(onClick = { onTag("kisisel") }) { Text("Kişisel") }
            }
        }
    }
}

@Composable
private fun AddAccountDialog(
    onDismiss: () -> Unit,
    onScan: () -> Unit,
    onAccount: (Account) -> Unit,
    onUri: (String) -> Unit,
) {
    var mode by remember { mutableStateOf("Manuel") }
    var issuer by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var algorithm by remember { mutableStateOf("SHA1") }
    var digits by remember { mutableStateOf("6") }
    var period by remember { mutableStateOf("30") }
    var counter by remember { mutableStateOf("0") }
    var type by remember { mutableStateOf("totp") }
    var tags by remember { mutableStateOf(setOf<String>()) }
    var uri by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Hesap ekle") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("Manuel", "URI").forEach { FilterChip(selected = mode == it, onClick = { mode = it }, label = { Text(it) }) }
                }
                if (mode == "URI") {
                    OutlinedTextField(uri, { uri = it }, Modifier.fillMaxWidth(), label = { Text("otpauth:// veya aktarım URI'ı") }, minLines = 3)
                    OutlinedButton(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("Kamerayla QR tara") }
                    Text("otpauth:// tek hesabı, Google Authenticator aktarım URI'ı birden çok hesabı içe alır.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    OutlinedTextField(issuer, { issuer = it }, Modifier.fillMaxWidth(), label = { Text("Hizmet / veren") }, singleLine = true)
                    OutlinedTextField(user, { user = it }, Modifier.fillMaxWidth(), label = { Text("Hesap adı") }, singleLine = true)
                    OutlinedTextField(secret, { secret = it.uppercase() }, Modifier.fillMaxWidth(), label = { Text("Base32 secret") }, singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("totp", "hotp").forEach { FilterChip(selected = type == it, onClick = { type = it }, label = { Text(it.uppercase()) }) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("SHA1", "SHA256", "SHA512").forEach { FilterChip(selected = algorithm == it, onClick = { algorithm = it }, label = { Text(it) }) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(digits, { digits = it.filter(Char::isDigit).take(1) }, Modifier.weight(1f), label = { Text("Hane (6–8)") }, singleLine = true)
                        if (type == "totp") OutlinedTextField(period, { period = it.filter(Char::isDigit).take(5) }, Modifier.weight(1f), label = { Text("Süre (sn)") }, singleLine = true)
                        else OutlinedTextField(counter, { counter = it.filter(Char::isDigit).take(12) }, Modifier.weight(1f), label = { Text("Sayaç") }, singleLine = true)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = "is" in tags, onCheckedChange = { tags = if (it) tags + "is" else tags - "is" }); Text("İş")
                        Checkbox(checked = "kisisel" in tags, onCheckedChange = { tags = if (it) tags + "kisisel" else tags - "kisisel" }); Text("Kişisel")
                    }
                }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                try {
                    if (mode == "URI") onUri(uri.trim())
                    else {
                        OtpEngine.base32Decode(secret)
                        require(issuer.isNotBlank() && user.isNotBlank()) { "Hizmet ve hesap alanları gereklidir." }
                        val d = digits.toIntOrNull() ?: 6; require(d in 6..8) { "Kod uzunluğu 6–8 olmalıdır." }
                        val p = period.toIntOrNull() ?: 30; val c = counter.toLongOrNull() ?: 0L
                        require(p > 0 && c >= 0) { "Süre veya sayaç geçersiz." }
                        onAccount(Account(UUID.randomUUID().toString(), issuer.trim(), user.trim(), secret.trim(), algorithm, d, p, type, c, false, tags.toList()))
                    }
                } catch (e: Exception) { error = e.message ?: "Bilgiler geçersiz." }
            }) { Text("Ekle") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("İptal") } },
    )
}

@Composable
private fun PasswordDialog(title: String, confirmLabel: String, busy: Boolean, message: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var password by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(password, { password = it }, label = { Text("Master parola") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
            if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(enabled = !busy && password.length >= 8, onClick = { onConfirm(password) }) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("İptal") } })
}

@Composable
private fun RestoreBackupDialog(busy: Boolean, count: Int, onMerge: () -> Unit, onReplace: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Yedek geri yüklensin mi?") },
        text = { Text("Yedekte $count hesap var. Hesapları mevcut kasaya birleştirebilir veya mevcut kasayı yedekle değiştirebilirsiniz.") },
        confirmButton = { TextButton(enabled = !busy, onClick = onMerge) { Text("Birleştir") } },
        dismissButton = { Row {
            TextButton(enabled = !busy, onClick = onReplace) { Text("Değiştir") }
            TextButton(onClick = onDismiss) { Text("İptal") }
        } })
}

@Composable
private fun ChangePasswordDialog(busy: Boolean, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var first by remember { mutableStateOf("") }; var second by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Master parolayı değiştir") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(first, { first = it }, label = { Text("Yeni parola") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
            OutlinedTextField(second, { second = it }, label = { Text("Yeni parola tekrar") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
            if (first.isNotEmpty() && first.length < 8) Text("En az 8 karakter olmalıdır.", color = MaterialTheme.colorScheme.error)
            else if (second.isNotEmpty() && first != second) Text("Parolalar eşleşmiyor.", color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(enabled = !busy && first.length >= 8 && first == second, onClick = { onConfirm(first) }) { Text("Değiştir") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("İptal") } })
}

@Composable
private fun MigrationQrDialog(accounts: List<Account>, onDismiss: () -> Unit) {
    val uri = remember(accounts) { runCatching { OtpEngine.migrationUri(accounts) }.getOrDefault("") }
    val qr = remember(uri) {
        if (uri.isBlank()) null else runCatching {
            val matrix = QRCodeWriter().encode(uri, BarcodeFormat.QR_CODE, 520, 520)
            Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).apply {
                for (x in 0 until matrix.width) for (y in 0 until matrix.height) setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }.getOrNull()
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Google Authenticator aktarımı") },
        text = { Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (qr != null) Image(qr.asImageBitmap(), contentDescription = "Hesap aktarım QR kodu", modifier = Modifier.size(250.dp))
            else Text("QR kod oluşturulamadı.", color = MaterialTheme.colorScheme.error)
            Text("${accounts.size} hesap tek kullanımlık aktarım QR koduna eklendi. Bu QR, hesap sırlarını içerir; güvenli tutun.", style = MaterialTheme.typography.bodySmall)
        } }, confirmButton = { TextButton(onClick = onDismiss) { Text("Kapat") } })
}

@Composable
private fun QrScannerDialog(onDismiss: () -> Unit, onDetected: (String) -> Unit, onCameraError: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember(context) { PreviewView(context) }
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    val scanner = remember { BarcodeScanning.getClient(com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    val delivered = remember { AtomicBoolean(false) }
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(Modifier.fillMaxSize(), shape = RoundedCornerShape(18.dp), color = Color.Black) {
            Box(Modifier.fillMaxSize()) {
                AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                Column(Modifier.align(Alignment.TopCenter).padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("QR kodu kameraya gösterin", color = Color.White, fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = onDismiss) { Text("İptal", color = Color.White) }
                }
            }
        }
    }
    DisposableEffect(cameraProviderFuture, lifecycleOwner) {
        val executor = Executors.newSingleThreadExecutor()
        var bound: ProcessCameraProvider? = null
        cameraProviderFuture.addListener({
            val setup = runCatching {
                val provider = cameraProviderFuture.get(); bound = provider
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(executor) { proxy ->
                    val media = proxy.image
                    if (media == null) { proxy.close(); return@setAnalyzer }
                    scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { barcodes ->
                            val value = barcodes.firstNotNullOfOrNull { it.rawValue }
                            if (value != null && delivered.compareAndSet(false, true)) onDetected(value)
                        }
                        .addOnCompleteListener { proxy.close() }
                }
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
            setup.exceptionOrNull()?.let { onCameraError(it.message ?: "Kamera açılamadı.") }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            runCatching { bound?.unbindAll() }
            scanner.close()
            executor.shutdown()
        }
    }
}

private fun parseAccounts(value: String): List<Account> {
    val parsed = if (value.trim().startsWith("otpauth-migration://", true)) OtpEngine.parseMigration(value) else listOf(OtpEngine.parseOtpAuth(value))
    require(parsed.isNotEmpty()) { "URI hesap içermiyor." }
    return parsed.map { Account(UUID.randomUUID().toString(), it.issuer, it.account, it.secret, it.algorithm, it.digits, it.period, it.type, it.counter) }
}
