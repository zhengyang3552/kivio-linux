import { useCallback, useSyncExternalStore } from 'react'
import { api, type SubAgentRecord } from '../api/tauri'
import { subAgentActive } from './subAgentStatus'

type Snapshot = { agents: SubAgentRecord[]; error: string }
type Entry = { snapshot: Snapshot; listeners: Set<() => void>; pending: boolean; refreshAgain?: boolean; version: number; timer?: ReturnType<typeof setTimeout> }
const EMPTY: Snapshot = { agents: [], error: '' }
const entries = new Map<string, Entry>()
const notify = (entry: Entry) => entry.listeners.forEach(listener => listener())

async function refresh(id: string, entry: Entry) {
  if (entry.pending || !entry.listeners.size) return
  clearTimeout(entry.timer)
  entry.timer = undefined
  entry.pending = true
  const version = entry.version
  try {
    const result = await api.chatSubagentControl(id, { operation: 'list' })
    if (entries.get(id) === entry && entry.version === version) {
      entry.snapshot = { agents: result.agents, error: '' }
      notify(entry)
    }
  } catch (error) {
    if (entries.get(id) === entry) { entry.snapshot = { ...entry.snapshot, error: String(error) }; notify(entry) }
  } finally {
    entry.pending = false
    if (entries.get(id) === entry && entry.listeners.size) {
      if (entry.refreshAgain) { entry.refreshAgain = false; void refresh(id, entry) }
      else if (entry.snapshot.error || entry.snapshot.agents.some(child => subAgentActive(child.runs.at(-1)))) entry.timer = setTimeout(() => void refresh(id, entry), 2500)
    }
  }
}

function subscribe(id: string, listener: () => void) {
  let entry = entries.get(id)
  if (!entry) { entry = { snapshot: EMPTY, listeners: new Set(), pending: false, version: 0 }; entries.set(id, entry) }
  entry.listeners.add(listener)
  if (entry.listeners.size === 1 && !entry.pending && !entry.timer) void refresh(id, entry)
  const subscribed = entry
  return () => {
    subscribed.listeners.delete(listener)
    queueMicrotask(() => {
      if (!subscribed.listeners.size && entries.get(id) === subscribed) { clearTimeout(subscribed.timer); entries.delete(id) }
    })
  }
}

/** One bounded UI polling lifecycle shared by the composer badge and task dock. */
export function useSubAgents(conversationId: string | null) {
  const listen = useCallback((listener: () => void) => conversationId ? subscribe(conversationId, listener) : () => {}, [conversationId])
  const snapshot = useCallback(() => conversationId ? entries.get(conversationId)?.snapshot ?? EMPTY : EMPTY, [conversationId])
  return useSyncExternalStore(listen, snapshot, () => EMPTY)
}

export function refreshSubAgents(id: string) {
  const entry = entries.get(id)
  if (!entry) return
  if (entry.pending) entry.refreshAgain = true
  else void refresh(id, entry)
}
export function updateSubAgent(id: string, child: SubAgentRecord) {
  const entry = entries.get(id)
  if (!entry) return
  entry.version += 1
  entry.snapshot = { agents: entry.snapshot.agents.map(item => item.id === child.id ? child : item), error: '' }
  notify(entry)
}
