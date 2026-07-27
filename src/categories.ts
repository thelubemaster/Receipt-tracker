import type { CategoryId } from './types'

export interface Category {
  id: CategoryId
  label: string
  color: string
}

export const CATEGORIES: Category[] = [
  { id: 'structure', label: 'Structure & Body', color: '#c45c26' },
  { id: 'insulation', label: 'Insulation', color: '#6b8f71' },
  { id: 'electrical', label: 'Electrical', color: '#e6b422' },
  { id: 'solar', label: 'Solar & Power', color: '#f0a202' },
  { id: 'plumbing', label: 'Plumbing', color: '#3d7ea6' },
  { id: 'propane', label: 'Propane & Heat', color: '#d94f30' },
  { id: 'interior', label: 'Interior Buildout', color: '#8b6f47' },
  { id: 'kitchen', label: 'Kitchen', color: '#b5651d' },
  { id: 'bathroom', label: 'Bathroom', color: '#5b8fa8' },
  { id: 'flooring', label: 'Flooring', color: '#7a5c45' },
  { id: 'windows', label: 'Windows & Doors', color: '#4a90a4' },
  { id: 'furniture', label: 'Furniture', color: '#9c6644' },
  { id: 'tools', label: 'Tools & Supplies', color: '#5c6b73' },
  { id: 'safety', label: 'Safety', color: '#c0392b' },
  { id: 'fuel', label: 'Fuel & Travel', color: '#2c3e50' },
  { id: 'misc', label: 'Misc', color: '#7f8c8d' },
]

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id)

export function getCategory(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]
}

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORY_IDS.includes(value as CategoryId)
}
