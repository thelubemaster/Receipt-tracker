import { useId } from 'react'
import { APP_NAME, APP_TAGLINE } from './brand'

/** Project Cost Tracker mark — receipt + check, unique gradient ids per instance. */
export function LogoMark({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const bg = `bg-${uid}`
  const paper = `paper-${uid}`
  const accent = `accent-${uid}`

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
          <stop stopColor="#1a2830" />
          <stop offset="1" stopColor="#0c1216" />
        </linearGradient>
        <linearGradient id={paper} x1="18" y1="10" x2="46" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <linearGradient id={accent} x1="40" y1="40" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14.5"
        stroke="rgba(45,212,191,0.28)"
        strokeWidth="1.2"
      />
      {/* receipt */}
      <path
        d="M20 12h24a3 3 0 0 1 3 3v36.5c0 .6-.7.9-1.1.5l-2.4-2.2-2.4 2.2c-.4.4-1.1.1-1.1-.5V15a3 3 0 0 0-3-3H20a3 3 0 0 0-3 3v34.5c0 .6.7.9 1.1.5l2.4-2.2 2.4 2.2c.4.4 1.1.1 1.1-.5V15a3 3 0 0 1 3-3z"
        fill={`url(#${paper})`}
      />
      <path
        d="M24 24h16M24 31h14M24 38h10"
        stroke="#e8f7f5"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* check badge */}
      <circle cx="44" cy="46" r="11" fill={`url(#${accent})`} />
      <path
        d="M39.5 46.2l3 3 6.5-7.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
