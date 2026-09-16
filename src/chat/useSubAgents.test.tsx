import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/tauri'
import { refreshSubAgents, useSubAgents } from './useSubAgents'
vi.mock('../api/tauri', () => ({ api: { chatSubagentControl: vi.fn() } }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
function View({ id }: { id: string }) { const { agents } = useSubAgents(id); return <div>{agents.map(child => child.name).join(',')}</div> }
const child = { id: 'a', name: 'A', sequence: 1, profile: { model: 'test', agentType: 'researcher' }, runs: [{ id: 'run', status: 'running', prompt: '' }], messages: [], history: [], tools: [] }

it('stops polling idle lists and resumes when a launch event requests a refresh', async () => {
  vi.useFakeTimers()
  vi.mocked(api.chatSubagentControl).mockResolvedValue({ sequence: 0, agents: [] })
  const view = render(<View id="idle-resume" />)
  await act(async () => {})
  await act(async () => { vi.advanceTimersByTime(30000) })
  expect(api.chatSubagentControl).toHaveBeenCalledTimes(1)
  vi.mocked(api.chatSubagentControl).mockResolvedValue({ sequence: 1, agents: [child] })
  await act(async () => { refreshSubAgents('idle-resume') })
  expect(screen.getByText('A')).toBeVisible()
  await act(async () => { vi.advanceTimersByTime(2500) })
  expect(api.chatSubagentControl).toHaveBeenCalledTimes(3)
  vi.mocked(api.chatSubagentControl).mockResolvedValue({ sequence: 2, agents: [{ ...child, runs: [{ ...child.runs[0], status: 'returned' }] }] })
  await act(async () => { vi.advanceTimersByTime(2500) })
  await act(async () => { vi.advanceTimersByTime(30000) })
  expect(api.chatSubagentControl).toHaveBeenCalledTimes(4)
  view.unmount()
  await act(async () => {})
  expect(vi.getTimerCount()).toBe(0)
})

it('does not lose a launch notification while an older list request is pending', async () => {
  let resolve!: (value: { sequence: number; agents: typeof child[] }) => void
  vi.mocked(api.chatSubagentControl).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  vi.mocked(api.chatSubagentControl).mockResolvedValue({ sequence: 1, agents: [child] })
  const view = render(<View id="inflight-refresh" />)
  act(() => refreshSubAgents('inflight-refresh'))
  await act(async () => resolve({ sequence: 0, agents: [] }))
  expect(screen.getByText('A')).toBeVisible()
  expect(api.chatSubagentControl).toHaveBeenCalledTimes(2)
  view.unmount()
  await act(async () => {})
})
