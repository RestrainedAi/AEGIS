import { useEffect, useState } from 'react'

export function useMediaQuery(query: string, initialValue = false) {
  const [matches, setMatches] = useState(initialValue)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)

    update()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }

    media.addListener(update)
    return () => media.removeListener(update)
  }, [query])

  return matches
}
