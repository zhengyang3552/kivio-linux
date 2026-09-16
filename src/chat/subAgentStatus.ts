type ExecutionView = { status?: unknown; error?: unknown; result?: unknown; outputAvailable?: unknown; requiresReview?: unknown; resolution?: unknown; recovery?: unknown }
export const subAgentActive = (run?: ExecutionView) => ['running', 'finishing', 'stopping'].includes(String(run?.status))

/** Display lifecycle and available output, never a framework judgment of the task. */
export function subAgentStatusLabel(run: ExecutionView | undefined, lang: 'zh' | 'en'): string {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en
  const status = String(run?.status ?? 'accepted')
  const active: Record<string, string> = { running: t('运行中', 'Running'), finishing: t('正在收尾', 'Finishing'), stopping: t('正在停止', 'Stopping') }
  if (active[status]) return active[status]
  if (status === 'interrupted') return t('已停止', 'Stopped')
  const hasOutput = run?.outputAvailable === true || (typeof run?.result === 'string' && run.result.trim().length > 0) || (typeof run?.error === 'string' && run.error.startsWith('recovered: '))
  if (hasOutput || status === 'completed' || status === 'returned') return t('已返回', 'Returned')
  return ({ failed: t('执行已结束', 'Execution ended'), interrupted: t('已停止', 'Stopped'), accepted: t('派工已受理', 'Assignment accepted') } as Record<string, string>)[status] ?? status
}
