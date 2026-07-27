import { useId } from 'react'

/** Premium schoolie bus mark — unique gradient ids per instance. */
export function LogoMark({ size = 40 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  const body = `busBody-${uid}`
  const roof = `busRoof-${uid}`
  const bg = `bgGlow-${uid}`
  const shine = `shine-${uid}`

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
          <stop stopColor="#2C3548" />
          <stop offset="0.55" stopColor="#171C28" />
          <stop offset="1" stopColor="#0E121A" />
        </linearGradient>
        <linearGradient id={body} x1="10" y1="22" x2="54" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFE0A0" />
          <stop offset="0.4" stopColor="#F0C36A" />
          <stop offset="0.75" stopColor="#E8A54B" />
          <stop offset="1" stopColor="#B8732A" />
        </linearGradient>
        <linearGradient id={roof} x1="14" y1="16" x2="50" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF3D6" />
          <stop offset="1" stopColor="#E0A84A" />
        </linearGradient>
        <linearGradient id={shine} x1="16" y1="24" x2="48" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <rect
        x="1.5"
        y="1.5"
        width="61"
        height="61"
        rx="14.5"
        stroke="rgba(240,195,106,0.35)"
        strokeWidth="1.2"
      />

      {/* soft glow behind bus */}
      <ellipse cx="32" cy="40" rx="22" ry="10" fill="rgba(232,165,75,0.12)" />

      {/* roof / windshield area */}
      <path
        d="M13 25c0-3.2 2.8-5.5 6.5-5.5h25c3.7 0 6.5 2.3 6.5 5.5v2.5H13V25z"
        fill={`url(#${roof})`}
      />

      {/* body */}
      <rect x="9" y="24.5" width="46" height="23" rx="5.5" fill={`url(#${body})`} />

      {/* windows */}
      <rect x="14" y="28" width="9.5" height="8.5" rx="1.8" fill="#121826" />
      <rect x="27.25" y="28" width="9.5" height="8.5" rx="1.8" fill="#121826" />
      <rect x="40.5" y="28" width="9.5" height="8.5" rx="1.8" fill="#121826" opacity="0.95" />
      {/* window highlights */}
      <rect x="15" y="29" width="3" height="6" rx="1" fill="rgba(255,255,255,0.08)" />
      <rect x="28.25" y="29" width="3" height="6" rx="1" fill="rgba(255,255,255,0.08)" />

      {/* body stripe */}
      <rect x="11" y="39.5" width="42" height="2.2" rx="1" fill="#1A2233" opacity="0.32" />

      {/* front bumper hint */}
      <rect x="50.5" y="34" width="3.5" height="8" rx="1" fill="#C4842E" opacity="0.7" />

      {/* wheels */}
      <circle cx="20" cy="48.5" r="5.2" fill="#0A0D14" />
      <circle cx="20" cy="48.5" r="2.4" fill="#A8B0C0" />
      <circle cx="20" cy="48.5" r="1" fill="#0A0D14" />
      <circle cx="44" cy="48.5" r="5.2" fill="#0A0D14" />
      <circle cx="44" cy="48.5" r="2.4" fill="#A8B0C0" />
      <circle cx="44" cy="48.5" r="1" fill="#0A0D14" />

      {/* roof shine */}
      <path
        d="M16 25.5h28c1.2 0 2.2.6 2.2 1.3 0 0-8-1.1-16.1-1.1S14 26.8 14 26.8c0-.7 1-1.3 2-1.3z"
        fill={`url(#${shine})`}
      />
    </svg>
  )
}

export function BrandLockup({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="brand-lockup">
      <LogoMark size={46} />
      <div className="brand-text">
        <h1>{title}</h1>
        {subtitle ? <div className="brand-sub">{subtitle}</div> : null}
      </div>
    </div>
  )
}
