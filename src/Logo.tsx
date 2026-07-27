/** Brand mark — works as inline logo without network. */
export function LogoMark({ size = 40 }: { size?: number }) {
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
        <linearGradient id="busBody" x1="8" y1="18" x2="56" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0C36A" />
          <stop offset="0.55" stopColor="#E8A54B" />
          <stop offset="1" stopColor="#C47A28" />
        </linearGradient>
        <linearGradient id="busRoof" x1="12" y1="14" x2="52" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6DFA8" />
          <stop offset="1" stopColor="#D4923A" />
        </linearGradient>
        <linearGradient id="bgGlow" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2A3348" />
          <stop offset="1" stopColor="#151922" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#bgGlow)" />
      <rect x="2" y="2" width="60" height="60" rx="14" stroke="rgba(240,195,106,0.25)" strokeWidth="1" />
      {/* roof */}
      <path
        d="M14 24c0-3 2.5-5 6-5h24c3.5 0 6 2 6 5v2H14v-2z"
        fill="url(#busRoof)"
      />
      {/* body */}
      <rect x="10" y="24" width="44" height="22" rx="5" fill="url(#busBody)" />
      {/* windows */}
      <rect x="15" y="28" width="9" height="8" rx="1.5" fill="#1A2233" opacity="0.9" />
      <rect x="27.5" y="28" width="9" height="8" rx="1.5" fill="#1A2233" opacity="0.9" />
      <rect x="40" y="28" width="9" height="8" rx="1.5" fill="#1A2233" opacity="0.85" />
      {/* stripe */}
      <rect x="12" y="39" width="40" height="2.5" rx="1" fill="#1A2233" opacity="0.35" />
      {/* wheels */}
      <circle cx="20" cy="48" r="5" fill="#0E121A" />
      <circle cx="20" cy="48" r="2.2" fill="#9AA3B5" />
      <circle cx="44" cy="48" r="5" fill="#0E121A" />
      <circle cx="44" cy="48" r="2.2" fill="#9AA3B5" />
      {/* highlight */}
      <path
        d="M16 26h28c1 0 2 .5 2 1.2 0 0-8-1-16-1s-16 1-16 1c0-.7 1-1.2 2-1.2z"
        fill="white"
        opacity="0.22"
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
      <LogoMark size={44} />
      <div className="brand-text">
        <h1>{title}</h1>
        {subtitle ? <div className="brand-sub">{subtitle}</div> : null}
      </div>
    </div>
  )
}
