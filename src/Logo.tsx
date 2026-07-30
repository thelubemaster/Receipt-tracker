import { useId } from 'react'
import { APP_NAME, APP_TAGLINE } from './brand'

/**
 * Project Cost Tracker mark — infinity path (cost cycle) rising to a peak.
 * Drastic redesign: not a bus, folder, or receipt.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const bg = `bg-${uid}`
  const ribbon = `ribbon-${uid}`
  const coin = `coin-${uid}`

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
        <linearGradient id={bg} x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#152033" />
          <stop offset="1" stopColor="#0a0e16" />
        </linearGradient>
        <linearGradient id={ribbon} x1="10" y1="40" x2="54" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ccfbf1" />
          <stop offset="0.35" stopColor="#5eead4" />
          <stop offset="0.7" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <linearGradient id={coin} x1="14" y1="28" x2="28" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8fafc" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
        <filter id={`g-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14.5"
        stroke="rgba(45,212,191,0.2)"
        strokeWidth="1.2"
      />

      {/* infinity ribbon (horizontal figure-8, right side lifted) */}
      <g filter={`url(#g-${uid})`}>
        <path
          d="M12 36c0-7.5 6-12.5 13.5-11.5 5 .7 8 4.2 10.5 7.2 2.2-3.5 6-8.2 12.5-9 8.5-1 15 4.8 14.2 13-.7 6.5-6.2 10.8-12.8 10.2-5.2-.5-8.2-3.8-10.6-6.8-2.2 3.2-5.8 6.5-11.2 7C17 47 12 42.5 12 36z"
          fill="none"
          stroke={`url(#${ribbon})`}
          strokeWidth="6.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.95"
        />
        {/* inner highlight stripe */}
        <path
          d="M16 35.5c1.2-5.5 5.8-8.8 11-8 4 .5 6.5 3.5 8.8 6.2"
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>

      {/* coin edge on left loop */}
      <path
        d="M15.5 31.5c-1.2 1.5-1.8 3.2-1.8 5 0 5.2 3.8 8.8 9 8.8"
        fill="none"
        stroke={`url(#${coin})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M15 33.5h-2.6M14.2 37h-2.8M15 40.5h-2.4"
        stroke="rgba(226,232,240,0.55)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />

      {/* rising peak node */}
      <circle cx="49" cy="16.5" r="6.5" fill="rgba(251,113,133,0.22)" />
      <circle cx="49" cy="16.5" r="4.4" fill="#fb923c" />
      <circle cx="47.8" cy="15.3" r="1.4" fill="rgba(255,255,255,0.5)" />
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
