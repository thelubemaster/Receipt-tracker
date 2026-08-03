import { describe, expect, it } from 'vitest'
import {
  canonicalizeCategoryId,
  getCategory,
  makeCustomCategory,
  slugifyCategory,
} from './categories'

describe('category aliases', () => {
  it('maps engine-and-powertrain (slug of Engine & Powertrain) to engine', () => {
    expect(slugifyCategory('Engine & Powertrain')).toBe('engine-and-powertrain')
    expect(canonicalizeCategoryId('engine-and-powertrain')).toBe('engine')
    expect(canonicalizeCategoryId('powertrain')).toBe('engine')
    expect(canonicalizeCategoryId('engine')).toBe('engine')
  })

  it('getCategory shows one clean Engine & Powertrain label', () => {
    expect(getCategory('engine').label).toBe('Engine & Powertrain')
    expect(getCategory('engine-and-powertrain').label).toBe('Engine & Powertrain')
    expect(getCategory('powertrain').label).toBe('Engine & Powertrain')
  })

  it('makeCustomCategory does not invent a duplicate of the engine preset', () => {
    const a = makeCustomCategory('Engine & Powertrain')
    const b = makeCustomCategory('Engine And Powertrain')
    expect(a.id).toBe('engine')
    expect(b.id).toBe('engine')
    expect(a.label).toBe('Engine & Powertrain')
  })
})
