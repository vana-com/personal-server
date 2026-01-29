import { describe, it, expect } from 'vitest'
import { GRANT_DOMAIN, GRANT_TYPES, grantToEip712Message } from './eip712.js'
import type { GrantPayload } from './types.js'

describe('GRANT_DOMAIN', () => {
  it('has correct name and chainId', () => {
    expect(GRANT_DOMAIN.name).toBe('Vana Data Portability')
    expect(GRANT_DOMAIN.chainId).toBe(14800)
  })
})

describe('GRANT_TYPES', () => {
  it('has 5 fields in correct order', () => {
    const fields = GRANT_TYPES.Grant
    expect(fields).toHaveLength(5)
    expect(fields[0]).toEqual({ name: 'user', type: 'address' })
    expect(fields[1]).toEqual({ name: 'builder', type: 'address' })
    expect(fields[2]).toEqual({ name: 'scopes', type: 'string[]' })
    expect(fields[3]).toEqual({ name: 'expiresAt', type: 'uint256' })
    expect(fields[4]).toEqual({ name: 'nonce', type: 'uint256' })
  })
})

describe('grantToEip712Message', () => {
  it('returns object with all grant fields', () => {
    const payload: GrantPayload = {
      user: '0x1234567890abcdef1234567890abcdef12345678',
      builder: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      scopes: ['instagram.*', 'twitter.profile'],
      expiresAt: 1700000000n,
      nonce: 42n,
    }

    const message = grantToEip712Message(payload)

    expect(message).toEqual({
      user: '0x1234567890abcdef1234567890abcdef12345678',
      builder: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      scopes: ['instagram.*', 'twitter.profile'],
      expiresAt: 1700000000n,
      nonce: 42n,
    })
  })
})
