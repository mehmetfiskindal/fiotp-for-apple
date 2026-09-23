import { Store } from '@geastack/core'
import type { Account, CategoryFilter } from '../types'
import { vaultService, type VaultStatus } from '../services/VaultService'
import { base32Decode, formatCode, generateHotp, generateTotp } from '../crypto/totp'

export type VaultPhase = 'locked' | 'opening' | 'unlocked' | 'error'
export type LiveAccount = Account & { liveCode: string; remainingSeconds: number }

class VaultStore extends Store {
  phase: VaultPhase = 'locked'
  accounts: Account[] = []
  visibleAccounts: Account[] = []
  liveAccounts: LiveAccount[] = []
  pageAccounts: LiveAccount[] = []
  page = 0
  pageCount = 1
  pageStart = 0
  pageEnd = 0
  visibleCount = 0
  clockSeconds = 0
  private lastLiveEpoch = 0
  totalCount = 0
  favoriteCount = 0
  workCount = 0
  personalCount = 0
  hotpCount = 0
  search = ''
  category: CategoryFilter = 'all'
  vaultPath = '~/Library/Application Support/FiOTP Gea/kasa.json'
  hasVault = false
  error = ''

  get unlocked() { return this.phase === 'unlocked' }
  rebuildView() {
    this.page = 0
    const q = this.search.trim().toLowerCase()
    const visible: Account[] = []
    let favorites = 0
    let work = 0
    let personal = 0
    let hotp = 0
    for (const account of this.accounts) {
      if (account.favorite) favorites++
      if (account.tags.includes('is')) work++
      if (account.tags.includes('kisisel')) personal++
      if (account.type === 'hotp') hotp++
      if (this.category === 'favorites' && !account.favorite) continue
      if (this.category === 'is' && !account.tags.includes('is')) continue
      if (this.category === 'kisisel' && !account.tags.includes('kisisel')) continue
      if (this.category === 'hotp' && account.type !== 'hotp') continue
      if (q && !`${account.issuer} ${account.account} ${account.tags.join(' ')}`.toLowerCase().includes(q)) continue
      visible.push(account)
    }
    this.visibleAccounts = visible
    this.totalCount = this.accounts.length
    this.favoriteCount = favorites
    this.workCount = work
    this.personalCount = personal
    this.hotpCount = hotp
    this.rebuildLive(Math.floor(Date.now() / 1000))
  }

  tick(epochSeconds: number) {
    if (!this.unlocked) return
    // The card countdown observes this scalar. Rebuilding the account array
    // every second would remount cards and reset the native scroll position.
    this.clockSeconds = epochSeconds
    for (const account of this.visibleAccounts) {
      if (account.type === 'totp' &&
          Math.floor(epochSeconds / account.period) !== Math.floor(this.lastLiveEpoch / account.period)) {
        this.rebuildLive(epochSeconds)
        return
      }
    }
  }

  private rebuildLive(epochSeconds: number) {
    this.clockSeconds = epochSeconds
    const live: LiveAccount[] = []
    for (const account of this.visibleAccounts) {
      if (account.type === 'hotp') {
        live.push({
          ...account,
          liveCode: formatCode(generateHotp(base32Decode(account.secret), account.counter ?? 0, {
            digits: account.digits,
            algorithm: account.algorithm,
          })),
          remainingSeconds: 0,
        })
      } else {
        const generated = generateTotp(account.secret, account.period, account.digits,
          account.algorithm, epochSeconds * 1000)
        live.push({ ...account, liveCode: generated.formattedCode,
          remainingSeconds: generated.remainingSeconds })
      }
    }
    this.lastLiveEpoch = epochSeconds
    this.liveAccounts = live
    this.updatePage()
  }

  private updatePage() {
    const size = 8
    this.visibleCount = this.liveAccounts.length
    this.pageCount = Math.max(1, Math.ceil(this.visibleCount / size))
    if (this.page >= this.pageCount) this.page = this.pageCount - 1
    const offset = this.page * size
    this.pageStart = this.visibleCount === 0 ? 0 : offset + 1
    this.pageEnd = Math.min(offset + size, this.visibleCount)
    this.pageAccounts = this.liveAccounts.slice(offset, offset + size)
  }

  setPage(next: number) {
    if (next < 0 || next >= this.pageCount || next === this.page) return
    this.page = next
    this.updatePage()
  }

  setSearch(value: string) { this.search = value; this.rebuildView() }
  setCategory(value: CategoryFilter) { this.category = value; this.rebuildView() }

  loadStatus(): VaultStatus {
    const status = vaultService.status()
    this.applyStatus(status)
    this.phase = 'locked'
    this.accounts = []
    this.rebuildView()
    this.error = ''
    return status
  }

  open(password: string, path: string): VaultStatus {
    this.phase = 'opening'
    this.error = ''
    try {
      const status = vaultService.open(password, path)
      this.accounts = vaultService.listAccounts()
      this.rebuildView()
      this.applyStatus(status)
      this.phase = 'unlocked'
      return status
    } catch (error) {
      this.accounts = []
      this.rebuildView()
      this.phase = 'error'
      this.error = (error as Error).message
      throw error
    }
  }

  create(password: string, path: string): VaultStatus {
    this.phase = 'opening'
    this.error = ''
    try {
      const status = vaultService.create(password, path)
      this.accounts = vaultService.listAccounts()
      this.rebuildView()
      this.applyStatus(status)
      this.phase = 'unlocked'
      return status
    } catch (error) {
      this.accounts = []
      this.rebuildView()
      this.phase = 'error'
      this.error = (error as Error).message
      throw error
    }
  }

  refresh() { this.accounts = vaultService.listAccounts(); this.rebuildView() }
  select(status: VaultStatus) {
    this.applyStatus(status)
    this.accounts = []
    this.rebuildView()
    this.phase = 'locked'
    this.error = ''
  }
  lock() {
    vaultService.lock()
    this.accounts = []
    this.search = ''
    this.category = 'all'
    this.rebuildView()
    this.phase = 'locked'
    this.error = ''
  }
  private applyStatus(status: VaultStatus) {
    this.vaultPath = status.path
    this.hasVault = status.hasVault
  }
}

export const vaultStore = new VaultStore()
