import { describe, it, expect } from 'vitest'
import {
  DataFileEnvelopeSchema,
  createDataFileEnvelope,
  IngestResponseSchema,
} from './data-file.js'

describe('DataFileEnvelopeSchema', () => {
  const validEnvelope = {
    version: '1.0' as const,
    scope: 'instagram.profile',
    collectedAt: '2026-01-21T10:00:00Z',
    data: { username: 'testuser', bio: 'hello' },
  }

  it('parses a valid envelope', () => {
    const result = DataFileEnvelopeSchema.parse(validEnvelope)
    expect(result).toEqual(validEnvelope)
  })

  it('rejects version other than 1.0', () => {
    expect(() =>
      DataFileEnvelopeSchema.parse({ ...validEnvelope, version: '2.0' }),
    ).toThrow()
  })

  it('rejects invalid collectedAt', () => {
    expect(() =>
      DataFileEnvelopeSchema.parse({ ...validEnvelope, collectedAt: 'not-a-date' }),
    ).toThrow()
  })

  it('parses an envelope with optional $schema field', () => {
    const result = DataFileEnvelopeSchema.parse({
      $schema: 'https://ipfs.io/ipfs/QmTest123',
      ...validEnvelope,
    })
    expect(result.$schema).toBe('https://ipfs.io/ipfs/QmTest123')
  })
})

describe('createDataFileEnvelope', () => {
  it('returns a correct envelope', () => {
    const envelope = createDataFileEnvelope(
      'instagram.profile',
      '2026-01-21T10:00:00Z',
      { username: 'testuser' },
    )
    expect(envelope).toEqual({
      version: '1.0',
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      data: { username: 'testuser' },
    })
  })

  it('includes $schema when schemaUrl is provided', () => {
    const envelope = createDataFileEnvelope(
      'instagram.profile',
      '2026-01-21T10:00:00Z',
      { username: 'testuser' },
      'https://ipfs.io/ipfs/QmTest123',
    )
    expect(envelope).toEqual({
      $schema: 'https://ipfs.io/ipfs/QmTest123',
      version: '1.0',
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      data: { username: 'testuser' },
    })
  })

  it('omits $schema key when schemaUrl is not provided', () => {
    const envelope = createDataFileEnvelope(
      'instagram.profile',
      '2026-01-21T10:00:00Z',
      { username: 'testuser' },
    )
    expect(envelope).not.toHaveProperty('$schema')
  })
})

describe('IngestResponseSchema', () => {
  it('parses a valid ingest response', () => {
    const result = IngestResponseSchema.parse({
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      status: 'stored',
    })
    expect(result).toEqual({
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      status: 'stored',
    })
  })
})
