import { useId } from 'react'
import { APP_NAME, APP_TAGLINE } from './brand'

/**
 * Project Cost Tracker mark — geometric “cost peak”.
 * Bold ascending bars + trajectory line into a hard peak.
 * Reads at 24px, works as a home-screen icon.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const bg = `bg-${uid}`
  const peak = `peak-${uid}`
  const bar = `bar-${uid}`
  const glow = `glow-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="logo-mark"
    >
      <defs>
        <linearGradient id={bg} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#141a28" />
          <stop offset="0.55" stopColor="#0b101a" />
          <stop offset="1" stopColor="#070a10" />
        </linearGradient>
        <linearGradient id={peak} x1="14" y1="48" x2="52" y2="14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="0.45" stopColor="#5eead4" />
          <stop offset="0.78" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
        <linearGradient id={bar} x1="18" y1="50" x2="18" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f766e" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
        <radialGradient id={glow} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(46 18) rotate(90) scale(16)">
          <stop stopColor="#fb923c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* App tile */}
      <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
      <rect
        x="1.25"
        y="1.25"
        width="61.5"
        height="61.5"
        rx="13.75"
        stroke="rgba(94,234,212,0.22)"
        strokeWidth="1.5"
      />

      {/* Soft ambient glow top-right */}
      <circle cx="46" cy="18" r="16" fill={`url(#${glow})`} />

      {/* Base rail */}
      <path
        d="M12 48.5h40"
        stroke="rgba(148,163,184,0.28)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Ascending bars — project stacks / spend */}
      <rect x="14" y="36" width="7" height="12.5" rx="2" fill={`url(#${bar})`} opacity="0.75" />
      <rect x="24" y="30" width="7" height="18.5" rx="2" fill="#2dd4bf" opacity="0.9" />
      <rect x="34" y="23" width="7" height="25.5" rx="2" fill="#5eead4" />

      {/* Trajectory peak line */}
      <path
        d="M13 42.5 L22 36.5 L31.5 28.5 L41 18.5 L50 12"
        stroke={`url(#${peak})`}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Highlight on line */}
      <path
        d="M14 42 L22.5 36 L32 28 L41.5 18.5"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Peak node */}
      <circle cx="50" cy="12" r="5.2" fill="#fb923c" />
      <circle cx="50" cy="12" r="5.2" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <circle cx="48.6" cy="10.8" r="1.5" fill="rgba(255,255,255,0.65)" />
    </svg>
  )
}

export function BrandLockup({
  title = APP_NAME,
  subtitle = APP_TAGLINE,
  size = 40,
}: {
  title?: string
  subtitle?: string
  size?: number
}) {
  return (
    <div className="brand-lockup">
      <LogoMark size={size} />
      <div className="brand-text">
        <div className="brand-title">{title}</div>
        {subtitle ? <div className="brand-sub">{subtitle}</div> : null}
      </div>
    </div>
  )
}
