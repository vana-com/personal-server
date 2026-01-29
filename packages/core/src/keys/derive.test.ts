import { describe, it, expect } from 'vitest'
import { deriveMasterKey, deriveScopeKey } from './derive.js'

// A valid 65-byte (130 hex char) signature for testing
const VALID_SIG = `0x${'ab'.repeat(65)}` as `0x${string}`

describe('deriveMasterKey', () => {
  it('returns 65-byte Uint8Array for valid signature', () => {
    const result = deriveMasterKey(VALID_SIG)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(65)
  })

  it('throws on invalid hex characters', () => {
    const badHex = `0x${'zz'.repeat(65)}` as `0x${string}`
    expect(() => deriveMasterKey(badHex)).toThrow('non-hex characters')
  })

  it('throws on wrong length (too short)', () => {
    const shortSig = `0x${'ab'.repeat(30)}` as `0x${string}`
    expect(() => deriveMasterKey(shortSig)).toThrow('Invalid signature length')
  })
})

describe('deriveScopeKey', () => {
  const masterKey = deriveMasterKey(VALID_SIG)

  it('returns 32-byte Uint8Array for valid scope', () => {
    const result = deriveScopeKey(masterKey, 'instagram.profile')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(32)
  })

  it('produces different keys for different scopes', () => {
    const key1 = deriveScopeKey(masterKey, 'instagram.profile')
    const key2 = deriveScopeKey(masterKey, 'chatgpt.conversations')
    expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false)
  })

  it('is deterministic — same inputs produce same output', () => {
    const key1 = deriveScopeKey(masterKey, 'instagram.profile')
    const key2 = deriveScopeKey(masterKey, 'instagram.profile')
    expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true)
  })
})
