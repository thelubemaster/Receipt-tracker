import { describe, expect, it } from 'vitest'
import { compareVersions } from './updateCheck'

describe('compareVersions', () => {
  it('orders semver', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1)
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('v1.2.0', '1.1.9')).toBe(1)
  })
})
