import { Store } from '@geastack/core'
import type { OtpAlgorithm, OtpType } from '../crypto/totp'

class UiStore extends Store {
  passwordResetToken = 0
  creatingVault = false
  copiedId = ''
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

  currentPass = ''
  nextPass = ''
  confirmPass = ''
  importJsonInput = ''
  settingsMessage = ''
  settingsError = ''

  resetForLock() {
    this.creatingVault = false
    this.copiedId = ''
    this.showAddModal = false
    this.showSettingsModal = false
    this.showQrModal = false
    this.selectedQrUri = ''
    this.selectedQrIssuer = ''
    this.verifyAccountId = ''
    this.verifyInput = ''
    this.verifyResult = ''
    this.activeMenuAccountId = ''
    this.toastMessage = ''
    this.addTab = 'manual'
    this.newType = 'totp'
    this.newIssuer = ''
    this.newAccount = ''
    this.newSecret = ''
    this.newAlgorithm = 'SHA1'
    this.newDigits = 6
    this.newPeriod = '30'
    this.newCounter = '0'
    this.newTag = 'kisisel'
    this.uriInput = ''
    this.addError = ''
    this.currentPass = ''
    this.nextPass = ''
    this.confirmPass = ''
    this.importJsonInput = ''
    this.settingsMessage = ''
    this.settingsError = ''
  }
}

export const uiStore = new UiStore()
