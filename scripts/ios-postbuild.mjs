import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const plist = resolve('dist/ios/fiotp-gea/GeaIos.xcodeproj/Info.plist')
if (!existsSync(plist)) {
  throw new Error(`iOS Info.plist bulunamadı: ${plist}`)
}

execFileSync('plutil', [
  '-replace', 'NSCameraUsageDescription',
  '-string', 'FiOTP, iki faktörlü kimlik doğrulama hesaplarını QR kodundan içe aktarmak için kamerayı kullanır.',
  plist,
], { stdio: 'inherit' })
