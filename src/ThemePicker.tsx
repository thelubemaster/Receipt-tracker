/**
 * Shared theme swatch grid (Settings default + per-project).
 */
import { THEMES, type ThemeId } from './themes'

export function ThemePicker(props: {
  value: ThemeId
  onChange: (id: ThemeId) => void
  /** Extra class on the grid */
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      className={`theme-grid${props.className ? ` ${props.className}` : ''}`}
      role="listbox"
      aria-label={props.ariaLabel || 'Themes'}
    >
      {THEMES.map((t) => {
        const active = props.value === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="option"
            aria-selected={active}
            className={`theme-option${active ? ' theme-option-active' : ''}`}
            onClick={() => props.onChange(t.id)}
          >
            <div className="theme-swatch" aria-hidden>
              <span style={{ background: t.preview[0] }} />
              <span style={{ background: t.preview[1] }} />
              <span style={{ background: t.preview[2] }} />
            </div>
            <div className="theme-option-meta">
              <strong>{t.name}</strong>
              <span>{t.blurb}</span>
              {active ? <span className="theme-option-check">Selected</span> : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}
