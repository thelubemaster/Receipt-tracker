import { describe, expect, it } from 'vitest'
import { looksLikeImageFile } from './imagePick'

describe('looksLikeImageFile', () => {
  it('accepts normal image MIME', () => {
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' })
    expect(looksLikeImageFile(f)).toBe(true)
  })

  it('accepts empty MIME with image extension (Android Recent)', () => {
    const f = new File([new Uint8Array(64)], 'IMG_0001.JPG', { type: '' })
    expect(looksLikeImageFile(f)).toBe(true)
  })

  it('accepts empty MIME and non-trivial size without name', () => {
    const f = new File([new Uint8Array(128)], '', { type: '' })
    expect(looksLikeImageFile(f)).toBe(true)
  })

  it('rejects non-image MIME', () => {
    const f = new File([new Uint8Array(64)], 'doc.pdf', { type: 'application/pdf' })
    expect(looksLikeImageFile(f)).toBe(false)
  })

  it('accepts application/octet-stream with .jpg name', () => {
    const f = new File([new Uint8Array(64)], 'receipt.jpg', {
      type: 'application/octet-stream',
    })
    expect(looksLikeImageFile(f)).toBe(true)
  })
})
