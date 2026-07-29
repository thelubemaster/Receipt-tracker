import { useEffect, useState } from 'react'

/**
 * <img> that recovers from blank/broken loads (common on Android WebView).
 * If `src` fails, shows a short message instead of an empty dark box.
 */
export function SafeImage(props: {
  src: string | null | undefined
  alt: string
  className?: string
  missingClassName?: string
  missingText?: string
}) {
  const [failed, setFailed] = useState(false)
  const [src, setSrc] = useState(props.src || '')

  useEffect(() => {
    setFailed(false)
    setSrc(props.src || '')
  }, [props.src])

  if (!src || failed) {
    return (
      <div className={props.missingClassName || 'receipt-preview-missing'} role="img" aria-label={props.alt}>
        {props.missingText ||
          (failed
            ? 'Photo could not be shown. Re-scan or pick the receipt again.'
            : 'No photo')}
      </div>
    )
  }

  return (
    <img
      className={props.className}
      src={src}
      alt={props.alt}
      loading="eager"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
