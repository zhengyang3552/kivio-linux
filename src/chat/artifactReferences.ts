import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** An app-owned reference, never a filesystem path or a remote URL. */
export function artifactReferenceId(url: string): string | null {
  return /^artifact:(?:\/\/)?(art_[A-Za-z0-9_-]+)$/.exec(url)?.[1] ?? null
}

type ReferenceNode = {
  type: string
  url?: string
  identifier?: string
  alt?: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: ReferenceNode[]
}

const parser = unified().use(remarkParse)

/** Streamdown renders blocks independently; make artifact reference definitions
 * local to their link before those blocks are split. Other Markdown is untouched. */
export function inlineArtifactReferenceLinks(markdown: string): string {
  if (!markdown.includes('artifact:')) return markdown
  const tree = parser.parse(markdown) as ReferenceNode
  const definitions = new Map<string, string>()
  const nodes: ReferenceNode[] = []
  const visit = (node: ReferenceNode) => {
    if (node.type === 'definition' && node.identifier && node.url && artifactReferenceId(node.url)) {
      definitions.set(node.identifier.toLowerCase(), node.url)
    }
    if (node.type === 'linkReference' || node.type === 'imageReference') nodes.push(node)
    node.children?.forEach(visit)
  }
  visit(tree)
  let result = markdown
  for (const node of nodes.reverse()) {
    const url = definitions.get((node.identifier ?? '').toLowerCase())
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (!url || start == null || end == null) continue
    const childStart = node.children?.[0]?.position?.start.offset
    const childEnd = node.children?.[node.children.length - 1]?.position?.end.offset
    const label = childStart != null && childEnd != null ? markdown.slice(childStart, childEnd)
      : (node.alt ?? '').replace(/[\\[\]]/g, '\\$&')
    result = result.slice(0, start) + `${node.type === 'imageReference' ? '!' : ''}[${label}](${url})` + result.slice(end)
  }
  return result
}

/** Parse real Markdown links/images; examples in code must not hide deliveries. */
export function referencedArtifactIds(markdown: string): Set<string> {
  if (!markdown.includes('artifact:')) return new Set()
  const tree = parser.parse(markdown) as ReferenceNode
  const definitions = new Map<string, string>()
  const visit = (node: ReferenceNode, callback: (node: ReferenceNode) => void) => {
    callback(node)
    node.children?.forEach(child => visit(child, callback))
  }
  visit(tree, node => {
    if (node.type === 'definition' && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url)
    }
  })
  const ids = new Set<string>()
  visit(tree, node => {
    const url = node.type === 'link' || node.type === 'image' ? node.url
      : node.type === 'linkReference' || node.type === 'imageReference'
        ? definitions.get((node.identifier ?? '').toLowerCase()) : undefined
    const id = url ? artifactReferenceId(url) : null
    if (id) ids.add(id)
  })
  return ids
}
