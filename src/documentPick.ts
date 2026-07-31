/**
 * Normalize user-picked invoices/receipts from Files, Downloads, email, etc.
 *
 * - Photos → existing image pipeline
 * - PDF → extract embedded text when present (best for digital invoices);
 *   otherwise rasterize page(s) and OCR like a photo
 */
import {
  JPEG_QUALITY,
  SAFE_DATA_URL_CHARS,
  blobToDataUrl,
  looksLikeImageFile,
  normalizePickedImage,
  readFileAsArrayBuffer,
  type NormalizedPick,
} from './imagePick'
import { scoreOcrText } from './agents/ocrScore'

import type { LayoutLine, TextGlyph } from './agents/layoutText'
import { linesFromGlyphs } from './agents/layoutText'

export type NormalizedDocument = NormalizedPick & {
  /** Source kind */
  kind: 'image' | 'pdf-text' | 'pdf-scan'
  /** Embedded text from a digital PDF (skip camera OCR when rich enough) */
  embeddedText?: string
  /** Layout-reconstructed lines (Y-grouped) for accurate invoice parse */
  layoutLines?: LayoutLine[]
  /** How many PDF pages were used */
  pageCount?: number
  /**
   * One JPEG per PDF page at OCR-friendly resolution.
   * Pipeline OCRs each page separately then merges — avoids crushing a tall
   * multi-page stitch (and cutting off prices on page 2).
   */
  pageBlobs?: Blob[]
  fileName?: string
}

const PDF_EXT = /\.pdf$/i
const MAX_PDF_PAGES = 4
/** Scale for PDF→canvas (≈ 144–192 dpi-ish for letter width) */
const PDF_RENDER_SCALE = 2.25
/** Per-page long edge for OCR (do not crush multi-page into 1600px total height) */
const PDF_PAGE_OCR_MAX_EDGE = 2200
/** Preview stitch long edge — full document, user can scroll */
const PDF_PREVIEW_MAX_EDGE = 2000

export function looksLikePdfFile(file: File | Blob, nameHint = ''): boolean {
  const type = (file.type || '').toLowerCase()
  if (type === 'application/pdf' || type === 'application/x-pdf') return true
  const name = nameHint || (file instanceof File ? file.name : '') || ''
  if (PDF_EXT.test(name)) return true
  return false
}

/** True for anything the scan screen accepts (photo or PDF invoice). */
export function looksLikeScanFile(file: File | Blob, nameHint = ''): boolean {
  return looksLikePdfFile(file, nameHint) || looksLikeImageFile(file, nameHint)
}

function isEmbeddedTextUseful(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 40) return false
  // Need money-like tokens OR total/invoice structure
  const money = (t.match(/\d+[.,]\d{2}/g) || []).length
  const hasInvoiceWords =
    /\b(invoice|total|amount\s+due|subtotal|tax|bill|receipt|qty|quantity|order\s+summary|grand\s+total)\b/i.test(
      t,
    )
  // Brand – Product catalog lines (Amazon / marketplace PDFs)
  const brandLines = (text.match(/^[A-Z][A-Za-z0-9&.']{2,20}\s*[-–]\s*[A-Za-z]/gm) || [])
    .length
  // Prefer structured docs; scoreOcrText also works on plain text dumps
  return (
    (money >= 1 && hasInvoiceWords) ||
    money >= 2 ||
    scoreOcrText(t) >= 25 ||
    (brandLines >= 2 && money >= 1)
  )
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist')
  // Vite: worker as URL so Android WebView can load it
  const workerUrl = (
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  ).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode page image'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Render PDF pages to a single vertical JPEG (for OCR + preview).
 * Also collect embedded text when available.
 */
async function openPdfDocument(
  file: File | Blob,
  name: string,
): Promise<{
  embeddedText: string
  layoutLines: LayoutLine[]
  pageBlobs: Blob[]
  pageCount: number
  width: number
  height: number
  previewBlob: Blob
  ocrPrimary: Blob
}> {
  const pdfjs = await loadPdfJs()
  const data = await readFileAsArrayBuffer(file)
  // pdf.js wants a copy — some Android streams are detached after read
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    // Don't fetch remote fonts/cmaps over network if avoidable
    useSystemFonts: true,
    disableFontFace: false,
  })
  const pdf = await loadingTask.promise
  const pageCount = Math.min(pdf.numPages || 1, MAX_PDF_PAGES)

  const textParts: string[] = []
  const allGlyphs: TextGlyph[] = []
  const pageCanvases: HTMLCanvasElement[] = []
  let maxW = 0
  let totalH = 0
  let yOffset = 0

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1 })

    // Text layer with positions (digital invoices — critical for structure)
    try {
      const content = await page.getTextContent()
      const glyphs: TextGlyph[] = []
      for (const raw of content.items) {
        const it = raw as {
          str?: string
          transform?: number[]
          width?: number
          height?: number
        }
        if (!it.str?.trim() || !it.transform) continue
        // transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
        const x = it.transform[4] ?? 0
        const y = (it.transform[5] ?? 0) + yOffset
        glyphs.push({
          str: it.str,
          x,
          y,
          w: it.width,
          h: it.height,
        })
      }
      allGlyphs.push(...glyphs)
      const pageLines = linesFromGlyphs(glyphs)
      const pageText = pageLines.map((l) => l.text).join('\n')
      if (pageText.trim()) textParts.push(pageText)
      // Also keep a flat fallback if layout empty
      if (!pageText.trim()) {
        const flat = content.items
          .map((it) => ('str' in it ? String((it as { str?: string }).str || '') : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (flat) textParts.push(flat)
      }
    } catch {
      /* scan-only PDF */
    }
    yOffset += baseViewport.height + 24

    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable for PDF page')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
    } as Parameters<typeof page.render>[0])
    await renderTask.promise
    pageCanvases.push(canvas)
    maxW = Math.max(maxW, canvas.width)
    totalH += canvas.height
  }

  // Per-page JPEG for OCR (high res each page — prices live in the right column)
  async function canvasToPageOcrBlob(c: HTMLCanvasElement): Promise<Blob> {
    const long = Math.max(c.width, c.height)
    if (long <= PDF_PAGE_OCR_MAX_EDGE) return canvasToJpegBlob(c)
    const scale = PDF_PAGE_OCR_MAX_EDGE / long
    const resized = document.createElement('canvas')
    resized.width = Math.max(1, Math.round(c.width * scale))
    resized.height = Math.max(1, Math.round(c.height * scale))
    const rctx = resized.getContext('2d')
    if (!rctx) return canvasToJpegBlob(c)
    rctx.imageSmoothingEnabled = true
    rctx.imageSmoothingQuality = 'high'
    rctx.drawImage(c, 0, 0, resized.width, resized.height)
    return canvasToJpegBlob(resized)
  }
  const pageBlobs: Blob[] = []
  for (const c of pageCanvases) {
    pageBlobs.push(await canvasToPageOcrBlob(c))
  }

  // Full-document stitch for preview + single-blob fallback (user must see ALL pages)
  const stitch = document.createElement('canvas')
  const maxStitchH = 12_000
  const scaleDown = totalH > maxStitchH ? maxStitchH / totalH : 1
  stitch.width = Math.max(1, Math.round(maxW * scaleDown))
  stitch.height = Math.max(1, Math.round(totalH * scaleDown))
  const sctx = stitch.getContext('2d')
  if (!sctx) throw new Error('Canvas unavailable for PDF stitch')
  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, stitch.width, stitch.height)
  let y = 0
  for (const c of pageCanvases) {
    const dw = Math.round(c.width * scaleDown)
    const dh = Math.round(c.height * scaleDown)
    sctx.drawImage(c, 0, y, dw, dh)
    y += dh
  }

  let previewCanvas = stitch
  const long = Math.max(stitch.width, stitch.height)
  if (long > PDF_PREVIEW_MAX_EDGE) {
    const scale = PDF_PREVIEW_MAX_EDGE / long
    const resized = document.createElement('canvas')
    resized.width = Math.max(1, Math.round(stitch.width * scale))
    resized.height = Math.max(1, Math.round(stitch.height * scale))
    const rctx = resized.getContext('2d')
    if (rctx) {
      rctx.imageSmoothingEnabled = true
      rctx.imageSmoothingQuality = 'high'
      rctx.drawImage(stitch, 0, 0, resized.width, resized.height)
      previewCanvas = resized
    }
  }

  const previewBlob = await canvasToJpegBlob(previewCanvas)
  // OCR blob = first page (pipeline also gets pageBlobs for multi-page merge)
  const ocrPrimary = pageBlobs[0] || previewBlob

  void name
  const layoutLines = allGlyphs.length ? linesFromGlyphs(allGlyphs, 4) : []
  // Prefer layout-reconstructed full text when we have enough lines
  const embeddedText =
    layoutLines.length >= 3
      ? layoutLines.map((l) => l.text).join('\n')
      : textParts.join('\n\n')

  return {
    embeddedText,
    layoutLines,
    pageBlobs,
    pageCount,
    width: previewCanvas.width,
    height: previewCanvas.height,
    previewBlob,
    ocrPrimary,
  }
}

/**
 * Open a camera photo, gallery image, or PDF invoice into a scan-ready form.
 */
export async function normalizePickedDocument(
  file: File | Blob,
  opts?: { name?: string },
): Promise<NormalizedDocument> {
  const name = opts?.name || (file instanceof File ? file.name : '') || ''

  if (file.size <= 0) {
    throw new Error(
      'That file is empty or still downloading. Wait for it to finish, then try again.',
    )
  }

  // Size guard (~40 MB) — huge PDFs will crash WebView
  if (file.size > 40 * 1024 * 1024) {
    throw new Error('That file is too large (max ~40 MB). Try a smaller PDF or a photo.')
  }

  if (looksLikePdfFile(file, name)) {
    try {
      const pdf = await openPdfDocument(file, name)
      const usefulText = isEmbeddedTextUseful(pdf.embeddedText)
      // OCR blob = first page; multi-page goes through pageBlobs in the pipeline
      const imageBlob = pdf.ocrPrimary || pdf.pageBlobs[0] || pdf.previewBlob
      let dataUrl: string | undefined
      try {
        const du = await blobToDataUrl(pdf.previewBlob)
        if (du.length <= SAFE_DATA_URL_CHARS) dataUrl = du
      } catch {
        /* optional */
      }
      return {
        blob: imageBlob,
        previewUrl: URL.createObjectURL(pdf.previewBlob),
        dataUrl,
        name,
        path: 'canvas',
        width: pdf.width,
        height: pdf.height,
        kind: usefulText ? 'pdf-text' : 'pdf-scan',
        // Always keep embedded text when present so OCR scans can merge it for prices
        embeddedText: pdf.embeddedText?.trim() ? pdf.embeddedText : undefined,
        layoutLines: pdf.layoutLines?.length ? pdf.layoutLines : undefined,
        pageCount: pdf.pageCount,
        pageBlobs: pdf.pageBlobs.length > 1 ? pdf.pageBlobs : undefined,
        fileName: name,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not open PDF'
      throw new Error(
        msg.includes('password') || msg.includes('Password')
          ? 'That PDF is password-protected. Export or print it without a password, then upload again.'
          : `Could not open that PDF invoice. ${msg}`,
      )
    }
  }

  // Photos / image files
  if (!looksLikeImageFile(file, name)) {
    throw new Error(
      'Please choose a photo or a PDF invoice (JPEG, PNG, or PDF).',
    )
  }

  const img = await normalizePickedImage(file, { name })
  return {
    ...img,
    kind: 'image',
    fileName: name,
  }
}
