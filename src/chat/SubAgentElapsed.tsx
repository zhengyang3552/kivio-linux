import { useEffect, useState } from 'react'
import type { SubAgentExecution } from '../api/tauri'
import { subAgentActive } from './subAgentStatus'

export function SubAgentElapsed({ run, lang }: { run?: SubAgentExecution; lang: 'zh' | 'en' }) {
  const [now, setNow] = useState(Date.now)
  const ticking = subAgentActive(run) && run?.startedAt != null && run.finishedAt == null
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking, run?.id])
  const end = run?.finishedAt ?? (ticking ? now : undefined)
  const seconds = run?.startedAt != null && end != null ? Math.max(0, Math.floor((end - run.startedAt) / 1000)) : null
  const text = seconds == null ? '—' : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
  const label = seconds == null ? (lang === 'zh' ? '未记录耗时' : 'Duration unavailable') : (lang === 'zh' ? '运行耗时' : 'Elapsed time')
  return <span title={label} aria-label={`${label}: ${text}`} className="w-16 shrink-0 text-right text-[11px] tabular-nums text-neutral-400">{text}</span>
}
