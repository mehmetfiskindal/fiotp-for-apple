import assert from 'node:assert/strict'
import { vaultStore } from '../src/stores/VaultStore.ts'
import type { Account } from '../src/types.ts'

// Mock accounts: 23 accounts matching the user's real-world vault
const accounts: Account[] = []
for (let i = 1; i <= 23; i++) {
  accounts.push({
    id: `acc-${i}`,
    issuer: `Service ${i}`,
    account: `user${i}@example.com`,
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    type: 'totp',
    favorite: i <= 3,
    tags: i % 2 === 0 ? ['is'] : ['kisisel'],
    createdAt: Date.now(),
  })
}

vaultStore.accounts = accounts
vaultStore.phase = 'unlocked'
vaultStore.rebuildView()

// Initial state verification
assert.equal(vaultStore.pageSize, 8)
assert.equal(vaultStore.totalCount, 23)
assert.equal(vaultStore.visibleCount, 23)
assert.equal(vaultStore.pageCount, 3)
assert.equal(vaultStore.page, 0)
assert.equal(vaultStore.pageStart, 1)
assert.equal(vaultStore.pageEnd, 8)
assert.equal(vaultStore.liveAccounts.length, 8)
assert.equal(vaultStore.liveAccounts[0].id, 'acc-1')
assert.equal(vaultStore.liveAccounts[7].id, 'acc-8')

// Page 1 -> Page 2
vaultStore.nextPage()
assert.equal(vaultStore.page, 1)
assert.equal(vaultStore.pageStart, 9)
assert.equal(vaultStore.pageEnd, 16)
assert.equal(vaultStore.liveAccounts.length, 8)
assert.equal(vaultStore.liveAccounts[0].id, 'acc-9')
assert.equal(vaultStore.liveAccounts[7].id, 'acc-16')

// Page 2 -> Page 3 (last page, remaining 7 accounts)
vaultStore.nextPage()
assert.equal(vaultStore.page, 2)
assert.equal(vaultStore.pageStart, 17)
assert.equal(vaultStore.pageEnd, 23)
assert.equal(vaultStore.liveAccounts.length, 7)
assert.equal(vaultStore.liveAccounts[0].id, 'acc-17')
assert.equal(vaultStore.liveAccounts[6].id, 'acc-23')

// Cannot exceed last page
vaultStore.nextPage()
assert.equal(vaultStore.page, 2)

// Page 3 -> Page 2 -> Page 1
vaultStore.prevPage()
assert.equal(vaultStore.page, 1)
assert.equal(vaultStore.pageStart, 9)
assert.equal(vaultStore.pageEnd, 16)

vaultStore.prevPage()
assert.equal(vaultStore.page, 0)
assert.equal(vaultStore.pageStart, 1)
assert.equal(vaultStore.pageEnd, 8)

// Cannot go below 0
vaultStore.prevPage()
assert.equal(vaultStore.page, 0)

// Filtering resets page to 0
vaultStore.nextPage()
assert.equal(vaultStore.page, 1)
vaultStore.setCategory('favorites')
assert.equal(vaultStore.category, 'favorites')
assert.equal(vaultStore.page, 0)
assert.equal(vaultStore.visibleCount, 3)
assert.equal(vaultStore.pageCount, 1)
assert.equal(vaultStore.pageStart, 1)
assert.equal(vaultStore.pageEnd, 3)
assert.equal(vaultStore.liveAccounts.length, 3)

// Reset back to all
vaultStore.setCategory('all')
assert.equal(vaultStore.visibleCount, 23)
assert.equal(vaultStore.pageCount, 3)

console.log('Pagination tests passed')
