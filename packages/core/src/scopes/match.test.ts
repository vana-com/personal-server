import { describe, it, expect } from 'vitest'
import { scopeMatchesPattern, scopeCoveredByGrant } from './match.js'

describe('scopeMatchesPattern', () => {
  it('matches exact scope', () => {
    expect(scopeMatchesPattern('instagram.profile', 'instagram.profile')).toBe(true)
  })

  it('matches wildcard pattern', () => {
    expect(scopeMatchesPattern('instagram.profile', 'instagram.*')).toBe(true)
  })

  it('matches global wildcard', () => {
    expect(scopeMatchesPattern('instagram.profile', '*')).toBe(true)
  })

  it('rejects different source wildcard', () => {
    expect(scopeMatchesPattern('instagram.profile', 'twitter.*')).toBe(false)
  })

  it('rejects different exact scope', () => {
    expect(scopeMatchesPattern('instagram.profile', 'instagram.likes')).toBe(false)
  })

  it('matches 3-segment scope with source wildcard', () => {
    expect(scopeMatchesPattern('chatgpt.conversations.shared', 'chatgpt.*')).toBe(true)
  })

  it('rejects when pattern is longer than requested scope', () => {
    expect(scopeMatchesPattern('instagram.profile', 'instagram.profile.detail')).toBe(false)
  })
})

describe('scopeCoveredByGrant', () => {
  it('returns true when any pattern matches', () => {
    expect(scopeCoveredByGrant('instagram.profile', ['twitter.*', 'instagram.*'])).toBe(true)
  })

  it('returns false when no pattern matches', () => {
    expect(scopeCoveredByGrant('instagram.profile', ['twitter.*', 'facebook.*'])).toBe(false)
  })

  it('returns false for empty grant scopes', () => {
    expect(scopeCoveredByGrant('instagram.profile', [])).toBe(false)
  })
})
