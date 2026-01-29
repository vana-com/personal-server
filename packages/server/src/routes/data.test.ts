import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pino } from 'pino'
import { initializeDatabase, createIndexManager } from '@personal-server/core/storage/index'
import type { HierarchyManagerOptions } from '@personal-server/core/storage/hierarchy'
import { buildDataFilePath } from '@personal-server/core/storage/hierarchy'
import { dataRoutes } from './data.js'

describe('POST /v1/data/:scope', () => {
  let dataDir: string
  let hierarchyOptions: HierarchyManagerOptions
  let app: ReturnType<typeof dataRoutes>
  let cleanup: () => void

  const logger = pino({ level: 'silent' })

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'data-route-test-'))
    hierarchyOptions = { dataDir }

    const db = initializeDatabase(':memory:')
    const indexManager = createIndexManager(db)

    app = dataRoutes({ indexManager, hierarchyOptions, logger })
    cleanup = () => {
      indexManager.close()
    }
  })

  afterEach(async () => {
    cleanup()
    await rm(dataDir, { recursive: true, force: true })
  })

  function post(scope: string, body?: unknown, contentType = 'application/json') {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': contentType },
    }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }
    return app.request(`/${scope}`, init)
  }

  it('returns 201 with scope, collectedAt, status for valid request', async () => {
    const res = await post('instagram.profile', { username: 'test' })
    expect(res.status).toBe(201)

    const json = await res.json()
    expect(json.scope).toBe('instagram.profile')
    expect(json.collectedAt).toBeDefined()
    expect(json.status).toBe('stored')
  })

  it('response collectedAt is valid ISO 8601', async () => {
    const res = await post('instagram.profile', { username: 'test' })
    const json = await res.json()
    const date = new Date(json.collectedAt)
    expect(date.toISOString()).toContain(json.collectedAt.slice(0, 19))
    expect(json.collectedAt).toMatch(/Z$/)
  })

  it('writes file to correct path on disk', async () => {
    const res = await post('instagram.profile', { username: 'test' })
    const json = await res.json()

    const filePath = buildDataFilePath(dataDir, 'instagram.profile', json.collectedAt)
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBeTruthy()
  })

  it('file content is valid DataFileEnvelope with version 1.0', async () => {
    const res = await post('instagram.profile', { username: 'test' })
    const json = await res.json()

    const filePath = buildDataFilePath(dataDir, 'instagram.profile', json.collectedAt)
    const content = JSON.parse(await readFile(filePath, 'utf-8'))
    expect(content.version).toBe('1.0')
    expect(content.scope).toBe('instagram.profile')
    expect(content.collectedAt).toBe(json.collectedAt)
    expect(content.data).toEqual({ username: 'test' })
  })

  it('SQLite index has matching row', async () => {
    const db = initializeDatabase(':memory:')
    const indexManager = createIndexManager(db)
    const localApp = dataRoutes({ indexManager, hierarchyOptions, logger })

    const res = await localApp.request('/instagram.profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test' }),
    })
    const json = await res.json()

    const entry = indexManager.findLatestByScope('instagram.profile')
    expect(entry).toBeDefined()
    expect(entry!.scope).toBe('instagram.profile')
    expect(entry!.collectedAt).toBe(json.collectedAt)
    expect(entry!.fileId).toBeNull()
    expect(entry!.sizeBytes).toBeGreaterThan(0)

    indexManager.close()
  })

  it('returns 400 for invalid scope', async () => {
    const res = await post('bad', { data: 'test' })
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error).toBe('INVALID_SCOPE')
  })

  it('returns 400 for non-JSON body', async () => {
    const res = await app.request('/instagram.profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error).toBe('INVALID_BODY')
  })

  it('returns 400 for array body', async () => {
    const res = await post('instagram.profile', [1, 2, 3])
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error).toBe('INVALID_BODY')
  })

  it('creates two separate versions for same scope', async () => {
    const res1 = await post('instagram.profile', { version: 1 })
    expect(res1.status).toBe(201)
    const json1 = await res1.json()

    // Ensure timestamps differ
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const res2 = await post('instagram.profile', { version: 2 })
    expect(res2.status).toBe(201)
    const json2 = await res2.json()

    expect(json1.collectedAt).not.toBe(json2.collectedAt)

    // Both files should exist
    const path1 = buildDataFilePath(dataDir, 'instagram.profile', json1.collectedAt)
    const path2 = buildDataFilePath(dataDir, 'instagram.profile', json2.collectedAt)
    const content1 = JSON.parse(await readFile(path1, 'utf-8'))
    const content2 = JSON.parse(await readFile(path2, 'utf-8'))
    expect(content1.data).toEqual({ version: 1 })
    expect(content2.data).toEqual({ version: 2 })
  })
})
