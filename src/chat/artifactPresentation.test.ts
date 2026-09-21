import { describe, expect, it } from 'vitest'
import {
  artifactId,
  artifactPresentationFromToolCall,
  isArtifactPresentationToolCall,
  isVisibleArtifactPresentation,
} from './artifactPresentation'
import type { ToolCallRecord } from './types'

describe('artifact presentation protocol', () => {
  it('keeps newly prepared files in Work but preserves immediate previews and history', () => {
    const call: ToolCallRecord = { id: 'prepare', name: 'present_artifacts', source: 'native',
      structured_content: { type: 'artifact_presentation', artifactIds: ['art_a'], mode: 'prepare' } }
    expect(artifactPresentationFromToolCall(call)?.mode).toBe('prepare')
    expect(isVisibleArtifactPresentation(call)).toBe(false)
    for (const mode of ['preview', undefined]) {
      expect(isVisibleArtifactPresentation({ ...call, structured_content: {
        type: 'artifact_presentation', artifactIds: ['art_a'], mode,
      } })).toBe(true)
    }
  })
  it('reads, trims, and deduplicates camelCase artifact IDs', () => {
    const presentation = artifactPresentationFromToolCall({
      id: 'call-1',
      source: 'native',
      name: 'present_artifacts',
      structured_content: {
        type: 'artifact_presentation',
        artifactIds: [' art_a ', 'art_b', 'art_a', '', 42],
        caption: ' Preview ',
      },
    })

    expect(presentation).toEqual({ artifactIds: ['art_a', 'art_b'], caption: 'Preview' })
  })

  it('accepts snake_case artifact_ids', () => {
    const presentation = artifactPresentationFromToolCall({
      id: 'call-2',
      source: 'native',
      name: 'present_artifacts',
      structuredContent: {
        type: 'artifact_presentation',
        artifact_ids: ['art_a'],
      },
    })

    expect(presentation).toEqual({ artifactIds: ['art_a'] })
  })

  it('rejects unrelated or non-native structured content', () => {
    expect(artifactPresentationFromToolCall({
      id: 'call-3',
      source: 'native',
      name: 'present_artifacts',
      structured_content: { type: 'advisor', artifactIds: ['art_a'] },
    })).toBeNull()
    expect(artifactPresentationFromToolCall({
      id: 'call-3-mcp',
      source: 'mcp',
      name: 'present_artifacts',
      structured_content: { type: 'artifact_presentation', artifactIds: ['art_a'] },
    })).toBeNull()
  })

  it('recognizes the native tool name while the call is still streaming', () => {
    const toolCall: ToolCallRecord = {
      id: 'call-4',
      source: 'native',
      name: 'present_artifacts',
      status: 'running',
    }
    expect(isArtifactPresentationToolCall(toolCall)).toBe(true)
    expect(isArtifactPresentationToolCall({ ...toolCall, source: 'mcp' })).toBe(false)
  })

  it('normalizes optional artifact IDs', () => {
    expect(artifactId({ id: ' art_a ', name: 'a.txt' })).toBe('art_a')
    expect(artifactId({ id: null, name: 'a.txt' })).toBe('')
  })
})
