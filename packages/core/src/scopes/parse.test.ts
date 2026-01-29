import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { parseScope, scopeToPathSegments } from './parse.js'

describe('parseScope', () => {
  it('parses two-segment scope', () => {
    const result = parseScope('instagram.profile')
    expect(result).toEqual({
      source: 'instagram',
      category: 'profile',
      subcategory: undefined,
      raw: 'instagram.profile',
    })
  })

  it('parses three-segment scope with subcategory', () => {
    const result = parseScope('chatgpt.conversations.shared')
    expect(result).toEqual({
      source: 'chatgpt',
      category: 'conversations',
      subcategory: 'shared',
      raw: 'chatgpt.conversations.shared',
    })
  })

  it('accepts underscores in segments', () => {
    const result = parseScope('youtube.watch_history')
    expect(result).toEqual({
      source: 'youtube',
      category: 'watch_history',
      subcategory: undefined,
      raw: 'youtube.watch_history',
    })
  })

  it('rejects single segment', () => {
    expect(() => parseScope('a')).toThrow(ZodError)
  })

  it('rejects four segments', () => {
    expect(() => parseScope('a.b.c.d')).toThrow(ZodError)
  })

  it('rejects uppercase characters', () => {
    expect(() => parseScope('Instagram.Profile')).toThrow(ZodError)
  })

  it('rejects segment starting with digit', () => {
    expect(() => parseScope('123.abc')).toThrow(ZodError)
  })
})

describe('scopeToPathSegments', () => {
  it('returns path segments for three-segment scope', () => {
    const segments = scopeToPathSegments('chatgpt.conversations.shared')
    expect(segments).toEqual(['chatgpt', 'conversations', 'shared'])
  })
})
