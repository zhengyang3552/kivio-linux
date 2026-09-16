import type { LensReplaceGroup, LensReplaceRenderSlot } from '../api/tauri'
import { layoutReplaceTextFlow, replaceSlotTextBounds, replaceTextVerticalOffset } from './replaceTextLayout'

const FONT_FAMILY = 'system-ui, "Segoe UI", sans-serif'

/** Draw in screenshot coordinates; pixelScale is screenshot pixels per CSS pixel. */
export function renderReplaceTranslations(
  context: CanvasRenderingContext2D,
  groups: LensReplaceGroup[],
  slots: LensReplaceRenderSlot[],
  pixelScale = 1,
) {
  const slotsByGroup = new Map<string, LensReplaceRenderSlot[]>()
  for (const slot of slots) {
    const entries = slotsByGroup.get(slot.groupId) ?? []
    entries.push(slot)
    slotsByGroup.set(slot.groupId, entries)
  }
  context.save()
  context.textBaseline = 'alphabetic'
  context.textAlign = 'left'
  const measure = (text: string, fontPx: number) => {
    context.font = `${fontPx}px ${FONT_FAMILY}`
    const metrics = context.measureText(text)
    const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    return {
      width: Math.max(metrics.width, Number.isFinite(inkWidth) ? inkWidth : 0),
      height: Number.isFinite(inkHeight) && inkHeight > 0 ? inkHeight : fontPx * 1.18,
      ascent: Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : 0,
    }
  }
  for (const group of groups) {
    // The backend restores unchanged groups byte-for-byte from the capture.
    if (!group.translated.trim() || group.translated.trim() === group.sourceText.trim()) continue
    const groupSlots = (slotsByGroup.get(group.id) ?? [])
      .sort((left, right) => left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x)
    const text = group.translated.trim() || group.sourceText
    if (!groupSlots.length || !text) continue

    // The backend's sourceFontPx is estimated from tight ink, not a font em.
    // Reverse-measure SOURCE text: "Auto save" and "View logs" have different
    // ink heights at the same size. Matching each height to a Chinese sample
    // would preserve that accidental difference in the translated menu.
    const heights = groupSlots.map(slot => slot.sourceFontPx).sort((a, b) => a - b)
    const sourceInkHeight = heights[Math.floor(heights.length / 2)]
    const sourceLines = group.sourceText.split(/\r?\n/)
    const estimates = groupSlots.map((slot, index) => {
      const height = slot.sourceFontPx
      const sample = sourceLines.length === groupSlots.length ? sourceLines[index] : group.sourceText
      context.font = `${height}px ${FONT_FAMILY}`
      const reference = context.measureText(sample)
      const referenceHeight = reference.actualBoundingBoxAscent + reference.actualBoundingBoxDescent
      if (!Number.isFinite(referenceHeight) || referenceHeight <= 0) return height
      // Hinting is not linear: measure at the final size rather than applying
      // a ratio measured at a different size (which can overshoot by pixels).
      let low = height * 0.7
      let high = height * 1.8
      for (let step = 0; step < 12; step += 1) {
        const size = (low + high) / 2
        if (measure(sample, size).height <= height) low = size
        else high = size
      }
      return low
    }).sort((a, b) => a - b)
    const fontPx = estimates[Math.floor(estimates.length / 2)]
    const padding = Math.max(2 * pixelScale, Math.min(6 * pixelScale, sourceInkHeight * 0.2))
    const layout = layoutReplaceTextFlow(
      text, groupSlots.map(slot => replaceSlotTextBounds(slot, padding)), fontPx, measure, 7 * pixelScale,
    )

    groupSlots.forEach((slot, index) => {
      const slotLayout = layout.slots[index]
      if (!slotLayout?.lines.length) return
      const { bounds } = slot
      const scale = layout.safeScale
      const innerHeight = Math.max(1, bounds.height - padding * 2)
      const top = slot.flow === 'exact_line' || slot.verticalAlign === 'top'
        ? slot.anchor.y
        : bounds.y + padding + replaceTextVerticalOffset(slot.kind, innerHeight, slotLayout.contentHeight * scale)
      const x = slot.align === 'left' ? slot.anchor.x
        : slot.align === 'center' ? bounds.x + bounds.width / 2 : bounds.x + bounds.width - padding

      context.save()
      context.beginPath()
      context.rect(bounds.x, bounds.y, bounds.width, bounds.height)
      context.clip()
      context.font = `${layout.fontPx * scale}px ${FONT_FAMILY}`
      context.fillStyle = slot.sourceColor
      context.textAlign = slot.align
      // One shared ascent anchors all baselines in the group. Re-anchoring
      // each line by its own ink height makes punctuation and capitals jump.
      slotLayout.lines.forEach((line, lineIndex) => {
        const metrics = context.measureText(line)
        const left = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0
        const right = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : 0
        const offsetX = slot.align === 'left' ? left : slot.align === 'right' ? -right : (left - right) / 2
        const y = top + (layout.inkAscent + lineIndex * layout.lineHeight) * scale
        context.fillText(line, x + offsetX, y)
      })
      context.restore()
    })
  }
  context.restore()
}
