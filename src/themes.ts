/**
 * App color themes. Applied via data-theme on <html>.
 * Full palettes live in index.css under [data-theme="…"].
 */

export type ThemeId =
  | 'midnight-teal'
  | 'copper-shop'
  | 'ocean-depth'
  | 'pine-cabin'
  | 'ember-night'
  | 'lavender-dusk'
  | 'neon-violet'
  | 'paper-day'
  | 'arctic-day'
  | 'blueprint'

export type ThemeDef = {
  id: ThemeId
  name: string
  /** One-line vibe for Settings */
  blurb: string
  /** dark | light — for color-scheme / status bar feel */
  mode: 'dark' | 'light'
  /** Solid status bar / splash chrome color */
  statusBar: string
  /** Swatch colors for the picker (bg, card, accent) */
  preview: [string, string, string]
}

export const DEFAULT_THEME_ID: ThemeId = 'midnight-teal'

export const THEMES: ThemeDef[] = [
  {
    id: 'midnight-teal',
    name: 'Midnight Teal',
    blurb: 'Original dark look with teal accents',
    mode: 'dark',
    statusBar: '#0c0e13',
    preview: ['#0c0e13', '#1c212d', '#2dd4bf'],
  },
  {
    id: 'copper-shop',
    name: 'Copper Shop',
    blurb: 'Warm workshop amber & bronze',
    mode: 'dark',
    statusBar: '#120e0a',
    preview: ['#120e0a', '#241c14', '#e8a54b'],
  },
  {
    id: 'ocean-depth',
    name: 'Ocean Depth',
    blurb: 'Deep navy with sea blue',
    mode: 'dark',
    statusBar: '#070b14',
    preview: ['#070b14', '#121a2b', '#3b82f6'],
  },
  {
    id: 'pine-cabin',
    name: 'Pine Cabin',
    blurb: 'Forest greens & moss',
    mode: 'dark',
    statusBar: '#0a100c',
    preview: ['#0a100c', '#152019', '#4ade80'],
  },
  {
    id: 'ember-night',
    name: 'Ember Night',
    blurb: 'Charcoal with hot coral',
    mode: 'dark',
    statusBar: '#100a0b',
    preview: ['#100a0b', '#221416', '#f97316'],
  },
  {
    id: 'lavender-dusk',
    name: 'Lavender Dusk',
    blurb: 'Soft purple evening light',
    mode: 'dark',
    statusBar: '#100e16',
    preview: ['#100e16', '#1e1830', '#c084fc'],
  },
  {
    id: 'neon-violet',
    name: 'Neon Violet',
    blurb: 'Electric magenta nights',
    mode: 'dark',
    statusBar: '#0a0612',
    preview: ['#0a0612', '#180f28', '#e879f9'],
  },
  {
    id: 'paper-day',
    name: 'Paper Day',
    blurb: 'Cream paper, ink, and copper',
    mode: 'light',
    statusBar: '#f6f1e8',
    preview: ['#f6f1e8', '#ffffff', '#c2410c'],
  },
  {
    id: 'arctic-day',
    name: 'Arctic Day',
    blurb: 'Clean light gray & sky blue',
    mode: 'light',
    statusBar: '#eef2f7',
    preview: ['#eef2f7', '#ffffff', '#0284c7'],
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'Classic blueprint blue & white lines',
    mode: 'dark',
    statusBar: '#0a1628',
    preview: ['#0a1628', '#122a4a', '#7dd3fc'],
  },
]

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value)
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID
}

export function getTheme(id: ThemeId | unknown): ThemeDef {
  const normalized = normalizeThemeId(id)
  return THEMES.find((t) => t.id === normalized) ?? THEMES[0]!
}

const LS_HOME_THEME = 'schoolie-home-theme'
/** @deprecated legacy key — only used as boot fallback */
const LS_LEGACY_THEME = 'schoolie-theme'

export type ApplyThemeOptions = {
  /**
   * When true, persist as the Home Screen theme only.
   * Project theme previews must NOT set this — home stays independent.
   */
  persistHome?: boolean
}

/** Apply theme to the document (instant UI change). */
export function applyTheme(
  id: ThemeId | unknown,
  options?: ApplyThemeOptions,
): ThemeId {
  const themeId = normalizeThemeId(id)
  const theme = getTheme(themeId)
  const root = document.documentElement
  root.setAttribute('data-theme', themeId)
  root.style.colorScheme = theme.mode
  if (options?.persistHome) {
    try {
      localStorage.setItem(LS_HOME_THEME, themeId)
      // Keep legacy key in sync for older code paths
      localStorage.setItem(LS_LEGACY_THEME, themeId)
    } catch {
      /* ignore */
    }
  }
  // Best-effort Android status bar match (no await — fire and forget)
  void syncNativeChrome(theme)
  return themeId
}

async function syncNativeChrome(theme: ThemeDef): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setBackgroundColor({ color: theme.statusBar })
    await StatusBar.setStyle({
      style: theme.mode === 'light' ? Style.Light : Style.Dark,
    })
  } catch {
    /* browser / plugin missing */
  }
}

/** Home Screen theme from localStorage (before settings DB loads). */
export function readCachedHomeThemeId(): ThemeId {
  try {
    const home = localStorage.getItem(LS_HOME_THEME)
    if (home) return normalizeThemeId(home)
    // One-time migrate from legacy single-theme key
    return normalizeThemeId(localStorage.getItem(LS_LEGACY_THEME))
  } catch {
    return DEFAULT_THEME_ID
  }
}

/** @deprecated use readCachedHomeThemeId */
export function readCachedThemeId(): ThemeId {
  return readCachedHomeThemeId()
}

/** Home Screen theme from Settings. */
export function homeThemeId(settingsThemeId: string | null | undefined): ThemeId {
  return normalizeThemeId(settingsThemeId)
}

/**
 * Theme for a project — always that project’s own id.
 * Does NOT follow the home theme (missing → default, not Settings).
 */
export function projectThemeId(projectTheme: string | null | undefined): ThemeId {
  return normalizeThemeId(projectTheme)
}

/**
 * @deprecated Prefer projectThemeId / homeThemeId so home and projects stay separate.
 * Kept for call sites that need “project if set, else home”.
 */
export function resolveThemeId(
  projectTheme: string | null | undefined,
  appThemeId: string | null | undefined,
): ThemeId {
  if (projectTheme && isThemeId(projectTheme)) return projectTheme
  return normalizeThemeId(appThemeId)
}
