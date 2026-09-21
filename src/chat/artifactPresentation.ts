import type { ChatToolArtifact, ToolCallRecord } from './types'

export interface ArtifactPresentation {
  artifactIds: string[]
  caption?: string
  /** Missing on historical records, which keep their original visible delivery. */
  mode?: 'prepare' | 'preview'
}

export function artifactId(artifact: ChatToolArtifact): string {
  return typeof artifact.id === 'string' ? artifact.id.trim() : ''
}

function isNativePresentationTool(toolCall: ToolCallRecord): boolean {
  if (toolCall.source !== 'native') return false
  const name = toolCall.tool_name || toolCall.toolName || toolCall.name || ''
  return name === 'present_artifacts'
}

export function artifactPresentationFromToolCall(
  toolCall: ToolCallRecord,
): ArtifactPresentation | null {
  if (!isNativePresentationTool(toolCall)) return null
  const structured = toolCall.structured_content ?? toolCall.structuredContent
  if (!structured || typeof structured !== 'object') return null
  const value = structured as {
    type?: unknown
    artifactIds?: unknown
    artifact_ids?: unknown
    caption?: unknown
    mode?: unknown
  }
  if (value.type !== 'artifact_presentation') return null
  const rawIds = value.artifactIds ?? value.artifact_ids
  if (!Array.isArray(rawIds)) return { artifactIds: [] }
  const artifactIds = Array.from(new Set(
    rawIds
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean),
  ))
  const caption = typeof value.caption === 'string' ? value.caption.trim() : ''
  const mode = value.mode === 'prepare' || value.mode === 'preview' ? value.mode : undefined
  return { artifactIds, ...(caption ? { caption } : {}), ...(mode ? { mode } : {}) }
}

export function isVisibleArtifactPresentation(toolCall: ToolCallRecord): boolean {
  return isArtifactPresentationToolCall(toolCall) && artifactPresentationFromToolCall(toolCall)?.mode !== 'prepare'
}

export function isArtifactPresentationToolCall(toolCall: ToolCallRecord): boolean {
  return isNativePresentationTool(toolCall)
}
