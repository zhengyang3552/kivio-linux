import { invoke } from '@tauri-apps/api/core'

/** Persisted attachments use a bare filename; generated files use absolute paths. */
export function fileLocationAction(path?: string | null, conversationId?: string | null): (() => Promise<void>) | undefined {
  if (!path) return undefined
  if (/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path)) {
    return () => invoke('chat_reveal_generated_artifact', { path })
  }
  if (conversationId && !/[\\/:]/.test(path) && path !== '.' && path !== '..') {
    return () => invoke('chat_reveal_attachment', { path, conversationId })
  }
  return undefined
}
