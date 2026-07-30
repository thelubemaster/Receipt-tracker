import { useId } from 'react'
import { APP_NAME, APP_TAGLINE } from './brand'

/**
 * Project Cost Tracker mark — project folder + receipt + check.
 * (Replaces the old school-bus logo.)
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const bg = `bg-${uid}`
  const paper = `paper-${uid}`
  const accent = `accent-${uid}`
  const folder = `folder-${uid}`

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
          <stop stopColor="#1a222c" />
          <stop offset="1" stopColor="#0c0e13" />
        </linearGradient>
        <linearGradient id={folder} x1="12" y1="16" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2a3846" />
          <stop offset="1" stopColor="#1a2630" />
        </linearGradient>
        <linearGradient id={paper} x1="22" y1="16" x2="42" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <linearGradient id={accent} x1="40" y1="40" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
      </defs>

      {/* app tile */}
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

      {/* project folder */}
      <path
        d="M14 22h14c1.2 0 1.8.4 2.4 1.2L32 26h18a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V25a3 3 0 0 1 3-3z"
        fill={`url(#${folder})`}
      />
      <rect x="13" y="28" width="38" height="22" rx="3" fill="#121a22" opacity="0.55" />

      {/* multi-project dots */}
      <circle cx="38" cy="24.5" r="1.6" fill="#5b9fd4" />
      <circle cx="42.5" cy="24.5" r="1.6" fill="#5cb88a" />
      <circle cx="47" cy="24.5" r="1.6" fill="#e8a54b" />

      {/* receipt */}
      <path
        d="M22 18h16a2.5 2.5 0 0 1 2.5 2.5V46c0 .55-.62.84-1.02.48l-1.9-1.7-1.9 1.7c-.4.36-1.02.07-1.02-.48v-2.2c0-.55-.45-1-1-1h-8.7c-.55 0-1 .45-1 1V46c0 .55-.62.84-1.02.48l-1.9-1.7-1.9 1.7c-.4.36-1.02.07-1.02-.48V20.5A2.5 2.5 0 0 1 22 18z"
        fill={`url(#${paper})`}
      />
      {/* fold corner */}
      <path d="M37.5 18L40.5 21H37.5V18z" fill="#0d5c56" opacity="0.55" />
      {/* lines */}
      <path
        d="M25.5 27h11M25.5 32.5h9.5M25.5 38h7.5"
        stroke="#e8f7f5"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.92"
      />
      {/* total bar */}
      <rect x="25.5" y="43" width="9" height="2.2" rx="1" fill="rgba(8,30,28,0.45)" />

      {/* check badge */}
      <circle cx="44" cy="45" r="10.5" fill={`url(#${accent})`} />
      <path
        d="M39.6 45.2l2.9 2.9 6.2-7.1"
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
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
