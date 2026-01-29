import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAccessLogReader } from './access-reader.js'
import type { AccessLogEntry } from './access-log.js'

function makeEntry(overrides: Partial<AccessLogEntry> = {}): AccessLogEntry {
  return {
    logId: 'test-log-id',
    grantId: 'test-grant-id',
    builder: '0x1234567890abcdef1234567890abcdef12345678',
    action: 'read',
    scope: 'instagram.profile',
    timestamp: '2026-01-28T12:00:00Z',
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    ...overrides,
  }
}

describe('AccessLogReader', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'access-reader-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns empty result for nonexistent logsDir', async () => {
    const reader = createAccessLogReader(join(tempDir, 'nonexistent'))
    const result = await reader.read()

    expect(result).toEqual({ logs: [], total: 0, limit: 50, offset: 0 })
  })

  it('returns all entries from a single file', async () => {
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })

    const entries = [
      makeEntry({ logId: 'log-1', timestamp: '2026-01-28T10:00:00Z' }),
      makeEntry({ logId: 'log-2', timestamp: '2026-01-28T12:00:00Z' }),
      makeEntry({ logId: 'log-3', timestamp: '2026-01-28T14:00:00Z' }),
    ]
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(logsDir, 'access-2026-01-28.log'), content, 'utf-8')

    const reader = createAccessLogReader(logsDir)
    const result = await reader.read()

    expect(result.total).toBe(3)
    expect(result.logs).toHaveLength(3)
  })

  it('merges entries from two files', async () => {
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })

    const day1 = [
      makeEntry({ logId: 'day1-1', timestamp: '2026-01-28T10:00:00Z' }),
      makeEntry({ logId: 'day1-2', timestamp: '2026-01-28T14:00:00Z' }),
    ]
    const day2 = [
      makeEntry({ logId: 'day2-1', timestamp: '2026-01-29T09:00:00Z' }),
    ]

    await writeFile(
      join(logsDir, 'access-2026-01-28.log'),
      day1.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    )
    await writeFile(
      join(logsDir, 'access-2026-01-29.log'),
      day2.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf-8',
    )

    const reader = createAccessLogReader(logsDir)
    const result = await reader.read()

    expect(result.total).toBe(3)
    expect(result.logs).toHaveLength(3)
    const logIds = result.logs.map((l) => l.logId)
    expect(logIds).toContain('day1-1')
    expect(logIds).toContain('day1-2')
    expect(logIds).toContain('day2-1')
  })

  it('sorts entries by timestamp DESC (newest first)', async () => {
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })

    const entries = [
      makeEntry({ logId: 'oldest', timestamp: '2026-01-27T08:00:00Z' }),
      makeEntry({ logId: 'newest', timestamp: '2026-01-29T20:00:00Z' }),
      makeEntry({ logId: 'middle', timestamp: '2026-01-28T12:00:00Z' }),
    ]
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(logsDir, 'access-2026-01-28.log'), content, 'utf-8')

    const reader = createAccessLogReader(logsDir)
    const result = await reader.read()

    expect(result.logs[0].logId).toBe('newest')
    expect(result.logs[1].logId).toBe('middle')
    expect(result.logs[2].logId).toBe('oldest')
  })

  it('limit=2 returns first 2 entries', async () => {
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })

    const entries = [
      makeEntry({ logId: 'a', timestamp: '2026-01-28T10:00:00Z' }),
      makeEntry({ logId: 'b', timestamp: '2026-01-28T12:00:00Z' }),
      makeEntry({ logId: 'c', timestamp: '2026-01-28T14:00:00Z' }),
      makeEntry({ logId: 'd', timestamp: '2026-01-28T16:00:00Z' }),
    ]
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(logsDir, 'access-2026-01-28.log'), content, 'utf-8')

    const reader = createAccessLogReader(logsDir)
    const result = await reader.read({ limit: 2 })

    expect(result.logs).toHaveLength(2)
    expect(result.total).toBe(4)
    expect(result.limit).toBe(2)
    expect(result.offset).toBe(0)
    // Newest first due to DESC sort
    expect(result.logs[0].logId).toBe('d')
    expect(result.logs[1].logId).toBe('c')
  })

  it('offset=2 limit=2 skips first 2 and returns next 2', async () => {
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })

    const entries = [
      makeEntry({ logId: 'a', timestamp: '2026-01-28T10:00:00Z' }),
      makeEntry({ logId: 'b', timestamp: '2026-01-28T12:00:00Z' }),
      makeEntry({ logId: 'c', timestamp: '2026-01-28T14:00:00Z' }),
      makeEntry({ logId: 'd', timestamp: '2026-01-28T16:00:00Z' }),
    ]
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(join(logsDir, 'access-2026-01-28.log'), content, 'utf-8')

    const reader = createAccessLogReader(logsDir)
    const result = await reader.read({ limit: 2, offset: 2 })

    expect(result.logs).toHaveLength(2)
    expect(result.total).toBe(4)
    expect(result.limit).toBe(2)
    expect(result.offset).toBe(2)
    // After DESC sort: d, c, b, a — skip 2 → b, a
    expect(result.logs[0].logId).toBe('b')
    expect(result.logs[1].logId).toBe('a')
  })

  it('skips malformed JSON lines and returns valid entries', async () => {
    const logsDir = join(tempDir, 'logs')
    await mkdir(logsDir, { recursive: true })

    const valid1 = JSON.stringify(makeEntry({ logId: 'valid-1', timestamp: '2026-01-28T10:00:00Z' }))
    const valid2 = JSON.stringify(makeEntry({ logId: 'valid-2', timestamp: '2026-01-28T14:00:00Z' }))
    const content = `${valid1}\nNOT VALID JSON\n${valid2}\n`
    await writeFile(join(logsDir, 'access-2026-01-28.log'), content, 'utf-8')

    const reader = createAccessLogReader(logsDir)
    const result = await reader.read()

    expect(result.total).toBe(2)
    expect(result.logs).toHaveLength(2)
    const logIds = result.logs.map((l) => l.logId)
    expect(logIds).toContain('valid-1')
    expect(logIds).toContain('valid-2')
  })
})
