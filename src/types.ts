export type CategoryFilter = 'all' | 'favorites' | 'is' | 'kisisel' | 'hotp'

export interface Account {
  id: string
  issuer: string
  account: string
  secret: string
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
  digits: number
  period: number
  type: 'totp' | 'hotp'
  counter?: number
  favorite: boolean
  tags: string[]
  createdAt: number
}
