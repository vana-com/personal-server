import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeDataFile, readDataFile, listVersions, deleteDataFile, deleteAllForScope } from './manager.js'
import { createDataFileEnvelope } from '../../schemas/data-file.js'
import type { HierarchyManagerOptions } from './manager.js'

describe('HierarchyManager', () => {
  let dataDir: string
  let options: HierarchyManagerOptions

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'hierarchy-test-'))
    options = { dataDir }
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  const scope = 'instagram.profile'
  const collectedAt = '2026-01-21T10:00:00Z'
  const data = { username: 'testuser', followers: 100 }

  function makeEnvelope(s = scope, ts = collectedAt, d: Record<string, unknown> = data) {
    return createDataFileEnvelope(s, ts, d)
  }

  describe('writeDataFile', () => {
    it('creates file at expected path', async () => {
      const result = await writeDataFile(options, makeEnvelope())
      const content = await readFile(result.path, 'utf-8')
      expect(content).toBeTruthy()
    })

    it('written file is valid JSON with correct envelope fields', async () => {
      const envelope = makeEnvelope()
      const result = await writeDataFile(options, envelope)
      const content = JSON.parse(await readFile(result.path, 'utf-8'))
      expect(content.version).toBe('1.0')
      expect(content.scope).toBe(scope)
      expect(content.collectedAt).toBe(collectedAt)
      expect(content.data).toEqual(data)
    })

    it('creates intermediate directories', async () => {
      const envelope = makeEnvelope('chatgpt.conversations.shared')
      const result = await writeDataFile(options, envelope)
      expect(result.path).toContain('chatgpt/conversations/shared')
      const content = await readFile(result.path, 'utf-8')
      expect(content).toBeTruthy()
    })

    it('returns correct relativePath', async () => {
      const result = await writeDataFile(options, makeEnvelope())
      expect(result.relativePath).toBe('instagram/profile/2026-01-21T10-00-00Z.json')
    })

    it('returns sizeBytes > 0', async () => {
      const result = await writeDataFile(options, makeEnvelope())
      expect(result.sizeBytes).toBeGreaterThan(0)
    })

    it('atomic write: file content is complete (no partial writes)', async () => {
      const largeData: Record<string, unknown> = {}
      for (let i = 0; i < 1000; i++) {
        largeData[`key_${i}`] = `value_${i}_${'x'.repeat(100)}`
      }
      const envelope = makeEnvelope(scope, collectedAt, largeData)
      const result = await writeDataFile(options, envelope)
      const content = await readFile(result.path, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.version).toBe('1.0')
      expect(parsed.data).toEqual(largeData)
    })
  })

  describe('readDataFile', () => {
    it('returns the envelope written by writeDataFile', async () => {
      const envelope = makeEnvelope()
      await writeDataFile(options, envelope)
      const read = await readDataFile(options, scope, collectedAt)
      expect(read).toEqual(envelope)
    })
  })

  describe('listVersions', () => {
    it('returns filenames in reverse chronological order', async () => {
      const ts1 = '2026-01-21T08:00:00Z'
      const ts2 = '2026-01-21T10:00:00Z'
      const ts3 = '2026-01-21T12:00:00Z'

      await writeDataFile(options, makeEnvelope(scope, ts1))
      await writeDataFile(options, makeEnvelope(scope, ts2))
      await writeDataFile(options, makeEnvelope(scope, ts3))

      const versions = await listVersions(options, scope)
      expect(versions).toEqual([ts3, ts2, ts1])
    })

    it('returns empty array for nonexistent scope', async () => {
      const versions = await listVersions(options, 'nonexistent.scope')
      expect(versions).toEqual([])
    })
  })

  describe('deleteDataFile', () => {
    it('removes file; subsequent readDataFile throws ENOENT', async () => {
      await writeDataFile(options, makeEnvelope())
      await deleteDataFile(options, scope, collectedAt)
      await expect(readDataFile(options, scope, collectedAt)).rejects.toThrow(/ENOENT/)
    })
  })

  describe('deleteAllForScope', () => {
    it('deletes scope with 2 versions — files and directory removed', async () => {
      const ts1 = '2026-01-21T08:00:00Z'
      const ts2 = '2026-01-21T10:00:00Z'
      await writeDataFile(options, makeEnvelope(scope, ts1))
      await writeDataFile(options, makeEnvelope(scope, ts2))

      await deleteAllForScope(options, scope)

      // Scope directory should be gone
      const { stat } = await import('node:fs/promises')
      const { buildScopeDir } = await import('./paths.js')
      const scopeDir = buildScopeDir(dataDir, scope)
      await expect(stat(scopeDir)).rejects.toThrow(/ENOENT/)
    })

    it('after delete, listVersions returns empty array', async () => {
      await writeDataFile(options, makeEnvelope(scope, '2026-01-21T08:00:00Z'))
      await writeDataFile(options, makeEnvelope(scope, '2026-01-21T10:00:00Z'))

      await deleteAllForScope(options, scope)

      const versions = await listVersions(options, scope)
      expect(versions).toEqual([])
    })

    it('deleting nonexistent scope does not throw (idempotent)', async () => {
      await expect(deleteAllForScope(options, 'nonexistent.scope')).resolves.toBeUndefined()
    })

    it('deletes scope with nested subcategory — entire subtree removed', async () => {
      const nestedScope = 'chatgpt.conversations.shared'
      await writeDataFile(options, makeEnvelope(nestedScope, '2026-01-21T08:00:00Z'))
      await writeDataFile(options, makeEnvelope(nestedScope, '2026-01-21T10:00:00Z'))

      await deleteAllForScope(options, nestedScope)

      const versions = await listVersions(options, nestedScope)
      expect(versions).toEqual([])
    })
  })
})
