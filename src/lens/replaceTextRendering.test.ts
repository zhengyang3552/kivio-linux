import { describe, expect, it } from 'vitest'
import type { LensReplaceRenderSlot } from '../api/tauri'
import { renderReplaceTranslations } from './replaceTextRendering'

function canvasProbe() {
  const calls: { text: string; x: number; y: number; font: number }[] = []
  const ctx = {
    font: '', textBaseline: 'alphabetic', textAlign: 'left', fillStyle: '',
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    measureText(text: string) {
      const size = parseFloat(this.font)
      return {
        width: [...text].length * size * 0.6,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: [...text].length * size * 0.6,
        actualBoundingBoxAscent: size * (/^g+$/.test(text) ? 0.4 : 0.7),
        actualBoundingBoxDescent: size * 0.1,
      }
    },
    fillText(text: string, x: number, y: number) { calls.push({ text, x, y, font: parseFloat(this.font) }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

function slot(scale = 1): LensReplaceRenderSlot {
  return {
    id: 's', groupId: 'g', leafIds: ['l'],
    bounds: { x: 10 * scale, y: 10 * scale, width: 200 * scale, height: 24 * scale },
    anchor: { x: 12 * scale, y: 14 * scale, baselineY: 28 * scale },
    sourceFontPx: 14 * scale, sourceColor: '#111111', align: 'left', verticalAlign: 'top',
    kind: 'line', flow: 'exact_line',
  }
}

describe('replacement text rendering', () => {
  it('leaves unchanged brands and missing translations in their original pixels', () => {
    const { ctx, calls } = canvasProbe()
    for (const translated of ['Hezubus', '  Hezubus  ', '']) {
      renderReplaceTranslations(ctx, [{ id: 'g', leafIds: ['l'], sourceText: 'Hezubus', translated }], [slot()])
    }
    expect(calls).toHaveLength(0)
  })
  it('does not give same-size menu labels different fonts just because English ink heights differ', () => {
    const { ctx, calls } = canvasProbe()
    ctx.measureText = (text: string) => {
      const size = parseFloat(ctx.font)
      const ratio = text === 'Auto save' ? 0.6 : text === 'View logs' ? 0.9 : 0.8
      return { width: text.length * size * 0.55, actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * size * 0.55,
        actualBoundingBoxAscent: size * ratio, actualBoundingBoxDescent: 0 } as TextMetrics
    }
    const a = slot(), b = slot()
    a.sourceFontPx = 16 * 0.6
    b.sourceFontPx = 16 * 0.9
    b.groupId = 'other'
    b.id = 'other-slot'
    renderReplaceTranslations(ctx, [
      { id: 'g', leafIds: ['l'], sourceText: 'Auto save', translated: '自动保存' },
      { id: 'other', leafIds: ['l'], sourceText: 'View logs', translated: '查看日志' },
    ], [a, b])
    expect(calls).toHaveLength(2)
    expect(calls[0].font).toBeCloseTo(16, 1)
    expect(calls[1].font).toBeCloseTo(16, 1)
  })

  it('matches target-script ink height without making a short translation smaller', () => {
    const { ctx, calls } = canvasProbe()
    renderReplaceTranslations(ctx, [{ id: 'g', leafIds: ['l'], sourceText: 'Open settings', translated: '打开设置' }], [slot()])
    expect(calls).toHaveLength(1)
    expect(calls[0].font * 0.8).toBeCloseTo(14)
    expect(calls[0].x).toBe(12)
    expect(calls[0].y - calls[0].font * 0.7).toBeCloseTo(14)
  })

  it('keeps a modestly expanded label on one line and shrinks only as much as needed', () => {
    const { ctx, calls } = canvasProbe()
    const line = slot()
    line.bounds.width = 94
    renderReplaceTranslations(ctx, [{ id: 'g', leafIds: ['l'], sourceText: 'Translation', translated: '配置默认翻译语言设置' }], [line])
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('配置默认翻译语言设置')
    expect(calls[0].font).toBeLessThan(17.5)
    expect(calls[0].font).toBeGreaterThan(14)
  })

  it('does not shrink a heading differently at 2x capture scale', () => {
    const samples = [1, 1.25, 2].map(scale => {
      const { ctx, calls } = canvasProbe()
      const heading = slot(scale)
      heading.sourceFontPx = 36 * scale
      heading.bounds.height = 64 * scale
      renderReplaceTranslations(ctx, [{ id: 'g', leafIds: ['l'], sourceText: 'Workspace', translated: '工作空间' }], [heading], scale)
      return calls[0].font / scale
    })
    expect(samples[0]).toBeGreaterThan(36)
    samples.forEach(size => expect(size).toBeCloseTo(samples[0]))
  })

  it('uses stable baseline spacing across cell lines with different ink ascents', () => {
    const { ctx, calls } = canvasProbe()
    const cell = slot()
    cell.kind = 'cell'
    cell.flow = 'cell_flow'
    cell.bounds.height = 100
    renderReplaceTranslations(ctx, [{ id: 'g', leafIds: ['l'], sourceText: 'original text', translated: 'gg\nAA' }], [cell])
    expect(calls.map(call => call.text)).toEqual(['gg', 'AA'])
    expect(calls[1].y - calls[0].y).toBeCloseTo(calls[0].font * 1.18)
  })

  it('flows paragraph text through source rows without inserting extra lines into a row', () => {
    const { ctx, calls } = canvasProbe()
    const a = slot(), b = slot()
    a.flow = b.flow = 'paragraph_flow'
    a.kind = b.kind = 'paragraph'
    a.bounds.width = b.bounds.width = 100
    b.id = 's2'
    b.bounds.y += 28
    b.anchor.y += 28
    const text = '译文保持原有行距和稳定位置'
    renderReplaceTranslations(ctx, [{ id: 'g', leafIds: ['l'], sourceText: 'source\nlines', translated: text }], [a, b])
    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.text).join('')).toBe(text)
    expect(calls[1].y - calls[0].y).toBeCloseTo(28)
  })
})
