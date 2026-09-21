import { api } from '../api/tauri'
import { useImageObjectUrl } from './useImageObjectUrl'

/** Own the full-screen PNG URL for exactly one capture session, including late
 * reads after close/reopen. Blob URLs avoid copying a large Base64 string through
 * IPC, React state and the image decoder during the first selection drag. */
export function useFreezeFramePreview(imageId: string): string {
  return useImageObjectUrl(imageId, api.lensReadFreezeFrame)
}
