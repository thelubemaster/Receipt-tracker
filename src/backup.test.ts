import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  isSchoolieBackup,
  summarizeBackup,
  type SchoolieBackup,
} from './backup'

function sample(): SchoolieBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: '1.34.0',
    exportedAt: '2026-08-10T00:00:00.000Z',
    projects: [
      {
        id: 'p1',
        name: 'Bus',
        description: '',
        coverImageId: null,
        budget: 5000,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    purchases: [
      {
        id: 'r1',
        projectId: 'p1',
        date: '2026-01-02',
        description: 'Parts',
        amount: 100,
        categoryId: 'engine',
        vendor: 'NAPA',
        notes: '',
        receiptImageId: null,
        lineItems: [],
        aisUsed: [],
        bestAiId: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    settings: {
      projectName: 'My project',
      lastSeenVersion: '1.34.0',
      maxPowerMode: true,
      disabledAis: [],
      customCategories: [],
      themeId: 'midnight-teal',
    },
    leaderboard: null,
    receiptMemory: {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      vendors: {},
      textHints: [],
    },
    images: [],
  }
}

describe('backup format', () => {
  it('recognizes a valid schoolie backup', () => {
    expect(isSchoolieBackup(sample())).toBe(true)
    expect(isSchoolieBackup({ format: 'nope' })).toBe(false)
    expect(isSchoolieBackup(null)).toBe(false)
  })

  it('summarizes counts', () => {
    const s = summarizeBackup(sample())
    expect(s.projects).toBe(1)
    expect(s.purchases).toBe(1)
    expect(s.images).toBe(0)
  })
})
