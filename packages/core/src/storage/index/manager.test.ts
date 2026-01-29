import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initializeDatabase } from './schema.js'
import { createIndexManager, type IndexManager } from './manager.js'
import type Database from 'better-sqlite3'

describe('IndexManager', () => {
  let db: Database.Database
  let manager: IndexManager

  beforeEach(() => {
    db = initializeDatabase(':memory:')
    manager = createIndexManager(db)
  })

  afterEach(() => {
    db.close()
  })

  it('insert returns IndexEntry with auto-generated id and createdAt', () => {
    const entry = manager.insert({
      fileId: null,
      path: 'instagram/profile/2026-01-21T10-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      sizeBytes: 256,
    })

    expect(entry.id).toBeGreaterThan(0)
    expect(entry.createdAt).toBeDefined()
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(entry.path).toBe('instagram/profile/2026-01-21T10-00-00Z.json')
    expect(entry.scope).toBe('instagram.profile')
    expect(entry.collectedAt).toBe('2026-01-21T10:00:00Z')
    expect(entry.sizeBytes).toBe(256)
  })

  it('insert with fileId null stores null', () => {
    const entry = manager.insert({
      fileId: null,
      path: 'test/scope/2026-01-21T10-00-00Z.json',
      scope: 'test.scope',
      collectedAt: '2026-01-21T10:00:00Z',
      sizeBytes: 100,
    })

    expect(entry.fileId).toBeNull()
  })

  it('insert duplicate path throws unique constraint error', () => {
    const common = {
      fileId: null,
      path: 'instagram/profile/2026-01-21T10-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      sizeBytes: 256,
    }

    manager.insert(common)
    expect(() => manager.insert(common)).toThrow()
  })

  it('findByPath returns inserted entry', () => {
    const inserted = manager.insert({
      fileId: null,
      path: 'instagram/profile/2026-01-21T10-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-21T10:00:00Z',
      sizeBytes: 256,
    })

    const found = manager.findByPath(
      'instagram/profile/2026-01-21T10-00-00Z.json',
    )
    expect(found).toBeDefined()
    expect(found!.id).toBe(inserted.id)
    expect(found!.scope).toBe('instagram.profile')
  })

  it('findByPath returns undefined for nonexistent path', () => {
    const found = manager.findByPath('nonexistent/path.json')
    expect(found).toBeUndefined()
  })

  it('findByScope returns entries ordered by collectedAt DESC', () => {
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-01T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-01T00:00:00Z',
      sizeBytes: 100,
    })
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-03T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-03T00:00:00Z',
      sizeBytes: 200,
    })
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-02T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-02T00:00:00Z',
      sizeBytes: 150,
    })

    const entries = manager.findByScope({ scope: 'instagram.profile' })
    expect(entries).toHaveLength(3)
    expect(entries[0]!.collectedAt).toBe('2026-01-03T00:00:00Z')
    expect(entries[1]!.collectedAt).toBe('2026-01-02T00:00:00Z')
    expect(entries[2]!.collectedAt).toBe('2026-01-01T00:00:00Z')
  })

  it('findByScope respects limit and offset', () => {
    for (let i = 1; i <= 5; i++) {
      manager.insert({
        fileId: null,
        path: `ig/profile/2026-01-0${i}T00-00-00Z.json`,
        scope: 'instagram.profile',
        collectedAt: `2026-01-0${i}T00:00:00Z`,
        sizeBytes: 100,
      })
    }

    const page = manager.findByScope({
      scope: 'instagram.profile',
      limit: 2,
      offset: 1,
    })
    expect(page).toHaveLength(2)
    // DESC order: 05, 04, 03, 02, 01 → offset 1 → 04, 03
    expect(page[0]!.collectedAt).toBe('2026-01-04T00:00:00Z')
    expect(page[1]!.collectedAt).toBe('2026-01-03T00:00:00Z')
  })

  it('findLatestByScope returns most recent entry', () => {
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-01T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-01T00:00:00Z',
      sizeBytes: 100,
    })
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-03T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-03T00:00:00Z',
      sizeBytes: 200,
    })

    const latest = manager.findLatestByScope('instagram.profile')
    expect(latest).toBeDefined()
    expect(latest!.collectedAt).toBe('2026-01-03T00:00:00Z')
  })

  it('countByScope returns correct count', () => {
    expect(manager.countByScope('instagram.profile')).toBe(0)

    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-01T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-01T00:00:00Z',
      sizeBytes: 100,
    })
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-02T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-02T00:00:00Z',
      sizeBytes: 100,
    })
    manager.insert({
      fileId: null,
      path: 'other/scope/2026-01-01T00-00-00Z.json',
      scope: 'other.scope',
      collectedAt: '2026-01-01T00:00:00Z',
      sizeBytes: 100,
    })

    expect(manager.countByScope('instagram.profile')).toBe(2)
    expect(manager.countByScope('other.scope')).toBe(1)
    expect(manager.countByScope('nonexistent.scope')).toBe(0)
  })

  it('deleteByPath returns true when exists, false otherwise', () => {
    manager.insert({
      fileId: null,
      path: 'ig/profile/2026-01-01T00-00-00Z.json',
      scope: 'instagram.profile',
      collectedAt: '2026-01-01T00:00:00Z',
      sizeBytes: 100,
    })

    expect(manager.deleteByPath('ig/profile/2026-01-01T00-00-00Z.json')).toBe(
      true,
    )
    expect(manager.deleteByPath('ig/profile/2026-01-01T00-00-00Z.json')).toBe(
      false,
    )
    expect(
      manager.findByPath('ig/profile/2026-01-01T00-00-00Z.json'),
    ).toBeUndefined()
  })
})
