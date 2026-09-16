/// <reference lib="es2022.intl" />
import type { LensReplaceGroup, LensReplaceRenderSlot } from '../api/tauri'

export type TextBounds = { width: number; height: number; ascent?: number }

export type TextMeasure = (text: string, fontPx: number) => number | TextBounds

function measuredBounds(measure: TextMeasure, text: string, fontPx: number): TextBounds {
  const result = measure(text, fontPx)
  return typeof result === 'number' ? { width: result, height: fontPx * 1.18 } : result
}

export type ReplaceTextFlowSlot = TextBounds & { maxLines?: number }

/** Space is measured from the same ink anchor used by the Canvas renderer. */
export function replaceSlotTextBounds(slot: LensReplaceRenderSlot, padding: number): ReplaceTextFlowSlot {
  const { bounds } = slot
  const sourceLine = slot.flow === 'exact_line' || slot.flow === 'paragraph_flow'
  return {
    width: Math.max(1, slot.align === 'left'
      ? bounds.x + bounds.width - slot.anchor.x - padding
      : bounds.width - padding * 2),
    height: Math.max(1, sourceLine || slot.verticalAlign === 'top'
      ? bounds.y + bounds.height - slot.anchor.y - (sourceLine ? 0 : padding)
      : bounds.height - padding * 2),
    ...(sourceLine ? { maxLines: 1 } : {}),
  }
}

export type ReplaceTextFlowSlotLayout = {
  lines: string[]
  contentWidth: number
  contentHeight: number
}

export type ReplaceTextFlowLayout = {
  fontPx: number
  lineHeight: number
  inkAscent: number
  safeScale: number
  slots: ReplaceTextFlowSlotLayout[]
  complete: boolean
}

export type ReplaceRegionKind = 'cell' | 'line' | 'paragraph' | 'heading'

export function replaceTextVerticalOffset(
  kind: ReplaceRegionKind,
  availableHeight: number,
  contentHeight: number,
): number {
  if (kind === 'paragraph') return 0
  return Math.max(0, (availableHeight - contentHeight) / 2)
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const OPEN_PUNCTUATION = /^[（［｛〈《「『【〔〖〘〚“‘(\u005b]+$/u
const CLOSE_PUNCTUATION = /^[、。，．？！：；％‰）］｝〉》」』】〕〗〙〛”’!?,.:;%)\]]/u
const BREAKABLE_SPACE = /^[\t\r\f\v ]+$/
const NONBREAKING_SPACE = /[\u00a0\u202f\u2060]/u
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), part => part.segment)
}

/** Emergency word wrapping must still respect graphemes and punctuation pairs. */
function breakableUnits(text: string): string[] {
  if (NONBREAKING_SPACE.test(text)) return [text]
  const units: string[] = []
  for (const char of graphemes(text)) {
    const previous = units[units.length - 1]
    if (previous && (CLOSE_PUNCTUATION.test(char) || OPEN_PUNCTUATION.test(previous))) {
      units[units.length - 1] += char
    } else {
      units.push(char)
    }
  }
  return units
}

export function tokenizeReplaceText(text: string): string[] {
  const tokens: string[] = []
  let latin = ''
  const flushLatin = () => {
    if (latin) tokens.push(latin)
    latin = ''
  }
  for (const char of graphemes(text.replace(/\r\n?/g, '\n'))) {
    if (char === '\n') {
      flushLatin()
      tokens.push('\n')
    } else if (CLOSE_PUNCTUATION.test(char) && !latin && tokens.length > 0 && !/^\s+$/.test(tokens[tokens.length - 1])) {
      tokens[tokens.length - 1] += char
    } else if (OPEN_PUNCTUATION.test(char)) {
      if (OPEN_PUNCTUATION.test(latin)) latin += char
      else {
        flushLatin()
        latin = char
      }
    } else if (CJK.test(char)) {
      if (OPEN_PUNCTUATION.test(latin)) {
        tokens.push(latin + char)
        latin = ''
        continue
      }
      flushLatin()
      tokens.push(char)
    } else if (BREAKABLE_SPACE.test(char)) {
      flushLatin()
      tokens.push(char)
    } else {
      latin += char
    }
  }
  flushLatin()
  // Also preserve NBSP/word-joiner boundaries between CJK tokens.
  const joined: string[] = []
  for (const token of tokens) {
    const previous = joined[joined.length - 1]
    if (previous && (/[\u00a0\u202f\u2060]$/u.test(previous) || /^[\u00a0\u202f\u2060]/u.test(token))) {
      joined[joined.length - 1] += token
    } else {
      joined.push(token)
    }
  }
  return joined
}

function takeReplaceFlowLine(
  tokens: string[],
  maxWidth: number,
  fontPx: number,
  measure: (text: string, fontPx: number) => number,
): string {
  let current = ''
  while (tokens.length > 0) {
    const token = tokens[0]
    if (token === '\n') {
      tokens.shift()
      break
    }
    if (!current && BREAKABLE_SPACE.test(token)) {
      tokens.shift()
      continue
    }
    const candidate = current + token
    if (!current || measure(candidate, fontPx) <= maxWidth) {
      if (measure(candidate, fontPx) <= maxWidth) {
        current = candidate
        tokens.shift()
        continue
      }
    }
    if (current) break

    let prefix = ''
    let consumed = 0
    for (const char of breakableUnits(token)) {
      const next = prefix + char
      if (prefix && measure(next, fontPx) > maxWidth) break
      prefix = next
      consumed += char.length
    }
    current = prefix
    const remainder = token.slice(consumed)
    if (remainder) tokens[0] = remainder
    else tokens.shift()
    break
  }
  return current.replace(/[\t\r\f\v ]+$/, '')
}

function evaluateReplaceTextFlow(
  text: string,
  slots: ReplaceTextFlowSlot[],
  fontPx: number,
  safeScale: number,
  measure: TextMeasure,
): ReplaceTextFlowLayout {
  // Source-row slots describe one paragraph's geometry. Model-inserted line
  // breaks must not demand additional rows that no amount of shrinking can
  // create. Unrestricted multi-line slots still preserve explicit breaks.
  const flowText = slots.every(slot => slot.maxLines === 1) ? text.replace(/\s*\n\s*/g, ' ') : text
  const tokens = tokenizeReplaceText(flowText)
  const ink = measuredBounds(measure, flowText, fontPx * safeScale)
  const inkHeight = ink.height / safeScale
  const lineHeight = Math.max(fontPx * 1.18, inkHeight)
  // The renderer draws at the final size. Hinting and fallback fonts need not
  // scale linearly, so measure that size before converting to virtual units.
  const scaledMeasure = (value: string, size: number) => measuredBounds(measure, value, size * safeScale).width / safeScale
  const layouts = slots.map(slot => {
    const virtualWidth = Math.max(1, slot.width / safeScale)
    const virtualHeight = Math.max(1, slot.height / safeScale)
    // Leading belongs BETWEEN baselines, not below the last line's ink.
    const lineCount = Math.min(slot.maxLines ?? Infinity,
      Math.max(1, 1 + Math.floor((virtualHeight - inkHeight + 1e-6) / lineHeight)))
    const lines: string[] = []
    for (let index = 0; index < lineCount && tokens.length > 0; index += 1) {
      lines.push(takeReplaceFlowLine(tokens, virtualWidth, fontPx, scaledMeasure))
    }
    return {
      lines,
      contentWidth: Math.max(0, ...lines.map(line => scaledMeasure(line, fontPx))),
      contentHeight: lines.length ? (lines.length - 1) * lineHeight + inkHeight : 0,
    }
  })
  return {
    fontPx,
    lineHeight,
    inkAscent: (ink.ascent ?? 0) / safeScale,
    safeScale,
    slots: layouts,
    complete: tokens.length === 0 && layouts.every((layout, index) =>
      layout.contentWidth * safeScale <= slots[index].width &&
      layout.contentHeight * safeScale <= slots[index].height,
    ),
  }
}

/**
 * Flow one complete translation through independent source slots. Translation
 * grouping therefore provides context without replacing several source lines
 * with one tall, vertically-centred render rectangle.
 */
export function layoutReplaceTextFlow(
  text: string,
  slots: ReplaceTextFlowSlot[],
  sourceFontPx: number,
  measure: TextMeasure,
  preferredMinPx = 7,
): ReplaceTextFlowLayout {
  if (slots.length === 0) {
    return { fontPx: preferredMinPx, lineHeight: preferredMinPx * 1.18, inkAscent: 0, safeScale: 1, slots: [], complete: text.length === 0 }
  }
  // Source sizes and slots use screenshot coordinates. An absolute cap changes
  // the displayed size on Retina/HiDPI captures; an ink-height cap shrinks text
  // before it has even been measured. Try the source size first.
  const maxFont = sourceFontPx > 0 ? sourceFontPx : 16
  const original = evaluateReplaceTextFlow(text, slots, maxFont, 1, measure)
  if (original.complete) return original
  const minFont = Math.min(preferredMinPx, maxFont)
  let low = minFont
  let high = maxFont
  let best: ReplaceTextFlowLayout | null = null
  for (let index = 0; index < 10; index += 1) {
    const fontPx = (low + high) / 2
    const candidate = evaluateReplaceTextFlow(text, slots, fontPx, 1, measure)
    if (candidate.complete) {
      best = candidate
      low = fontPx
    } else {
      high = fontPx
    }
  }
  if (best) return best

  let fittingScale = 1
  let scaled = evaluateReplaceTextFlow(text, slots, minFont, fittingScale, measure)
  while (!scaled.complete && fittingScale > 0.0001) {
    fittingScale /= 2
    scaled = evaluateReplaceTextFlow(text, slots, minFont, fittingScale, measure)
  }
  let scaleLow = fittingScale
  let scaleHigh = Math.min(1, fittingScale * 2)
  let scaledBest = scaled
  for (let index = 0; index < 12; index += 1) {
    const scale = (scaleLow + scaleHigh) / 2
    const candidate = evaluateReplaceTextFlow(text, slots, minFont, scale, measure)
    if (candidate.complete) {
      scaledBest = candidate
      scaleLow = scale
    } else {
      scaleHigh = scale
    }
  }
  return scaledBest
}

/** 框选命中的译文：任一 slot 与选框相交的 group 全文入选，保持 groups 的阅读顺序。 */
export function selectedGroupsText(
  groups: LensReplaceGroup[],
  slots: LensReplaceRenderSlot[],
  rect: { x: number; y: number; width: number; height: number },
  useSource: boolean,
): string {
  const hitGroupIds = new Set<string>()
  for (const slot of slots) {
    const { bounds } = slot
    const intersects =
      bounds.x < rect.x + rect.width &&
      bounds.x + bounds.width > rect.x &&
      bounds.y < rect.y + rect.height &&
      bounds.y + bounds.height > rect.y
    if (intersects) hitGroupIds.add(slot.groupId)
  }
  return groups
    .filter(group => hitGroupIds.has(group.id))
    .map(group => (useSource ? group.sourceText : group.translated.trim() || group.sourceText))
    .filter(Boolean)
    .join('\n')
}
