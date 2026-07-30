import { describe, expect, it } from 'vitest'
import { scoreOcrText } from './ocrScore'

describe('scoreOcrText', () => {
  it('scores a structured receipt higher than noise', () => {
    const good = `
HOME DEPOT
RIGID FOAM 48.97
SUBTOTAL 48.97
TAX 4.12
TOTAL 53.09
`
    const noise = 'asdf qwer zxcv\nlkjh\nmmmm'
    expect(scoreOcrText(good)).toBeGreaterThan(scoreOcrText(noise) * 3)
  })

  it('rewards TOTAL and money lines', () => {
    const withTotal = 'ITEM A 10.00\nTOTAL 10.00'
    const noTotal = 'ITEM A 10.00\nITEM B 5.00'
    expect(scoreOcrText(withTotal)).toBeGreaterThan(scoreOcrText(noTotal))
  })
})
