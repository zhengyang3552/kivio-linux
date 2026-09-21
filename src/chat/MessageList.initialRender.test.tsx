import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageList } from './MessageList'
import { reset, setCoarse } from './streamingStore'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
})
afterEach(() => {
  act(() => reset())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function frame() {
  await act(async () => { await vi.advanceTimersByTimeAsync(16) })
}

async function settle() {
  for (let index = 0; index < 12; index += 1) await frame()
}

async function mount() {
  const ready = vi.fn()
  const { container, unmount } = render(<MessageList
    conversationId="opening-layout" renderRequestId={1} onInitialRender={ready}
    messages={[{ id: 'answer', role: 'assistant', content: 'Answer', timestamp: 1 }]}
  />)
  await act(async () => { await Promise.resolve() })
  const viewport = container.querySelector<HTMLElement>('.chat-scroll-viewport')!
  const content = container.querySelector<HTMLElement>('.chat-message-list-inner')!
  const row = container.querySelector<HTMLElement>('[data-message-id="answer"]')!
  // Virtualized rows can move/resize while the list's estimated total stays fixed.
  Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 1600 })
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 1600 })
  let top = 0
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({
    top, bottom: top + 200, height: 200, width: 600, left: 0, right: 600,
  }) as DOMRect)
  return { ready, row, viewport, unmount, move: () => { top += 40 } }
}

describe('MessageList opening mask readiness', () => {
  it('waits for visible row positions, not just total scrollHeight', async () => {
    const { ready, move } = await mount()
    for (let index = 0; index < 8; index += 1) {
      move()
      await frame()
    }
    expect(ready).not.toHaveBeenCalled()
    await settle()
    expect(ready).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledWith('opening-layout', 1)
  })

  it('waits for image loading and the resulting layout to settle', async () => {
    const { ready, row, move } = await mount()
    const image = document.createElement('img')
    let complete = false
    Object.defineProperty(image, 'complete', { get: () => complete })
    row.append(image)
    for (let index = 0; index < 140; index += 1) await frame()
    expect(ready).not.toHaveBeenCalled()
    complete = true
    move()
    fireEvent.load(image)
    await settle()
    expect(ready).toHaveBeenCalledOnce()
  })

  it('does not force reveal moving rows when the pending-content timeout expires', async () => {
    const { ready, row, move } = await mount()
    row.setAttribute('data-chat-async-pending', 'true')
    for (let index = 0; index < 140; index += 1) {
      move()
      await frame()
    }
    expect(ready).not.toHaveBeenCalled()
    row.removeAttribute('data-chat-async-pending')
    await settle()
    expect(ready).toHaveBeenCalledOnce()
  })

  it('waits for scroll compensation even when the content height stays fixed', async () => {
    const { ready, viewport } = await mount()
    for (let index = 0; index < 8; index += 1) {
      viewport.scrollTop += 40
      await frame()
    }
    expect(ready).not.toHaveBeenCalled()
    await settle()
    expect(ready).toHaveBeenCalledOnce()
  })

  it('releases a stalled async placeholder only after its geometry settles', async () => {
    const { ready, row } = await mount()
    row.setAttribute('data-chat-async-pending', 'true')
    await settle()
    expect(ready).not.toHaveBeenCalled()
    for (let index = 0; index < 140; index += 1) await frame()
    expect(ready).toHaveBeenCalledOnce()
    row.removeAttribute('data-chat-async-pending')
    await settle()
    expect(ready).toHaveBeenCalledOnce()
  })

  it('cancels the old readiness callback when switching away before settling', async () => {
    const { ready, unmount } = await mount()
    await frame()
    unmount()
    await settle()
    expect(ready).not.toHaveBeenCalled()
  })

  it('does not hide an actively generating conversation indefinitely', async () => {
    act(() => setCoarse({ streaming: true }))
    const { ready, row } = await mount()
    for (let index = 0; index < 140; index += 1) {
      // Live tokens can keep mutating DOM even after history has mounted.
      const token = document.createElement('span')
      row.append(token)
      await frame()
      token.remove()
    }
    expect(ready).toHaveBeenCalledOnce()
  })
})
