/** Legacy plans already have explicit plan metadata; their prose is not graded. */
export function hasAgentPlanText(content?: string | null): boolean {
  return Boolean(content?.trim())
}
