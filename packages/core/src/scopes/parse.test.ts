import { describe, it, expect } from 'vitest'
import { parseScope, scopeToPathSegments } from './parse.js'
import { ZodError } from 'zod'

describe('parseScope', () => {
  it('parses two-segment scope', () => {
    const result = parseScope('instagram.profile')
    expect(result).toEqual({
      source: 'instagram',
      category: 'profile',
      raw: 'instagram.profile',
    })
    expect(result.subcategory).toBeUndefined()
  })

  it('parses three-segment scope', () => {
    const result = parseScope('chatgpt.conversations.shared')
    expect(result).toEqual({
      source: 'chatgpt',
      category: 'conversations',
      subcategory: 'shared',
      raw: 'chatgpt.conversations.shared',
    })
  })

  it('allows underscores in segments', () => {
    const result = parseScope('youtube.watch_history')
    expect(result.category).toBe('watch_history')
  })

  it('rejects single segment', () => {
    expect(() => parseScope('a')).toThrow(ZodError)
  })

  it('rejects four segments', () => {
    expect(() => parseScope('a.b.c.d')).toThrow(ZodError)
  })

  it('rejects uppercase', () => {
    expect(() => parseScope('Instagram.Profile')).toThrow(ZodError)
  })

  it('rejects segment starting with digit', () => {
    expect(() => parseScope('123.abc')).toThrow(ZodError)
  })
})

describe('scopeToPathSegments', () => {
  it('returns array of segments', () => {
    expect(scopeToPathSegments('chatgpt.conversations.shared')).toEqual([
      'chatgpt',
      'conversations',
      'shared',
    ])
  })
})
