import { useEffect, useState } from 'react'

export function readDevicePixelRatio(): number {
  const ratio = window.devicePixelRatio
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/** DPI can change without a different CSS viewport size (mixed-DPI monitors,
 * browser zoom, remote desktop). Re-arm the resolution query after each change. */
export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(readDevicePixelRatio)
  useEffect(() => {
    let query: MediaQueryList | undefined
    const update = () => {
      query?.removeEventListener('change', update)
      const next = readDevicePixelRatio()
      setRatio(next)
      query = window.matchMedia?.(`(resolution: ${next}dppx)`)
      query?.addEventListener('change', update)
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      query?.removeEventListener('change', update)
    }
  }, [])
  return ratio
}
