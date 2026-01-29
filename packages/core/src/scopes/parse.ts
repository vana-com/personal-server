import { z } from 'zod'

const SEGMENT_RE = /^[a-z][a-z0-9_]*$/

export const ScopeSchema = z.string().refine(
  (s) => {
    const parts = s.split('.')
    return parts.length >= 2 && parts.length <= 3 && parts.every((p) => SEGMENT_RE.test(p))
  },
  {
    message:
      'Scope must be {source}.{category}[.{subcategory}] with lowercase alphanumeric segments',
  },
)

export type Scope = z.infer<typeof ScopeSchema>

export interface ParsedScope {
  source: string
  category: string
  subcategory?: string
  raw: string
}

export function parseScope(scope: string): ParsedScope {
  const validated = ScopeSchema.parse(scope)
  const parts = validated.split('.')
  return {
    source: parts[0],
    category: parts[1],
    subcategory: parts[2],
    raw: validated,
  }
}

export function scopeToPathSegments(scope: string): string[] {
  const parsed = parseScope(scope)
  const segments = [parsed.source, parsed.category]
  if (parsed.subcategory) {
    segments.push(parsed.subcategory)
  }
  return segments
}
