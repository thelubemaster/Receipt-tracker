/**
 * Normalize photos from Android's gallery picker.
 *
 * "Recent" / MediaStore picks often fail in WebView because:
 * - MIME type is empty (we used to reject them)
 * - HEIC/HEIF from the camera cannot be painted by <img> / createImageBitmap
 * - content:// streams are incomplete until fully read into memory
 *
 * Always re-encode to a real image/jpeg Blob when possible so preview + OCR work.
 */

export type NormalizedPick = {
  blob: Blob
  previewUrl: string
  /** Original file name if any */
  name?: string
  /** How we recovered the image */
  path: 'identity' | 'canvas' | 'image-element'
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/i

function sniffMime(buf: ArrayBuffer): string | undefined {
  const u = new Uint8Array(buf)
  if (u.length >= 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'image/jpeg'
  if (
    u.length >= 8 &&
    u[0] === 0x89 &&
    u[1] === 0x50 &&
    u[2] === 0x4e &&
    u[3] === 0x47
  ) {
    return 'image/png'
  }
  if (u.length >= 6 && u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return 'image/gif'
  if (
    u.length >= 12 &&
    u[0] === 0x52 &&
    u[1] === 0x49 &&
    u[2] === 0x46 &&
    u[3] === 0x46 &&
    u[8] === 0x57 &&
    u[9] === 0x45 &&
    u[10] === 0x42 &&
    u[11] === 0x50
  ) {
    return 'image/webp'
  }
  // HEIC/HEIF: ....ftyp + brand
  if (u.length >= 12) {
    const brand = String.fromCharCode(u[4], u[5], u[6], u[7])
    if (brand === 'ftyp') {
      const major = String.fromCharCode(u[8], u[9], u[10], u[11]).toLowerCase()
      if (
        major.startsWith('heic') ||
        major.startsWith('heif') ||
        major === 'mif1' ||
        major === 'msf1' ||
        major.startsWith('avif')
      ) {
        return major.startsWith('avif') ? 'image/avif' : 'image/heic'
      }
    }
  }
  return undefined
}

/** True if this File looks like an image even when type is blank (Android Recent). */
export function looksLikeImageFile(file: File | Blob, nameHint = ''): boolean {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('image/')) return true
  if (type && type !== 'application/octet-stream') return false
  const name = nameHint || (file instanceof File ? file.name : '') || ''
  if (IMAGE_EXT.test(name)) return true
  // Empty type + non-trivial size: MediaStore often omits type for Recent
  if (!type && file.size > 32) return true
  return false
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b && b.size > 0 ? resolve(b) : reject(new Error('Could not encode photo as JPEG'))),
      'image/jpeg',
      quality,
    )
  })
}

async function decodeWithBitmap(blob: Blob, maxEdge: number): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      if (w < 2 || h < 2) return null
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, w, h)
      return await canvasToJpeg(canvas)
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

async function decodeWithImageElement(blob: Blob, maxEdge: number): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image element failed'))
      // Some WebViews need decode()
      el.src = url
    })
    try {
      if ('decode' in img && typeof img.decode === 'function') await img.decode()
    } catch {
      /* already loaded */
    }
    const nw = img.naturalWidth || img.width
    const nh = img.naturalHeight || img.height
    if (nw < 2 || nh < 2) return null
    const scale = Math.min(1, maxEdge / Math.max(nw, nh))
    const w = Math.max(1, Math.round(nw * scale))
    const h = Math.max(1, Math.round(nh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    return await canvasToJpeg(canvas)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Read the picked File fully into memory, fix MIME, re-encode to JPEG when needed.
 * Returns a Blob + object URL safe for <img> and OCR.
 */
export async function normalizePickedImage(
  file: File | Blob,
  opts?: { maxEdge?: number; name?: string },
): Promise<NormalizedPick> {
  const maxEdge = opts?.maxEdge ?? 2400
  const name = opts?.name || (file instanceof File ? file.name : '') || ''

  if (!looksLikeImageFile(file, name)) {
    throw new Error('Please choose a photo of the receipt.')
  }
  if (file.size <= 0) {
    throw new Error(
      'That photo is empty or still downloading. Open it in your gallery once, then try again from Recent.',
    )
  }

  // Fully materialize — Android content:// streams can be incomplete until read
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new Error(
      'Could not read that photo. Try opening it in Photos first, or pick it from another album.',
    )
  }
  if (!buffer || buffer.byteLength <= 0) {
    throw new Error(
      'That photo could not be loaded (0 bytes). Cloud-only Recent photos need to finish downloading first.',
    )
  }

  const sniffed = sniffMime(buffer)
  const declared = (file.type || '').toLowerCase()
  const mime =
    (declared.startsWith('image/') ? declared : undefined) ||
    sniffed ||
    (IMAGE_EXT.test(name)
      ? name.match(/\.png$/i)
        ? 'image/png'
        : name.match(/\.webp$/i)
          ? 'image/webp'
          : name.match(/\.gif$/i)
            ? 'image/gif'
            : name.match(/\.heic$/i) || name.match(/\.heif$/i)
              ? 'image/heic'
              : 'image/jpeg'
      : 'image/jpeg')

  const materialized = new Blob([buffer], { type: mime })

  // HEIC often cannot decode in Android WebView — try anyway, then clear error
  const fromBitmap = await decodeWithBitmap(materialized, maxEdge)
  if (fromBitmap) {
    return {
      blob: fromBitmap,
      previewUrl: URL.createObjectURL(fromBitmap),
      name,
      path: 'canvas',
    }
  }

  const fromImg = await decodeWithImageElement(materialized, maxEdge)
  if (fromImg) {
    return {
      blob: fromImg,
      previewUrl: URL.createObjectURL(fromImg),
      name,
      path: 'image-element',
    }
  }

  // Last resort: use raw bytes if already a common web format
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif') {
    return {
      blob: materialized,
      previewUrl: URL.createObjectURL(materialized),
      name,
      path: 'identity',
    }
  }

  if (mime === 'image/heic' || mime === 'image/heif' || mime === 'image/avif') {
    throw new Error(
      'This phone saved the photo in HEIC/AVIF, which the app cannot open. In Camera settings, set photo format to JPEG, or share/export the photo as JPG and pick it again.',
    )
  }

  throw new Error(
    'Could not open that photo from Recent. Try “Take photo” in the app, or pick a JPEG from another album.',
  )
}

/** Revoke only blob: preview URLs produced by normalizePickedImage. */
export function revokePreviewUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}
