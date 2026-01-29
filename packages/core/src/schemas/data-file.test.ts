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
