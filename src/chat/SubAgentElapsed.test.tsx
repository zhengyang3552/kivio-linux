import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SubAgentElapsed } from './SubAgentElapsed'

afterEach(() => vi.useRealTimers())

it('ticks during execution and freezes at the recorded end', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const run = { id: 'a', status: 'running', prompt: '', startedAt: 41000 }
  const view = render(<SubAgentElapsed run={run} lang="zh" />)
  expect(screen.getByText('59s')).toBeVisible()
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByText('1m 1s')).toBeVisible()
  view.rerender(<SubAgentElapsed run={{ ...run, status: 'returned', finishedAt: 101000 }} lang="zh" />)
  act(() => vi.advanceTimersByTime(10000))
  expect(screen.getByText('1m 0s')).toBeVisible()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not invent durations for old records or interrupted processes', () => {
  const view = render(<SubAgentElapsed run={{ id: 'old', status: 'returned', prompt: '' }} lang="zh" />)
  expect(screen.getByTitle('未记录耗时')).toHaveTextContent('—')
  view.rerender(<SubAgentElapsed run={{ id: 'interrupted', status: 'interrupted', prompt: '', startedAt: 1000 }} lang="zh" />)
  expect(screen.getByTitle('未记录耗时')).toHaveTextContent('—')
})

it('uses the new execution start when the same child continues', () => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const view = render(<SubAgentElapsed run={{ id: 'old', status: 'returned', prompt: '', startedAt: 1000, finishedAt: 65000 }} lang="en" />)
  expect(screen.getByText('1m 4s')).toBeVisible()
  view.rerender(<SubAgentElapsed run={{ id: 'new', status: 'running', prompt: '', startedAt: 100000 }} lang="en" />)
  expect(screen.getByText('0s')).toBeVisible()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
