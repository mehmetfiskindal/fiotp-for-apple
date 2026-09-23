import { vaultStore, type LiveAccount } from '../stores/VaultStore'
import { Component, type GeaElement } from '@geastack/core'

export interface AccountCardProps {
  key?: string
  account: LiveAccount
  copied: boolean
  onToggleFavorite: (id: string) => void
  onIncrementHotp: (id: string) => void
  onCopy: (id: string, code: string) => void
  onShowQr: (id: string) => void
  onVerify: (id: string) => void
  onDelete: (id: string) => void
}

export default class AccountCard extends Component<GeaElement, AccountCardProps> {
  template(props: AccountCardProps) {
    const { account: acc, copied, onToggleFavorite, onIncrementHotp, onCopy, onShowQr, onVerify, onDelete } = props
    const initials = (acc.issuer || '??').slice(0, 2).toUpperCase()
    const remainingSeconds = acc.type === 'totp'
      ? acc.period - (vaultStore.clockSeconds % acc.period)
      : 0

    return (
    <div class="totp-card" key={acc.id}>
      <div class="card-left">
        <div class="card-badge">{initials}</div>
        <div class="card-meta">
          <div class="card-title-row">
            <span class="issuer-text">{acc.issuer}</span>
            <button class={acc.favorite ? 'star-icon' : 'star-icon-off'} onClick={() => onToggleFavorite(acc.id)}>★</button>
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
            <div class={`timer-ring-bg ${remainingSeconds <= 5 ? 'danger' : remainingSeconds <= 10 ? 'warning' : ''}`}>
              <div class="timer-ring-inner">{remainingSeconds}</div>
            </div>
          </div>
        ) : (
          <button class="btn-card-action" onClick={() => onIncrementHotp(acc.id)}>Sayaç {acc.counter ?? 0} +</button>
        )}

        <button
          class={`code-box ${copied ? 'copied' : ''}`}
          onClick={() => onCopy(acc.id, acc.liveCode)}
        >
          <span class="code-text">
            {copied ? 'Kopyalandı ✓' : acc.liveCode}
          </span>
          <span class="copy-icon">⧉</span>
        </button>
        <button class="btn-card-action" onClick={() => onShowQr(acc.id)}>QR</button>
        <button class="btn-card-action" onClick={() => onVerify(acc.id)}>Doğrula</button>
        <button class="btn-card-action" style={{ color: '#ffb4ab' }} onClick={() => onDelete(acc.id)}>Sil</button>
      </div>
    </div>
    )
  }
}
