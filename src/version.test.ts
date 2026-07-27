import { describe, expect, it } from 'vitest'
import { APP_VERSION, formatVersionLabel, getUpdatesSince } from './version'

describe('version', () => {
  it('formats label', () => {
    expect(formatVersionLabel('1.2.3')).toBe('v1.2.3')
    expect(formatVersionLabel()).toBe(`v${APP_VERSION}`)
  })

  it('returns current notes when no previous version', () => {
    const updates = getUpdatesSince(null)
    expect(updates[0]?.version).toBe(APP_VERSION)
  })

  it('returns entries newer than previous', () => {
    const updates = getUpdatesSince('1.0.0')
    expect(updates.every((e) => e.version !== '1.0.0')).toBe(true)
    expect(updates.some((e) => e.version === APP_VERSION)).toBe(true)
  })
})
