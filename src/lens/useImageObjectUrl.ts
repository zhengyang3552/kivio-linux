import { useEffect, useState } from 'react'

type ImageReader = (imageId: string) => Promise<ArrayBuffer | number[]>

/** Own one binary PNG preview; late reads cannot replace a newer image. */
export function useImageObjectUrl(imageId: string, readImage: ImageReader): string {
  const [preview, setPreview] = useState<{ imageId: string; url: string } | null>(null)

  useEffect(() => {
    if (!imageId) {
      setPreview(null)
      return
    }
    let cancelled = false
    let url: string | undefined
    void readImage(imageId).then(bytes => {
      if (cancelled) return
      const data = Array.isArray(bytes) ? new Uint8Array(bytes) : bytes
      url = URL.createObjectURL(new Blob([data], { type: 'image/png' }))
      setPreview({ imageId, url })
    }).catch(error => {
      if (!cancelled) console.error('Failed to load image preview', error)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [imageId, readImage])

  return preview?.imageId === imageId ? preview.url : ''
}
