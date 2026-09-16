import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { SubAgentRecord } from '../api/tauri'
import { MessageBubble } from './MessageBubble'
import { subAgentMessages } from './subAgentMessages'

export function SubAgentConversation({ child, lang }: { child: SubAgentRecord; lang: 'zh' | 'en' }) {
  const root = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const messages = useMemo(() => subAgentMessages(child), [child])
  const run = child.runs.at(-1)
  const legacyRecovery = run?.error?.startsWith('recovered: ')
  useEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('[data-task-scroll]')
    if (!scroll) return
    const track = () => { following.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 64 }
    scroll.addEventListener('scroll', track, { passive: true })
    return () => scroll.removeEventListener('scroll', track)
  }, [])
  useLayoutEffect(() => {
    const scroll = root.current?.closest<HTMLElement>('[data-task-scroll]')
    if (scroll && following.current) scroll.scrollTop = scroll.scrollHeight
  }, [messages])
  return <div ref={root} aria-label={lang === 'zh' ? '子代理对话' : 'Sub-agent conversation'} className="min-w-0 space-y-6 px-5 py-5">
    {messages.map(message => <MessageBubble key={message.id} message={message} readOnly />)}
    {!legacyRecovery && run?.error && <p role="status" className="whitespace-pre-wrap break-words text-xs text-neutral-500">{run.error}</p>}
    {run && ['running', 'finishing', 'stopping'].includes(run.status) && <p role="status" className="text-xs text-neutral-400">{lang === 'zh' ? '正在处理任务…' : 'Working…'}</p>}
  </div>
}
