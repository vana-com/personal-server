import { describe, it, expect } from 'vitest'
import {
  DataFileEnvelopeSchema,
  IngestResponseSchema,
  createDataFileEnvelope,
} from './data-file.js'

describe('DataFileEnvelopeSchema', () => {
  const valid = {
    version: '1.0' as const,
    scope: 'instagram.profile',
    collectedAt: '2026-01-21T10:00:00Z',
    data: { username: 'test' },
  }

  it('parses valid envelope', () => {
    const result = DataFileEnvelopeSchema.parse(valid)
    expect(result).toEqual(valid)
  })

  it('rejects wrong version', () => {
    expect(() => DataFileEnvelopeSchema.parse({ ...valid, version: '2.0' })).toThrow()
  })

  it('rejects invalid collectedAt', () => {
    expect(() => DataFileEnvelopeSchema.parse({ ...valid, collectedAt: 'not-a-date' })).toThrow()
  })
})

describe('createDataFileEnvelope', () => {
  it('returns correct envelope', () => {
    const result = createDataFileEnvelope('instagram.profile', '2026-01-21T10:00:00Z', {
      username: 'test',
    })
    expect(result).toEqual({
      version: '1.0',
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      data: { username: 'test' },
    })
  })
})

describe('IngestResponseSchema', () => {
  it('parses valid response', () => {
    const result = IngestResponseSchema.parse({
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      status: 'stored',
    })
    expect(result.status).toBe('stored')
  })
})
