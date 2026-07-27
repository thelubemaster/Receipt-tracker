import { jsPDF } from 'jspdf'
import { getCategory } from './categories'
import { formatMoney, sumAmounts } from './money'
import type { Purchase } from './types'

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function purchasesToCsv(purchases: Purchase[]): string {
  const header = [
    'date',
    'vendor',
    'description',
    'category',
    'amount',
    'notes',
    'has_receipt',
  ]
  const rows = purchases.map((p) =>
    [
      p.date,
      p.vendor,
      p.description,
      getCategory(p.categoryId).label,
      p.amount.toFixed(2),
      p.notes,
      p.receiptImageId ? 'yes' : 'no',
    ]
      .map((v) => csvEscape(String(v)))
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(purchases: Purchase[], projectName: string) {
  const safe = projectName.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'schoolie'
  const stamp = new Date().toISOString().slice(0, 10)
  downloadTextFile(
    `${safe}-purchases-${stamp}.csv`,
    purchasesToCsv(purchases),
    'text/csv;charset=utf-8',
  )
}

export function downloadPdfSummary(purchases: Purchase[], projectName: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 48
  let y = margin
  const pageWidth = doc.internal.pageSize.getWidth()
  const maxWidth = pageWidth - margin * 2

  const total = sumAmounts(purchases.map((p) => p.amount))
  const byCat = new Map<string, number>()
  for (const p of purchases) {
    const label = getCategory(p.categoryId).label
    byCat.set(label, (byCat.get(label) ?? 0) + p.amount)
  }

  doc.setFontSize(18)
  doc.text(`${projectName} — Cost Summary`, margin, y)
  y += 28
  doc.setFontSize(11)
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y)
  y += 18
  doc.setFontSize(14)
  doc.text(`Total spent: ${formatMoney(total)}`, margin, y)
  y += 24

  doc.setFontSize(12)
  doc.text('By category', margin, y)
  y += 16
  doc.setFontSize(10)
  const catLines = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, amt]) => `${label}: ${formatMoney(amt)}`)
  for (const line of catLines) {
    if (y > 720) {
      doc.addPage()
      y = margin
    }
    doc.text(line, margin, y)
    y += 14
  }

  y += 12
  if (y > 700) {
    doc.addPage()
    y = margin
  }
  doc.setFontSize(12)
  doc.text('Purchases', margin, y)
  y += 16
  doc.setFontSize(9)

  for (const p of purchases) {
    if (y > 720) {
      doc.addPage()
      y = margin
    }
    const cat = getCategory(p.categoryId).label
    const line = `${p.date}  ${formatMoney(p.amount)}  ${p.vendor || '—'}  ${p.description}  [${cat}]`
    const wrapped = doc.splitTextToSize(line, maxWidth)
    doc.text(wrapped, margin, y)
    y += wrapped.length * 12 + 4
  }

  const safe = projectName.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'schoolie'
  const stamp = new Date().toISOString().slice(0, 10)
  doc.save(`${safe}-summary-${stamp}.pdf`)
}
