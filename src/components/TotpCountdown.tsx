import { Component, type GeaElement } from '@geastack/core'
import { vaultStore } from '../stores/VaultStore'

interface TotpCountdownProps {
  period: number
}

export default class TotpCountdown extends Component<GeaElement, TotpCountdownProps> {
  template({ period }: TotpCountdownProps) {
    const remaining = period - (vaultStore.clockSeconds % period)

    return (
      <div class="timer-ring-wrap">
        <div class={`timer-ring-bg ${remaining <= 5 ? 'danger' : remaining <= 10 ? 'warning' : ''}`}>
          <div class="timer-ring-inner">{remaining}</div>
        </div>
      </div>
    )
  }
}
