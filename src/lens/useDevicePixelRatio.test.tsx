import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDevicePixelRatio, useDevicePixelRatio } from './useDevicePixelRatio'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('device pixel ratio changes', () => {
  it.each([undefined, 0, -1, NaN, Infinity])('uses a safe scale for %s', ratio => {
    vi.stubGlobal('devicePixelRatio', ratio)
    expect(readDevicePixelRatio()).toBe(1)
  })

  it('re-arms resolution listeners across mixed-DPI transitions and releases them', () => {
    vi.stubGlobal('devicePixelRatio', 1.25)
    const queries: { media: string; listeners: Set<() => void> }[] = []
    vi.stubGlobal('matchMedia', vi.fn((media: string) => {
      const listeners = new Set<() => void>()
      queries.push({ media, listeners })
      return {
        addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
        removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
      }
    }))
    const { result, unmount } = renderHook(useDevicePixelRatio)
    expect(result.current).toBe(1.25)
    for (const ratio of [2, 1.5, 1, 2.25]) {
      const previous = queries[queries.length - 1]
      act(() => {
        vi.stubGlobal('devicePixelRatio', ratio)
        for (const listener of [...previous.listeners]) listener()
      })
      expect(result.current).toBe(ratio)
      expect(previous.listeners.size).toBe(0)
      expect(queries[queries.length - 1].media).toBe(`(resolution: ${ratio}dppx)`)
    }
    unmount()
    expect(queries.every(query => query.listeners.size === 0)).toBe(true)
  })
})
