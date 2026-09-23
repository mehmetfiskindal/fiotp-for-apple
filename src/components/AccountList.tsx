import { Component, type GeaElement } from '@geastack/core'
import { vaultStore } from '../stores/VaultStore'
import AccountCard from './AccountCard'

export interface AccountListProps {
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
    const { copiedId, onAddAccount, onToggleFavorite, onIncrementHotp, onCopy, onShowQr, onVerify, onDelete } = props
    const accounts = vaultStore.pageAccounts

    return (
      <div class="account-list-region">
        <div class="empty-box" style={{ display: accounts.length === 0 ? 'flex' : 'none' }}>
          <div class="empty-title">Henüz hesap yok</div>
          <div class="empty-body">QR tarayarak, URI yapıştırarak veya manuel girerek hesap ekleyin.</div>
          <button class="btn-primary-add" style={{ marginTop: '12px' }} onClick={onAddAccount}>+ Hesap Ekle</button>
        </div>
        <div class="cards-list" style={{ display: accounts.length === 0 ? 'none' : 'flex' }}>
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
    </div>
    )
  }
}
