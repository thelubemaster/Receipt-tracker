/**
 * Normalize photos from Android's gallery picker & camera.
 *
 * Common failure modes we fix here:
 * - "Recent" MediaStore picks with empty MIME type
 * - content:// streams that need FileReader (arrayBuffer alone can fail)
 * - HEIC/HEIF that WebView cannot paint
 * - Huge camera originals as data: URLs → Android WebView shows a blank image
 *
 * Always re-encode to a reasonably sized image/jpeg so preview + OCR + storage work.
 */

export type NormalizedPick = {
  blob: Blob
  /** Prefer blob: for display (large data: URLs paint blank on many Android WebViews) */
  previewUrl: string
  /** data: URL only when small enough for safe embedding / localStorage */
  dataUrl?: string
  name?: string
  path: 'canvas' | 'image-element' | 'identity'
  width: number
  height: number
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/i
/** Keep display/storage under WebView-safe sizes */
export const DISPLAY_MAX_EDGE = 1600
export const STORAGE_MAX_EDGE = 1600
export const JPEG_QUALITY = 0.82
/** data: URLs larger than this often render blank in Android System WebView */
export const SAFE_DATA_URL_CHARS = 900_000

function sniffMime(buf: ArrayBuffer): string | undefined {
  const u = new Uint8Array(buf)
  if (u.length >= 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'image/jpeg'
  if (u.length >= 8 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
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
  if (!type && file.size > 32) return true
  return false
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

export function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  // FileReader is more reliable than blob.arrayBuffer() for Android content:// URIs
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      if (r.result instanceof ArrayBuffer) resolve(r.result)
      else reject(new Error('expected ArrayBuffer'))
    }
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsArrayBuffer(file)
  })
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // toBlob can return null on some WebViews — fall back to dataURL
    const finish = (b: Blob | null) => {
      if (b && b.size > 0) {
        resolve(b)
        return
      }
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const comma = dataUrl.indexOf(',')
        if (comma < 0) {
          reject(new Error('Could not encode photo as JPEG'))
          return
        }
        const binary = atob(dataUrl.slice(comma + 1))
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        resolve(new Blob([bytes], { type: 'image/jpeg' }))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Could not encode photo as JPEG'))
      }
    }
    try {
      canvas.toBlob(finish, 'image/jpeg', quality)
    } catch {
      finish(null)
    }
  })
}

type Decoded = { blob: Blob; width: number; height: number; path: NormalizedPick['path'] }

async function drawToJpeg(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srcW: number,
  srcH: number,
  maxEdge: number,
  path: NormalizedPick['path'],
): Promise<Decoded | null> {
  if (srcW < 2 || srcH < 2) return null
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // White background so transparent PNGs don't become "blank black"
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  draw(ctx, w, h)
  const blob = await canvasToJpeg(canvas)
  if (!blob || blob.size <= 0) return null
  return { blob, width: w, height: h, path }
}

async function decodeWithBitmap(blob: Blob, maxEdge: number): Promise<Decoded | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    let bitmap: ImageBitmap
    try {
      // Prefer correct EXIF orientation when supported
      bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      } as ImageBitmapOptions)
    } catch {
      bitmap = await createImageBitmap(blob)
    }
    try {
      return await drawToJpeg(
        (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        bitmap.width,
        bitmap.height,
        maxEdge,
        'canvas',
      )
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

async function decodeWithImageElement(blob: Blob, maxEdge: number): Promise<Decoded | null> {
  // Try blob: first, then data: (some WebViews only load one)
  const attempts: Array<() => Promise<string>> = [
    async () => URL.createObjectURL(blob),
    async () => blobToDataUrl(blob),
  ]
  for (const makeSrc of attempts) {
    let src = ''
    let isBlobUrl = false
    try {
      src = await makeSrc()
      isBlobUrl = src.startsWith('blob:')
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        const timer = setTimeout(() => reject(new Error('image load timeout')), 15000)
        el.onload = () => {
          clearTimeout(timer)
          resolve(el)
        }
        el.onerror = () => {
          clearTimeout(timer)
          reject(new Error('image element failed'))
        }
        el.src = src
      })
      try {
        if (typeof img.decode === 'function') await img.decode()
      } catch {
        /* already loaded */
      }
      const nw = img.naturalWidth || img.width
      const nh = img.naturalHeight || img.height
      const decoded = await drawToJpeg(
        (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        nw,
        nh,
        maxEdge,
        'image-element',
      )
      if (decoded) return decoded
    } catch {
      /* try next */
    } finally {
      if (isBlobUrl && src) {
        try {
          URL.revokeObjectURL(src)
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null
}

/**
 * Compress any image blob to a WebView-safe JPEG (for storage + display).
 * Returns null if the blob cannot be decoded.
 */
export async function compressImageToJpeg(
  input: Blob,
  maxEdge = STORAGE_MAX_EDGE,
): Promise<Decoded | null> {
  if (!input || input.size <= 0) return null
  let buffer: ArrayBuffer
  try {
    buffer = await readFileAsArrayBuffer(input)
  } catch {
    try {
      buffer = await input.arrayBuffer()
    } catch {
      return null
    }
  }
  if (!buffer.byteLength) return null

  const sniffed = sniffMime(buffer)
  const declared = (input.type || '').toLowerCase()
  const mime =
    (declared.startsWith('image/') ? declared : undefined) || sniffed || 'image/jpeg'
  const materialized = new Blob([buffer], { type: mime })

  const fromBitmap = await decodeWithBitmap(materialized, maxEdge)
  if (fromBitmap) return fromBitmap

  const fromImg = await decodeWithImageElement(materialized, maxEdge)
  if (fromImg) return fromImg

  // Already a small JPEG? pass through after size check
  if (mime === 'image/jpeg' && buffer.byteLength < 400_000 && sniffed === 'image/jpeg') {
    return {
      blob: materialized,
      width: 0,
      height: 0,
      path: 'identity',
    }
  }
  return null
}

/**
 * URL for <img src>. Never returns a multi‑MB data: URL (blank on Android WebView).
 * Prefers blob: object URLs; falls back to compact data: only when small.
 */
export async function blobToDisplayUrl(blob: Blob): Promise<string> {
  const compressed = await compressImageToJpeg(blob, DISPLAY_MAX_EDGE)
  const use = compressed?.blob || blob
  // Always materialize to a fresh Blob so createObjectURL is stable
  const buf = await readFileAsArrayBuffer(use)
  const fresh = new Blob([buf], { type: use.type || 'image/jpeg' })
  try {
    const dataUrl = await blobToDataUrl(fresh)
    if (dataUrl.length > 0 && dataUrl.length <= SAFE_DATA_URL_CHARS) {
      return dataUrl
    }
  } catch {
    /* use blob URL */
  }
  return URL.createObjectURL(fresh)
}

/**
 * Read the picked File fully, fix MIME, re-encode to a sized JPEG.
 */
export async function normalizePickedImage(
  file: File | Blob,
  opts?: { maxEdge?: number; name?: string },
): Promise<NormalizedPick> {
  const maxEdge = opts?.maxEdge ?? DISPLAY_MAX_EDGE
  const name = opts?.name || (file instanceof File ? file.name : '') || ''

  if (!looksLikeImageFile(file, name)) {
    throw new Error('Please choose a photo of the receipt.')
  }
  if (file.size <= 0) {
    throw new Error(
      'That photo is empty or still downloading. Open it in your gallery once, then try again from Recent.',
    )
  }

  const decoded = await compressImageToJpeg(file, maxEdge)
  if (!decoded) {
    // Detect HEIC for a clearer message
    try {
      const buf = await readFileAsArrayBuffer(file)
      const mime = sniffMime(buf)
      if (mime === 'image/heic' || mime === 'image/avif') {
        throw new Error(
          'This photo is HEIC/AVIF. In Camera settings, set photo format to JPEG (or “Most compatible”), then take the picture again. Or open the photo in Gallery → Share → Save as JPG.',
        )
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('HEIC')) throw e
    }
    throw new Error(
      'Could not open that photo. Try Take photo in the app, or pick a smaller JPEG from another album.',
    )
  }

  let dataUrl: string | undefined
  try {
    const du = await blobToDataUrl(decoded.blob)
    if (du.length <= SAFE_DATA_URL_CHARS) dataUrl = du
  } catch {
    /* optional */
  }

  return {
    blob: decoded.blob,
    previewUrl: URL.createObjectURL(decoded.blob),
    dataUrl,
    name,
    path: decoded.path,
    width: decoded.width,
    height: decoded.height,
  }
}

/** Revoke only blob: preview URLs. */
export function revokePreviewUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}
