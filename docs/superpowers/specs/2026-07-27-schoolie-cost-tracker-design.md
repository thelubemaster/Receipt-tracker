# Schoolie Cost Tracker — Design Spec

**Date:** 2026-07-27  
**Status:** Approved for implementation (user: “do it”)  
**Scope:** Standalone app — separate from any other project in the workspace

## Problem

You are converting **one** school bus into a **schoolie** (livable conversion). You need a phone-friendly way to track every purchase for that build, see total spend and category breakdown, and log purchases by photographing receipts so the app suggests date, store, total, description, and category for you to confirm.

## Goals

1. Track all money spent on a single schoolie conversion project.
2. Log purchases with full detail: date, description, amount, category, vendor, notes, receipt photo.
3. Home screen: running total, spend by category, recent purchases.
4. Receipt scan: photo → OCR/AI parse → **suggest & confirm** → save.
5. Phone-first (installable PWA), data on device, easy **CSV** and **PDF** export backup.
6. No multi-bus fleet features. No account/cloud sync in v1.

## Non-goals (v1)

- Multiple buses or projects
- Cloud sync / multi-device login
- Budgets / targets
- Sharing with collaborators
- App Store / Play Store native packaging

## Users

Single owner-builder on a phone (primary), occasionally desktop for export/review.

## Product surface

### Home

- Project title: “My Schoolie” (editable later if needed; fixed label OK in v1)
- **Total spent** (large)
- **Category breakdown** (bars or list with amounts and % of total)
- **Recent purchases** (newest first)
- Primary CTA: **Scan receipt**
- Secondary: **Add purchase**, **Export**, **Settings**

### Scan receipt (suggest & confirm)

1. Capture photo or pick from gallery.
2. Send image to SpaceXAI (xAI) vision for structured extraction.
3. Show review form pre-filled:
   - date
   - vendor/store
   - amount (total)
   - description (what was bought)
   - category (from schoolie set)
   - notes (optional free text from receipt)
   - receipt image preview
4. User edits any field → **Save** or **Cancel**.
5. On save: persist purchase + image; update totals.

If AI fails or no API key: show error and fall back to empty form with photo attached for manual fill.

### Manual add / edit / delete

Same fields as review form. Edit and delete from purchase detail.

### Export

- **CSV:** all purchases (no binary images; include note if receipt was attached).
- **PDF summary:** total, category breakdown, line items (date, vendor, description, category, amount).

### Settings

- SpaceXAI / xAI API key (stored only on device; never committed).
- Optional: clear all data (confirm).
- Install tip: Add to Home Screen.

## Schoolie categories (fixed starter set)

Used for filing and breakdown. AI must pick the best match; user can override.

| id | label |
|----|--------|
| structure | Structure & Body |
| insulation | Insulation |
| electrical | Electrical |
| solar | Solar & Power |
| plumbing | Plumbing |
| propane | Propane & Heat |
| interior | Interior Buildout |
| kitchen | Kitchen |
| bathroom | Bathroom |
| flooring | Flooring |
| windows | Windows & Doors |
| furniture | Furniture |
| tools | Tools & Supplies |
| safety | Safety |
| fuel | Fuel & Travel |
| misc | Misc |

## Data model

### Project (implicit singleton)

One project. No multi-project table in v1.

### Purchase

| field | type | notes |
|-------|------|--------|
| id | string (uuid) | |
| date | string (YYYY-MM-DD) | purchase date |
| description | string | what was bought |
| amount | number | USD cents or decimal dollars — use decimal dollars, 2 places |
| categoryId | string | one of category ids |
| vendor | string | store/vendor |
| notes | string | optional |
| receiptImageId | string \| null | link to stored blob |
| createdAt | string (ISO) | |
| updatedAt | string (ISO) | |

### Receipt image

Stored in IndexedDB as blob keyed by id; referenced by purchase.

### Settings

| field | type |
|-------|------|
| apiKey | string (local only) |
| projectName | string default “My Schoolie” |

## Architecture

**Stack:** Vite + React + TypeScript, mobile-first CSS, Progressive Web App (manifest + service worker for installability).

**Storage:** IndexedDB (purchases + image blobs + settings). Local-first; no backend required for core tracking.

**AI:** SpaceXAI via `https://api.x.ai/v1` (OpenAI-compatible). Vision model for receipt → JSON fields. API key from Settings, used only from the user’s browser for this personal tool. Document that key never leaves their device except to xAI.

**Receipt parse contract (JSON from model):**

```json
{
  "date": "YYYY-MM-DD or null",
  "vendor": "string",
  "amount": 0.00,
  "description": "string",
  "categoryId": "one of known ids",
  "notes": "string"
}
```

Prompt includes the fixed category list and schoolie context so categorization is conversion-aware (e.g. lumber → structure/interior, wire → electrical, foam board → insulation).

**Offline:** Browse, add/edit manually, view totals, export work offline. Scan requires network + API key.

## UI principles

- Thumb-friendly: large tap targets, sticky Scan button.
- One-hand list scrolling.
- Clear money formatting (`$1,234.56`).
- Dark-friendly, high contrast; simple “workshop / road trip” utilitarian look (not a corporate finance dashboard).

## Error handling

- Missing API key on scan → prompt to Settings.
- Network/AI failure → toast + open manual form with photo.
- Invalid amount → block save until fixed.
- Storage full → clear message; suggest export then delete old receipts if needed.

## Testing

- Unit: money formatting, category totals, CSV generation, purchase sort.
- Manual: install on phone, add purchase, scan with sample receipt image, export, reload persistence.

## Success criteria

1. On phone, open app and see total + categories + list.
2. Scan a receipt → review pre-filled fields → save → totals update.
3. Export CSV/PDF and reopen app later with data still there.
4. Zero coupling to other repos/projects in the workspace.
