import type { LiveAccount } from '../stores/VaultStore'
import { Component, type GeaElement } from '@geastack/core'
import AccountCard from './AccountCard'

export interface AccountListProps {
  accounts: LiveAccount[]
  copiedId: string
  onAddAccount: () => void
  onToggleFavorite: (id: string) => void
  onIncrementHotp: (id: string) => void
  onCopy: (id: string, code: string) => void
  onShowQr: (id: string) => void
  onVerify: (id: string) => void
  onDelete: (id: string) => void
}

export default class AccountList extends Component<GeaElement, AccountListProps> {
  template(props: AccountListProps) {
    const { accounts, copiedId, onAddAccount, onToggleFavorite, onIncrementHotp, onCopy, onShowQr, onVerify, onDelete } = props

    if (!accounts.length) {
    return (
      <div class="empty-box">
        <div class="empty-title">Henüz hesap yok</div>
        <div class="empty-body">QR tarayarak, URI yapıştırarak veya manuel girerek hesap ekleyin.</div>
        <button class="btn-primary-add" style={{ marginTop: '12px' }} onClick={onAddAccount}>+ Hesap Ekle</button>
      </div>
    )
    }

    return (
    <div class="cards-list">
      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          copied={copiedId === account.id}
          onToggleFavorite={onToggleFavorite}
          onIncrementHotp={onIncrementHotp}
          onCopy={onCopy}
          onShowQr={onShowQr}
          onVerify={onVerify}
          onDelete={onDelete}
        />
      ))}
    </div>
    )
  }
}
