import { ReactiveComponent, type InputEvent, type KeyEvent } from '@geastack/core'
import {
  generateTotp,
  generateHotp,
  verifyTotp,
  base32Decode,
  parseOtpAuthUri,
  buildOtpAuthUri,
  parseMigrationUri,
  formatCode,
  type OtpAlgorithm,
  type OtpType,
} from './crypto/totp'
import type { Account } from './types'
import { vaultService } from './services/VaultService'
import { vaultStore } from './stores/VaultStore'
import { MacHost } from './platform/macHost'
import './styles.css'

function safeCopy(text: string): void {
  MacHost.copy(text)
}

const AUTO_LOCK_MS = 5 * 60 * 1000 // 5 minutes inactivity

export class App extends ReactiveComponent {
  unlockInput = ''
  unlockConfirmInput = ''
  unlockError = ''
  creatingVault = false
  copiedId = ''
  // epochSeconds stores floor(Date.now()/1000).
  // Updated via requestAnimationFrame which runs in the native frame loop
  // and correctly triggers reactive re-renders — setInterval callbacks do not.
  // Used directly in TOTP math so the compiler cannot optimize the read away.
  epochSeconds = 0
  lastActivityTime = 0

  // Modals & Dialogs
  showAddModal = false
  showSettingsModal = false
  showQrModal = false
  selectedQrUri = ''
  selectedQrIssuer = ''
  verifyAccountId = ''
  verifyInput = ''
  verifyResult = ''
  activeMenuAccountId = ''
  toastMessage = ''

  // Add Account Form State
  addTab: 'manual' | 'uri' = 'manual'
  newType: OtpType = 'totp'
  newIssuer = ''
  newAccount = ''
  newSecret = ''
  newAlgorithm: OtpAlgorithm = 'SHA1'
  newDigits = 6
  newPeriod = '30'
  newCounter = '0'
  newTag: 'is' | 'kisisel' = 'kisisel'
  uriInput = ''
  addError = ''

  // Settings State
  currentPass = ''
  nextPass = ''
  confirmPass = ''
  importJsonInput = ''
  settingsMessage = ''
  settingsError = ''

  private initialized = false
  private toastTimerId: any = null
  private copyTimerId: any = null

  init() {
    if (this.initialized) return
    this.initialized = true
    this.lastActivityTime = Date.now()
    this.epochSeconds = Math.floor(Date.now() / 1000)
    this.loadState()
    this.startRafLoop()
  }

  startRafLoop() {
    const loop = () => {
      const s = Math.floor(Date.now() / 1000)
      if (s !== this.epochSeconds) {
        this.epochSeconds = s
        vaultStore.tick(s)
        // Auto-lock check on each second boundary
        if (
          vaultStore.unlocked &&
          vaultStore.hasVault &&
          Date.now() - this.lastActivityTime > AUTO_LOCK_MS
        ) {
          this.lockVault()
        }
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  recordActivity() {
    this.lastActivityTime = Date.now()
  }

  refreshAccounts() {
    vaultStore.refresh()
  }

  rebuildAccountView() {
    // Counts and filtering are derived by VaultStore getters.
  }

  clearAccountView() {
    vaultStore.accounts = []
  }

  loadState() {
    try {
      vaultStore.loadStatus()
      this.creatingVault = false
    } catch (e) {
      this.unlockError = (e as Error).message
    }
  }

  showToast(msg: string) {
    this.toastMessage = msg
    if (this.toastTimerId) clearTimeout(this.toastTimerId)
    this.toastTimerId = setTimeout(() => {
      this.toastMessage = ''
    }, 2500)
  }

  copyCode(code: string, id: string) {
    this.recordActivity()
    const raw = code.replace(/\s/g, '')
    safeCopy(raw)
    this.copiedId = id
    if (this.copyTimerId) clearTimeout(this.copyTimerId)
    this.copyTimerId = setTimeout(() => {
      this.copiedId = ''
    }, 1500)
    this.showToast(`Kod panoya kopyalandı (${raw})`)
  }

  incrementHotp(id: string) {
    this.recordActivity()
    const accounts = vaultStore.accounts.map((a) => {
      if (a.id === id) {
        const next = (a.counter ?? 0) + 1
        return { ...a, counter: next }
      }
      return a
    })
    const changed = accounts.find((a) => a.id === id)
    if (changed) vaultService.updateAccount(id, { counter: changed.counter })
    vaultStore.refresh()
    this.showToast('HOTP sayacı artırıldı, yeni kod üretildi')
  }

  toggleFavorite(id: string) {
    this.recordActivity()
    const accounts = vaultStore.accounts.map((a) =>
      a.id === id ? { ...a, favorite: !a.favorite } : a
    )
    const changed = accounts.find((a) => a.id === id)
    if (changed) vaultService.updateAccount(id, { favorite: changed.favorite })
    vaultStore.refresh()
    this.activeMenuAccountId = ''
  }

  setTag(id: string, tag: 'is' | 'kisisel') {
    this.recordActivity()
    const accounts = vaultStore.accounts.map((a) =>
      a.id === id ? { ...a, tags: a.tags.includes(tag) ? [] : [tag] } : a
    )
    const changed = accounts.find((a) => a.id === id)
    if (changed) vaultService.updateAccount(id, { tags: changed.tags })
    vaultStore.refresh()
    this.activeMenuAccountId = ''
  }

  deleteAccount(id: string) {
    this.recordActivity()
    vaultService.removeAccount(id)
    this.refreshAccounts()
    this.activeMenuAccountId = ''
    this.showToast('Hesap silindi')
  }

  lockVault() {
    vaultStore.lock()
    this.unlockInput = ''
    this.unlockConfirmInput = ''
    this.unlockError = ''
    this.creatingVault = false
  }

  unlockVault() {
    this.recordActivity()
    try {
      if (!vaultStore.hasVault || this.creatingVault) {
        throw new Error('Önce mevcut bir kasa seçin.')
      }
      vaultStore.open(this.unlockInput, vaultStore.vaultPath)
      this.unlockInput = ''
      this.unlockError = ''
      this.showToast(vaultStore.totalCount ? 'Kasa kilidi açıldı' : 'Güvenli boş kasa hazır')
    } catch (e) {
      this.unlockError = `${(e as Error).message} Aktif kasa: ${vaultStore.vaultPath}`
    }
  }

  createVault() {
    this.recordActivity()
    try {
      if (!this.creatingVault) throw new Error('Önce yeni kasa konumunu seçin.')
      if (this.unlockInput !== this.unlockConfirmInput) {
        throw new Error('Parolalar eşleşmiyor.')
      }
      vaultStore.create(this.unlockInput, vaultStore.vaultPath)
      this.creatingVault = false
      this.unlockInput = ''
      this.unlockConfirmInput = ''
      this.unlockError = ''
      this.showToast('Güvenli boş kasa oluşturuldu')
    } catch (e) {
      this.unlockError = `${(e as Error).message} Aktif kasa: ${vaultStore.vaultPath}`
    }
  }

  chooseVault(openExisting: boolean) {
    try {
      const status = vaultService.chooseVault(openExisting)
      vaultStore.select(status)
      this.creatingVault = !openExisting
      this.unlockInput = ''
      this.unlockConfirmInput = ''
      this.unlockError = ''
    } catch (e) {
      if (!(e as Error).message.includes('iptal')) this.unlockError = (e as Error).message
    }
  }

  scanQr() {
    try {
      const envelope = JSON.parse(MacHost.invoke('qr.scanCamera')) as {
        ok: boolean
        data: { value: string }
      }
      this.uriInput = envelope.data.value
      this.addTab = 'uri'
      this.addError = ''
      // Camera scanning is an import action, not merely a URI capture step.
      // Persist the decoded account(s) immediately so users do not have to
      // discover and press a second button after the scanner closes.
      this.saveNewAccount()
    } catch (e) {
      if (!(e as Error).message.includes('iptal')) this.addError = (e as Error).message
    }
  }

  openVerify(id: string) {
    this.recordActivity()
    this.verifyAccountId = id
    this.verifyInput = ''
    this.verifyResult = ''
  }

  checkVerify() {
    this.recordActivity()
    const acc = vaultStore.accounts.find((a) => a.id === this.verifyAccountId)
    if (!acc) return

    const entered = this.verifyInput.trim().replace(/\s/g, '')

    if (acc.type === 'hotp') {
      const key = base32Decode(acc.secret)
      const start = acc.counter ?? 0
      for (let offset = 0; offset < 10; offset++) {
        const candidate = generateHotp(key, start + offset, {
          digits: acc.digits,
          algorithm: acc.algorithm,
        })
        let different = entered.length !== candidate.length ? 1 : 0
        for (let i = 0; i < candidate.length; i++) {
          different |= candidate.charCodeAt(i) ^ (entered.charCodeAt(i) || 0)
        }
        if (different === 0) {
          const nextCounter = start + offset + 1
          vaultService.updateAccount(acc.id, { counter: nextCounter })
          this.refreshAccounts()
          this.verifyResult = 'success'
          this.showToast('HOTP sayacı güvenli biçimde ilerletildi')
          return
        }
      }
      this.verifyResult = 'error'
      return
    }

    const valid = verifyTotp(
      acc.secret,
      entered,
      acc.period,
      acc.digits,
      acc.algorithm,
      1,
      Date.now()
    )

    this.verifyResult = valid ? 'success' : 'error'
  }

  openQr(id: string) {
    this.recordActivity()
    const acc = vaultStore.accounts.find((a) => a.id === id)
    if (!acc) return
    this.selectedQrIssuer = acc.issuer
    this.selectedQrUri = buildOtpAuthUri(acc)
    this.showQrModal = true
  }

  saveNewAccount() {
    this.recordActivity()
    this.addError = ''

    if (this.addTab === 'uri') {
      const u = this.uriInput.trim()

      // 1. Google Authenticator Migration Protobuf URI
      if (u.startsWith('otpauth-migration://')) {
        try {
          const migrated = parseMigrationUri(u)
          if (migrated.length === 0) {
            this.addError = 'Aktarılacak hesap bulunamadı.'
            return
          }
          const newAccounts: Account[] = []
          for (let i = 0; i < migrated.length; i++) {
            const m = migrated[i]
            const item: Account = {
              id: `act-${Date.now()}-${i}`,
              issuer: m.issuer,
              account: m.account,
              secret: m.secret,
              algorithm: m.algorithm,
              digits: m.digits,
              period: 30,
              type: m.type,
              counter: m.counter,
              favorite: false,
              tags: ['kisisel'],
              createdAt: Date.now(),
            }
            newAccounts.push(item)
          }
          const added = vaultService.addAccounts(newAccounts)
          this.refreshAccounts()
          this.showAddModal = false
          const skipped = newAccounts.length - added
          if (added === 0) {
            this.showToast(`${skipped} hesap zaten kasada mevcut; yeni hesap eklenmedi`)
          } else if (skipped > 0) {
            this.showToast(`${added} hesap aktarıldı, ${skipped} mevcut hesap atlandı`)
          } else {
            this.showToast(`${added} hesap Google Authenticator'dan aktarıldı`)
          }
          return
        } catch (e) {
          this.addError = `Google Authenticator aktarımı başarısız: ${(e as Error).message}`
          return
        }
      }

      // 2. Standard otpauth:// URI
      if (!u.startsWith('otpauth://')) {
        this.addError = 'Geçersiz URI: "otpauth://totp/..." veya "otpauth-migration://..." olmalıdır.'
        return
      }

      try {
        const parsed = parseOtpAuthUri(u)
        const newAcc: Account = {
          id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          issuer: parsed.issuer,
          account: parsed.account,
          secret: parsed.secret,
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
          type: parsed.type,
          counter: parsed.counter,
          favorite: false,
          tags: ['kisisel'],
          createdAt: Date.now(),
        }
        vaultService.addAccount(newAcc)
        this.refreshAccounts()
        this.showAddModal = false
        this.showToast(`${parsed.issuer} hesabı eklendi`)
        return
      } catch (e) {
        this.addError = `URI ayrıştırılamadı: ${(e as Error).message}`
        return
      }
    }

    // Manual Form
    const issuer = this.newIssuer.trim()
    const account = this.newAccount.trim()
    const secret = this.newSecret.trim().toUpperCase().replace(/[\s-]/g, '')

    if (!issuer) {
      this.addError = 'Lütfen servis / sağlayıcı adını girin.'
      return
    }
    if (!account) {
      this.addError = 'Lütfen hesap adı / e-posta girin.'
      return
    }
    if (!secret) {
      this.addError = 'Lütfen Base32 gizli anahtarını girin.'
      return
    }

    try {
      base32Decode(secret)
      if (this.newType === 'totp') {
        generateTotp(secret, parseInt(this.newPeriod, 10) || 30, this.newDigits, this.newAlgorithm, Date.now())
      }
    } catch (err) {
      this.addError = `Geçersiz gizli anahtar: ${(err as Error).message}`
      return
    }

    const newAcc: Account = {
      id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      issuer,
      account,
      secret,
      algorithm: this.newAlgorithm,
      digits: this.newDigits,
      period: parseInt(this.newPeriod, 10) || 30,
      type: this.newType,
      counter: parseInt(this.newCounter, 10) || 0,
      favorite: false,
      tags: [this.newTag],
      createdAt: Date.now(),
    }

    vaultService.addAccount(newAcc)
    this.refreshAccounts()
    this.showAddModal = false
    this.showToast(`${issuer} hesabı eklendi`)
  }

  savePasswordChange() {
    this.recordActivity()
    this.settingsError = ''
    this.settingsMessage = ''

    if (this.nextPass.length < 8) {
      this.settingsError = 'Yeni parola en az 8 karakter olmalıdır.'
      return
    }
    if (this.nextPass !== this.confirmPass) {
      this.settingsError = 'Yeni parolalar birbiriyle eşleşmiyor.'
      return
    }

    try {
      vaultService.changePassword(this.currentPass, this.nextPass)
      vaultStore.hasVault = true
      this.currentPass = ''
      this.nextPass = ''
      this.confirmPass = ''
      this.settingsMessage = 'Master parola başarıyla güncellendi.'
    } catch (e) {
      this.settingsError = (e as Error).message
    }
  }

  importBackup(mode: 'merge' | 'replace' = 'merge') {
    this.recordActivity()
    this.settingsError = ''
    this.settingsMessage = ''

    try {
      const count = vaultService.importBackup(this.importJsonInput, mode)
      this.refreshAccounts()
      this.importJsonInput = ''
      this.settingsMessage = `${count} hesap şifreli yedekten içe aktarıldı.`
    } catch (e) {
      this.settingsError = `İçe aktarma hatası: ${(e as Error).message}`
    }
  }

  exportBackup() {
    this.recordActivity()
    this.settingsError = ''
    try {
      const path = vaultService.exportBackup()
      this.settingsMessage = `Şifreli yedek kaydedildi: ${path}`
    } catch (e) {
      if (!(e as Error).message.includes('iptal')) this.settingsError = (e as Error).message
    }
  }

  template() {
    this.init()

    const verifyAcc = vaultStore.accounts.find((a) => a.id === this.verifyAccountId)

    return (
      <div class="app-switch-root" data-account-count={vaultStore.totalCount}>
        <div class="app-stage" style={{ display: vaultStore.unlocked ? 'none' : 'flex' }}>
        <div class="unlock-wrapper">
          <div class="unlock-box">
            <div class="unlock-badge">🛡️</div>
            <div class="unlock-heading">FiOTP</div>
            <div class="unlock-sub">Yerel, şifreli 2FA kasası</div>

            <div class="vault-row-card">
              <div class="vault-info-col">
                <span class="vault-info-label">Aktif Kasa</span>
                <span class="vault-info-path">{vaultStore.vaultPath}</span>
              </div>
              <button
                class="btn-change-vault"
                onClick={() => this.chooseVault(true)}
              >
                Değiştir...
              </button>
            </div>

            {this.unlockError ? (
              <div class="alert-error" style={{ width: '100%' }}>
                {this.unlockError}
              </div>
            ) : null}

            {this.creatingVault ? (
              <div class="create-vault-panel">
                <div class="create-vault-title">Yeni kasa oluştur</div>
                <input
                  class="password-input create-password-input"
                  type="password"
                  placeholder="Yeni master parola (en az 8 karakter)"
                  value={this.unlockInput}
                  onInput={(e: InputEvent) => { this.unlockInput = e.target.value }}
                />
                <input
                  class="password-input create-password-input"
                  type="password"
                  placeholder="Master parolayı doğrula"
                  value={this.unlockConfirmInput}
                  onInput={(e: InputEvent) => { this.unlockConfirmInput = e.target.value }}
                  onKeyDown={(e: KeyEvent) => {
                    if (e.keyCode === 13) this.createVault()
                  }}
                />
                <div class="create-vault-actions">
                  <button class="btn-secondary-half" onClick={() => {
                    this.creatingVault = false
                    this.unlockInput = ''
                    this.unlockConfirmInput = ''
                    this.loadState()
                  }}>Vazgeç</button>
                  <button class="btn-create-submit" onClick={() => this.createVault()}>
                    Yeni Kasayı Oluştur →
                  </button>
                </div>
              </div>
            ) : vaultStore.hasVault ? (
              <div class="input-submit-wrap">
                <input
                  class="password-input"
                  type="password"
                  placeholder="Master Parola"
                  value={this.unlockInput}
                  onInput={(e: InputEvent) => { this.unlockInput = e.target.value }}
                  onKeyDown={(e: KeyEvent) => {
                    if (e.keyCode === 13) this.unlockVault()
                  }}
                />
                <button class="btn-open-submit" onClick={() => this.unlockVault()}>
                  Kasayı Aç →
                </button>
              </div>
            ) : (
              <div class="empty-vault-notice">
                Bu konumda kasa yok. Mevcut bir kasa seçin veya yeni kasa oluşturun.
              </div>
            )}

            <div class="unlock-hint">● 5 dk hareketsizlikte oto-kilit</div>

            <div class="unlock-actions-row">
              <button
                class="btn-secondary-half"
                onClick={() => this.chooseVault(true)}
              >
                Var Olan Kasayı Aç…
              </button>
              <button
                class="btn-secondary-half"
                onClick={() => this.chooseVault(false)}
              >
                Yeni Konumda Kasa Oluştur…
              </button>
            </div>
          </div>

          <div class="unlock-footer-text">
            FiOTP v0.1.0 • Offline • AES-256-GCM Encrypted
          </div>
          </div>
        </div>
        <div class="app-stage" style={{ display: vaultStore.unlocked ? 'flex' : 'none' }}>
      <div class="root-layout" onClick={() => this.recordActivity()}>
        {/* TitleBar (36px, surfaceLowest) */}
        <div class="title-bar">
          <span class="app-name">FiOTP</span>
          <div class="vault-pill">
            <span class="vault-label">Kasa:</span>
            <span class="vault-path">{vaultStore.vaultPath}</span>
          </div>
          <span class="aes-badge">AES-256-GCM</span>
        </div>

        {/* Toolbar (44px, surfaceLow) */}
        <div class="toolbar">
          <div class="search-box">
            <span class="search-icon">⌕</span>
            <input
              class="search-input"
              type="text"
              placeholder="Hesaplarda veya etiketlerde ara..."
              value={vaultStore.search}
              onInput={(e: InputEvent) => {
                this.recordActivity()
                vaultStore.setSearch(e.target.value)
              }}
            />
            <span class="kbd-badge">⌘K</span>
          </div>

          <button
            class="btn-primary-add"
            onClick={() => {
              this.recordActivity()
              this.showAddModal = true
              this.addError = ''
            }}
          >
            + Hesap Ekle
          </button>

          <button
            class="btn-ghost"
            onClick={() => {
              this.recordActivity()
              this.showSettingsModal = true
            }}
          >
            Kasa & Yedek
          </button>

          <button
            class="btn-icon-sq"
            onClick={() => {
              this.recordActivity()
              this.showSettingsModal = true
            }}
          >
            ⚙
          </button>
        </div>

        {/* Body: Sidebar + Main Content */}
        <div class="body-layout">
          {/* Sidebar (260px) */}
          <div class="sidebar">
            <div class="side-heading">Kategoriler</div>

            <button
              class={`side-item ${vaultStore.category === 'all' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('all')
              }}
            >
              <span class="side-entry-text">{`🔑   Tüm Kodlar   ${vaultStore.totalCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'favorites' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('favorites')
              }}
            >
              <span class="side-entry-text">{`★   Favoriler   ${vaultStore.favoriteCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'is' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('is')
              }}
            >
              <span class="side-entry-text">{`💼   İş & Kurumsal   ${vaultStore.workCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'kisisel' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('kisisel')
              }}
            >
              <span class="side-entry-text">{`👤   Kişisel   ${vaultStore.personalCount}`}</span>
            </button>

            <button
              class={`side-item ${vaultStore.category === 'hotp' ? 'active' : ''}`}
              onClick={() => {
                vaultStore.setCategory('hotp')
              }}
            >
              <span class="side-entry-text">{`⚡   HOTP Sayaçlı   ${vaultStore.hotpCount}`}</span>
            </button>

            {/* Status Card at Bottom */}
            <div class="status-card">
              <div class="status-row">
                <span class="status-label">KASA DURUMU</span>
                <div class="status-dot" />
              </div>
              <div class="status-title">AES-256-GCM</div>
              <div class="status-meta">Offline • Yerel kasa</div>
            </div>
          </div>

          {/* Main Content Area */}
          <div class="main-view">
            <div class="main-header">
              <div>
                <div class="live-badge">● Canlı TOTP & HOTP Motoru</div>
                <div class="main-title">Kasa Hesapları</div>
              </div>
              <button class="lock-btn" onClick={() => this.lockVault()}>
                Kasayı Kilitle  ⌘L
              </button>
            </div>

            {/* Filter Chips Row */}
            <div class="filters-row">
              <button
                class={`filter-chip ${vaultStore.category === 'all' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('all')
                }}
              >
                {`Tümü (${vaultStore.totalCount})`}
              </button>

              <button
                class={`filter-chip ${vaultStore.category === 'is' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('is')
                }}
              >
                {`İş (${vaultStore.workCount})`}
              </button>

              <button
                class={`filter-chip ${vaultStore.category === 'kisisel' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('kisisel')
                }}
              >
                {`Kişisel (${vaultStore.personalCount})`}
              </button>

              <button
                class={`filter-chip ${vaultStore.category === 'hotp' ? 'active' : ''}`}
                onClick={() => {
                  vaultStore.setCategory('hotp')
                }}
              >
                {`HOTP (${vaultStore.hotpCount})`}
              </button>

              <div class="count-badge-text">{vaultStore.visibleAccounts.length} Aktif</div>
            </div>

            {/* Cards List */}
            <div
              class="empty-box"
              style={{ display: vaultStore.liveAccounts.length === 0 ? 'flex' : 'none' }}
            >
                <div class="empty-title">Henüz hesap yok</div>
                <div class="empty-body">
                  QR tarayarak, URI yapıştırarak veya manuel girerek hesap ekleyin.
                </div>
                <button
                  class="btn-primary-add"
                  style={{ marginTop: '12px' }}
                  onClick={() => {
                    this.showAddModal = true
                  }}
                >
                  + Hesap Ekle
                </button>
            </div>
            <div
              class="cards-list"
              style={{ display: vaultStore.liveAccounts.length === 0 ? 'none' : 'flex' }}
            >
                {vaultStore.liveAccounts.map((acc) => {
                  const initials = (acc.issuer || '??').slice(0, 2).toUpperCase()
                  return (
                    <div class="totp-card" key={acc.id}>
                      <div class="card-left">
                        <div class="card-badge">{initials}</div>
                        <div class="card-meta">
                          <div class="card-title-row">
                            <span class="issuer-text">{acc.issuer}</span>
                            <button
                              class={acc.favorite ? 'star-icon' : 'star-icon-off'}
                              onClick={() => this.toggleFavorite(acc.id)}
                            >
                              ★
                            </button>
                            <span class="chip-meta">{acc.algorithm}</span>
                            <span class="chip-meta">{acc.type === 'hotp' ? 'HOTP' : 'TOTP'}</span>
                            {acc.tags.includes('is') ? <span class="chip-tag">İş</span> : null}
                            {acc.tags.includes('kisisel') ? <span class="chip-tag">Kişisel</span> : null}
                          </div>
                          <div class="account-username">{acc.account}</div>
                        </div>
                      </div>
                      <div class="card-right">
                        {acc.type === 'totp' ? (
                          <div class="timer-ring-wrap">
                            <div class={`timer-ring-bg ${acc.remainingSeconds <= 5 ? 'danger' : acc.remainingSeconds <= 10 ? 'warning' : ''}`}>
                              <div class="timer-ring-inner">
                                {acc.remainingSeconds}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button class="btn-card-action" onClick={() => this.incrementHotp(acc.id)}>
                            Sayaç {acc.counter ?? 0} +
                          </button>
                        )}

                        <button
                          class={`code-box ${this.copiedId === acc.id ? 'copied' : ''}`}
                          onClick={() => this.copyCode(
                            acc.type === 'hotp'
                              ? generateHotp(base32Decode(acc.secret), acc.counter ?? 0, { digits: acc.digits, algorithm: acc.algorithm })
                              : generateTotp(acc.secret, acc.period, acc.digits, acc.algorithm, Date.now()).code,
                            acc.id
                          )}
                        >
                          <span class={`code-text ${acc.type === 'totp' && acc.remainingSeconds <= 5 ? 'urgent' : ''}`}>
                            {this.copiedId === acc.id
                              ? 'Kopyalandı ✓'
                              : acc.type === 'hotp'
                                ? acc.liveCode
                                : acc.liveCode}
                          </span>
                          <span class="copy-icon">⧉</span>
                        </button>

                        <button
                          class="btn-card-action"
                          onClick={() => this.openQr(acc.id)}
                        >
                          QR
                        </button>

                        {/* Verify Action */}
                        <button
                          class="btn-card-action"
                          onClick={() => this.openVerify(acc.id)}
                        >
                          Doğrula
                        </button>
                        <button
                          class="btn-card-action"
                          style={{ color: '#ffb4ab' }}
                          onClick={() => this.deleteAccount(acc.id)}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>

        {/* Footer Bar (28px, surfaceLowest) */}
        <div class="footer-bar">
          <div>Oto-Kilit: 5 dk hareketsizlik</div>
          <div>FiOTP v0.1.0 • Offline • AES-256-GCM Encrypted</div>
        </div>

        {/* Add Account Modal */}
        {this.showAddModal ? (
          <div class="overlay-backdrop">
            <div class="modal-box">
              <div class="modal-header-row">
                <span class="modal-heading">Hesap Ekle</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    this.showAddModal = false
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="modal-tabs-row">
                <button
                  class={`modal-tab-btn ${this.addTab === 'manual' ? 'active' : ''}`}
                  onClick={() => {
                    this.addTab = 'manual'
                  }}
                >
                  Manuel
                </button>
                <button
                  class={`modal-tab-btn ${this.addTab === 'uri' ? 'active' : ''}`}
                  onClick={() => {
                    this.addTab = 'uri'
                  }}
                >
                  URI / Google Auth Aktarım
                </button>
              </div>

              {this.addError ? <div class="alert-error">{this.addError}</div> : null}

              {this.addTab === 'uri' ? (
                <div class="modal-field-group">
                  <span class="field-label">otpauth:// veya otpauth-migration:// URI</span>
                  <textarea
                    class="field-input textarea-tall"
                    placeholder="otpauth://totp/GitHub:user?secret=JBSWY3DPEHPK3PXP&#10;veya Google Authenticator migration URL yapıştırın"
                    value={this.uriInput}
                    onInput={(e: InputEvent) => {
                      this.uriInput = e.target.value
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#8c909f', marginTop: '4px' }}>
                    Google Authenticator QR aktarım bağlantıları (`otpauth-migration://`) da desteklenir.
                  </div>
                  <button class="btn-ghost" style={{ marginTop: '8px' }} onClick={() => this.scanQr()}>
                    Kameradan QR Tara…
                  </button>
                </div>
              ) : (
                <>
                  <div class="modal-field-group">
                    <span class="field-label">Servis / Sağlayıcı</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder="Örn: GitHub, Google, AWS, Cloudflare"
                      value={this.newIssuer}
                      onInput={(e: InputEvent) => {
                        this.newIssuer = e.target.value
                      }}
                    />
                  </div>

                  <div class="modal-field-group">
                    <span class="field-label">Hesap Adı / E-posta</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder="kullanici@alanadi.com"
                      value={this.newAccount}
                      onInput={(e: InputEvent) => {
                        this.newAccount = e.target.value
                      }}
                    />
                  </div>

                  <div class="modal-field-group">
                    <span class="field-label">Gizli Anahtar (Base32)</span>
                    <input
                      class="field-input"
                      type="text"
                      placeholder="JBSWY3DPEHPK3PXP"
                      value={this.newSecret}
                      onInput={(e: InputEvent) => {
                        this.newSecret = e.target.value
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                    <div class="modal-field-group" style={{ flex: 1 }}>
                      <span class="field-label">Tip</span>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                        <button
                          class={`modal-tab-btn ${this.newType === 'totp' ? 'active' : ''}`}
                          onClick={() => {
                            this.newType = 'totp'
                          }}
                        >
                          TOTP (Zaman)
                        </button>
                        <button
                          class={`modal-tab-btn ${this.newType === 'hotp' ? 'active' : ''}`}
                          onClick={() => {
                            this.newType = 'hotp'
                          }}
                        >
                          HOTP (Sayaç)
                        </button>
                      </div>
                    </div>

                    <div class="modal-field-group" style={{ flex: 1 }}>
                      <span class="field-label">Algoritma</span>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                        <button
                          class={`modal-tab-btn ${this.newAlgorithm === 'SHA1' ? 'active' : ''}`}
                          onClick={() => {
                            this.newAlgorithm = 'SHA1'
                          }}
                        >
                          SHA1
                        </button>
                        <button
                          class={`modal-tab-btn ${this.newAlgorithm === 'SHA256' ? 'active' : ''}`}
                          onClick={() => {
                            this.newAlgorithm = 'SHA256'
                          }}
                        >
                          SHA256
                        </button>
                        <button
                          class={`modal-tab-btn ${this.newAlgorithm === 'SHA512' ? 'active' : ''}`}
                          onClick={() => {
                            this.newAlgorithm = 'SHA512'
                          }}
                        >
                          SHA512
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                    <div class="modal-field-group" style={{ flex: 1 }}>
                      <span class="field-label">Kategori</span>
                      <div style={{ display: 'flex', flexDirection: 'row', gap: '4px' }}>
                        <button
                          class={`modal-tab-btn ${this.newTag === 'kisisel' ? 'active' : ''}`}
                          onClick={() => {
                            this.newTag = 'kisisel'
                          }}
                        >
                          Kişisel
                        </button>
                        <button
                          class={`modal-tab-btn ${this.newTag === 'is' ? 'active' : ''}`}
                          onClick={() => {
                            this.newTag = 'is'
                          }}
                        >
                          İş
                        </button>
                      </div>
                    </div>

                    {this.newType === 'totp' ? (
                      <div class="modal-field-group" style={{ flex: 1 }}>
                        <span class="field-label">Süre (sn)</span>
                        <input
                          class="field-input"
                          type="text"
                          value={this.newPeriod}
                          onInput={(e: InputEvent) => {
                            this.newPeriod = e.target.value
                          }}
                        />
                      </div>
                    ) : (
                      <div class="modal-field-group" style={{ flex: 1 }}>
                        <span class="field-label">Başlangıç Sayacı</span>
                        <input
                          class="field-input"
                          type="text"
                          value={this.newCounter}
                          onInput={(e: InputEvent) => {
                            this.newCounter = e.target.value
                          }}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              <div class="modal-actions-row">
                <button
                  class="btn-ghost"
                  onClick={() => {
                    this.showAddModal = false
                  }}
                >
                  İptal
                </button>
                <button class="btn-primary-add" onClick={() => this.saveNewAccount()}>
                  Hesap Ekle
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* QR Code Sharing Modal */}
        {this.showQrModal ? (
          <div class="overlay-backdrop">
            <div class="modal-box">
              <div class="modal-header-row">
                <span class="modal-heading">QR / URI Paylaşımı — {this.selectedQrIssuer}</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    this.showQrModal = false
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Standart otpauth URI</span>
                <textarea
                  class="field-input textarea-mono"
                  value={this.selectedQrUri}
                />
              </div>

              <div class="modal-actions-row">
                <button
                  class="btn-primary-add"
                  onClick={() => {
                    safeCopy(this.selectedQrUri)
                    this.showToast('otpauth URI panoya kopyalandı')
                  }}
                >
                  📋 URI Kopyala
                </button>
                <button
                  class="btn-ghost"
                  onClick={() => {
                    this.showQrModal = false
                  }}
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Verify Modal */}
        {this.verifyAccountId ? (
          <div class="overlay-backdrop">
            <div class="modal-box">
              <div class="modal-header-row">
                <span class="modal-heading">Kod Doğrula — {verifyAcc?.issuer}</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    this.verifyAccountId = ''
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">6 Haneli Kod Girin</span>
                <input
                  class="field-input"
                  type="text"
                  placeholder="123456"
                  value={this.verifyInput}
                  onInput={(e: InputEvent) => {
                    this.verifyInput = e.target.value
                  }}
                  onKeyDown={(e: KeyEvent) => {
                    if (e.keyCode === 13) this.checkVerify()
                  }}
                />
              </div>

              {this.verifyResult === 'success' ? (
                <div class="alert-success">✓ Kod geçerli! Doğrulama başarılı.</div>
              ) : null}
              {this.verifyResult === 'error' ? (
                <div class="alert-error">✕ Kod geçersiz veya süresi dolmuş.</div>
              ) : null}

              <div class="modal-actions-row">
                <button
                  class="btn-ghost"
                  onClick={() => {
                    this.verifyAccountId = ''
                  }}
                >
                  Kapat
                </button>
                <button class="btn-primary-add" onClick={() => this.checkVerify()}>
                  Doğrula
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Settings & Backup Modal */}
        {this.showSettingsModal ? (
          <div class="overlay-backdrop">
            <div class="modal-box" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
              <div class="modal-header-row">
                <span class="modal-heading">Kasa & Ayarlar</span>
                <button
                  class="btn-close-x"
                  onClick={() => {
                    this.showSettingsModal = false
                  }}
                >
                  ✕
                </button>
              </div>

              {this.settingsMessage ? (
                <div class="alert-success">{this.settingsMessage}</div>
              ) : null}
              {this.settingsError ? (
                <div class="alert-error">{this.settingsError}</div>
              ) : null}

              <div class="modal-field-group">
                <span class="field-label">Aktif Kasa Konumu</span>
                <div class="field-input" style={{ color: '#4edea3' }}>
                  {vaultStore.vaultPath}
                </div>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Master Parola Değiştir</span>
                <input
                  class="field-input"
                  type="password"
                  placeholder="Mevcut parola"
                  value={this.currentPass}
                  onInput={(e: InputEvent) => {
                    this.currentPass = e.target.value
                  }}
                />
                <input
                  class="field-input"
                  style={{ marginTop: '4px' }}
                  type="password"
                  placeholder="Yeni parola"
                  value={this.nextPass}
                  onInput={(e: InputEvent) => {
                    this.nextPass = e.target.value
                  }}
                />
                <input
                  class="field-input"
                  style={{ marginTop: '4px' }}
                  type="password"
                  placeholder="Yeni parolayı onayla"
                  value={this.confirmPass}
                  onInput={(e: InputEvent) => {
                    this.confirmPass = e.target.value
                  }}
                />
                <button
                  class="btn-ghost"
                  style={{ marginTop: '6px' }}
                  onClick={() => this.savePasswordChange()}
                >
                  Parolayı Güncelle
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Şifreli Kasa Yedeği</span>
                <button
                  class="btn-ghost"
                  onClick={() => this.exportBackup()}
                >
                  Şifreli Yedeği Dışa Aktar…
                </button>
              </div>

              <div class="modal-field-group">
                <span class="field-label">Şifreli Yedekten Geri Yükle</span>
                <input
                  class="field-input"
                  type="password"
                  placeholder="Yedek master parolası"
                  value={this.importJsonInput}
                  onInput={(e: InputEvent) => {
                    this.importJsonInput = e.target.value
                  }}
                />
                <button
                  class="btn-ghost"
                  style={{ marginTop: '6px' }}
                  onClick={() => this.importBackup('merge')}
                >
                  Birleştirerek İçe Aktar…
                </button>
                <button
                  class="btn-ghost"
                  style={{ marginTop: '6px' }}
                  onClick={() => this.importBackup('replace')}
                >
                  Kasayı Yedekle Değiştir…
                </button>
              </div>

              <div class="modal-actions-row">
                <button
                  class="btn-primary-add"
                  onClick={() => {
                    this.showSettingsModal = false
                  }}
                >
                  Tamam
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Floating Toast Notification */}
        {this.toastMessage ? (
          <div class="toast-bar">
            <span class="toast-check">✓</span>
            <span>{this.toastMessage}</span>
          </div>
        ) : null}
      </div>
        </div>
      </div>
    )
  }
}
