import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pino } from 'pino'
import { initializeDatabase, createIndexManager } from '@personal-server/core/storage/index'
import type { IndexManager } from '@personal-server/core/storage/index'
import type { HierarchyManagerOptions } from '@personal-server/core/storage/hierarchy'
import { buildDataFilePath } from '@personal-server/core/storage/hierarchy'
import type { GatewayClient } from '@personal-server/core/gateway'
import type { GatewayGrantResponse } from '@personal-server/core/grants'
import type { AccessLogWriter } from '@personal-server/core/logging/access-log'
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from '@personal-server/core/test-utils'
import { dataRoutes } from './data.js'
import type { DataRouteDeps } from './data.js'

const SERVER_ORIGIN = 'http://localhost:8080'
const wallet = createTestWallet(0)

function createMockGateway(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return {
    isRegisteredBuilder: vi.fn().mockResolvedValue(true),
    getBuilder: vi.fn().mockResolvedValue(null),
    getGrant: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

function makeGrant(overrides: Partial<GatewayGrantResponse> = {}): GatewayGrantResponse {
  return {
    grantId: 'grant-123',
    user: '0xOwnerAddress',
    builder: wallet.address,
    scopes: ['instagram.*'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    revoked: false,
    ...overrides,
  }
}

function createMockAccessLogWriter(): AccessLogWriter {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  }
}

const logger = pino({ level: 'silent' })

describe('POST /v1/data/:scope', () => {
  let dataDir: string
  let hierarchyOptions: HierarchyManagerOptions
  let app: ReturnType<typeof dataRoutes>
  let cleanup: () => void

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'data-route-test-'))
    hierarchyOptions = { dataDir }

    const db = initializeDatabase(':memory:')
    const indexManager = createIndexManager(db)

    app = dataRoutes({
      indexManager,
      hierarchyOptions,
      logger,
      serverOrigin: SERVER_ORIGIN,
      serverOwner: '0xOwnerAddress' as `0x${string}`,
      gateway: createMockGateway(),
      accessLogWriter: createMockAccessLogWriter(),
    })
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
    const localApp = dataRoutes({
      indexManager,
      hierarchyOptions,
      logger,
      serverOrigin: SERVER_ORIGIN,
      serverOwner: '0xOwnerAddress' as `0x${string}`,
      gateway: createMockGateway(),
      accessLogWriter: createMockAccessLogWriter(),
    })

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

describe('GET /v1/data (list scopes)', () => {
  let dataDir: string
  let hierarchyOptions: HierarchyManagerOptions
  let indexManager: IndexManager
  let cleanup: () => void

  function createApp(overrides: Partial<DataRouteDeps> = {}) {
    return dataRoutes({
      indexManager,
      hierarchyOptions,
      logger,
      serverOrigin: SERVER_ORIGIN,
      serverOwner: '0xOwnerAddress' as `0x${string}`,
      gateway: createMockGateway(),
      accessLogWriter: createMockAccessLogWriter(),
      ...overrides,
    })
  }

  async function ingestData(scope: string, data: Record<string, unknown>, app: ReturnType<typeof dataRoutes>) {
    const res = await app.request(`/${scope}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.json()
  }

  async function getListWithAuth(
    app: ReturnType<typeof dataRoutes>,
    query = '',
  ) {
    const uri = '/'
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: 'GET',
      uri,
    })
    const url = query ? `/${query}` : '/'
    return app.request(url, {
      headers: { Authorization: header },
    })
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'data-route-list-test-'))
    hierarchyOptions = { dataDir }

    const db = initializeDatabase(':memory:')
    indexManager = createIndexManager(db)

    cleanup = () => {
      indexManager.close()
    }
  })

  afterEach(async () => {
    cleanup()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('returns 200 with scopes array for valid auth', async () => {
    const app = createApp()
    await ingestData('instagram.profile', { username: 'test' }, app)
    await ingestData('twitter.posts', { count: 10 }, app)

    const res = await getListWithAuth(app)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.scopes).toHaveLength(2)
    expect(json.scopes.map((s: { scope: string }) => s.scope)).toEqual(['instagram.profile', 'twitter.posts'])
    expect(json.total).toBe(2)
  })

  it('filters by scopePrefix query param', async () => {
    const app = createApp()
    await ingestData('instagram.profile', { username: 'test' }, app)
    await ingestData('instagram.likes', { count: 5 }, app)
    await ingestData('twitter.posts', { count: 10 }, app)

    const res = await getListWithAuth(app, '?scopePrefix=instagram')

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.scopes).toHaveLength(2)
    expect(json.scopes.map((s: { scope: string }) => s.scope)).toEqual(['instagram.likes', 'instagram.profile'])
    expect(json.total).toBe(2)
  })

  it('supports limit and offset pagination', async () => {
    const app = createApp()
    await ingestData('a.scope1', { a: 1 }, app)
    await ingestData('b.scope2', { b: 2 }, app)
    await ingestData('c.scope3', { c: 3 }, app)

    const res = await getListWithAuth(app, '?limit=1&offset=1')

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.scopes).toHaveLength(1)
    expect(json.scopes[0].scope).toBe('b.scope2')
    expect(json.total).toBe(3)
    expect(json.limit).toBe(1)
    expect(json.offset).toBe(1)
  })

  it('returns 401 without authorization header', async () => {
    const app = createApp()

    const res = await app.request('/')

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.errorCode).toBe('MISSING_AUTH')
  })

  it('returns 401 for unregistered builder', async () => {
    const gateway = createMockGateway({
      isRegisteredBuilder: vi.fn().mockResolvedValue(false),
    })
    const app = createApp({ gateway })

    const res = await getListWithAuth(app)

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.errorCode).toBe('UNREGISTERED_BUILDER')
  })
})

describe('GET /v1/data/:scope', () => {
  let dataDir: string
  let hierarchyOptions: HierarchyManagerOptions
  let indexManager: IndexManager
  let cleanup: () => void

  function createApp(overrides: Partial<DataRouteDeps> = {}) {
    const grant = makeGrant()
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    })

    return dataRoutes({
      indexManager,
      hierarchyOptions,
      logger,
      serverOrigin: SERVER_ORIGIN,
      serverOwner: '0xOwnerAddress' as `0x${string}`,
      gateway,
      accessLogWriter: createMockAccessLogWriter(),
      ...overrides,
    })
  }

  async function ingestData(scope: string, data: Record<string, unknown>, app: ReturnType<typeof dataRoutes>) {
    const res = await app.request(`/${scope}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return res.json()
  }

  async function getWithAuth(
    app: ReturnType<typeof dataRoutes>,
    scope: string,
    options: { grantId?: string; query?: string } = {},
  ) {
    const { grantId = 'grant-123', query = '' } = options
    // When testing the sub-app directly (not mounted at /v1/data),
    // the middleware sees the path as /${scope}
    const uri = `/${scope}`
    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: 'GET',
      uri,
      grantId,
    })
    const url = query ? `/${scope}${query}` : `/${scope}`
    return app.request(url, {
      headers: { Authorization: header },
    })
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'data-route-get-test-'))
    hierarchyOptions = { dataDir }

    const db = initializeDatabase(':memory:')
    indexManager = createIndexManager(db)

    cleanup = () => {
      indexManager.close()
    }
  })

  afterEach(async () => {
    cleanup()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('returns 200 with DataFileEnvelope for valid auth + grant', async () => {
    const app = createApp()

    // Ingest a data file first
    await ingestData('instagram.profile', { username: 'test_user' }, app)

    const res = await getWithAuth(app, 'instagram.profile')

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.version).toBe('1.0')
    expect(json.scope).toBe('instagram.profile')
    expect(json.collectedAt).toBeDefined()
    expect(json.data).toEqual({ username: 'test_user' })
  })

  it('returns 401 MISSING_AUTH without authorization header', async () => {
    const app = createApp()

    const res = await app.request('/instagram.profile')

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.errorCode).toBe('MISSING_AUTH')
  })

  it('returns 401 UNREGISTERED_BUILDER for unregistered builder', async () => {
    const gateway = createMockGateway({
      isRegisteredBuilder: vi.fn().mockResolvedValue(false),
    })
    const app = createApp({ gateway })

    const res = await getWithAuth(app, 'instagram.profile')

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.errorCode).toBe('UNREGISTERED_BUILDER')
  })

  it('returns 403 GRANT_REQUIRED without grantId', async () => {
    const app = createApp()

    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: 'GET',
      uri: '/instagram.profile',
      // no grantId
    })
    const res = await app.request('/instagram.profile', {
      headers: { Authorization: header },
    })

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.errorCode).toBe('GRANT_REQUIRED')
  })

  it('returns 403 GRANT_EXPIRED for expired grant', async () => {
    const grant = makeGrant({ expiresAt: Math.floor(Date.now() / 1000) - 3600 })
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    })
    const app = createApp({ gateway })

    const res = await getWithAuth(app, 'instagram.profile')

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.errorCode).toBe('GRANT_EXPIRED')
  })

  it('returns 403 SCOPE_MISMATCH when grant does not cover scope', async () => {
    const grant = makeGrant({ scopes: ['twitter.*'] })
    const gateway = createMockGateway({
      getGrant: vi.fn().mockResolvedValue(grant),
    })
    const app = createApp({ gateway })

    const res = await getWithAuth(app, 'instagram.profile')

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.errorCode).toBe('SCOPE_MISMATCH')
  })

  it('returns 404 for nonexistent scope', async () => {
    const app = createApp()

    const res = await getWithAuth(app, 'instagram.profile')

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('NOT_FOUND')
  })

  it('returns correct version when at query param is provided', async () => {
    const app = createApp()

    // Ingest first version
    const json1 = await ingestData('instagram.profile', { version: 1 }, app)

    // Wait to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // Ingest second version
    await ingestData('instagram.profile', { version: 2 }, app)

    // Request with at= the first version's timestamp
    const res = await getWithAuth(app, 'instagram.profile', {
      query: `?at=${json1.collectedAt}`,
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({ version: 1 })
    expect(json.collectedAt).toBe(json1.collectedAt)
  })
})
