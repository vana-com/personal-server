import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp } from './app.js'
import { MissingAuthError } from '@personal-server/core/errors'
import {
  initializeDatabase,
  createIndexManager,
  type IndexManager,
} from '@personal-server/core/storage/index'
import type { GatewayClient } from '@personal-server/core/gateway'
import type { AccessLogWriter } from '@personal-server/core/logging/access-log'
import pino from 'pino'

function createMockGateway(): GatewayClient {
  return {
    isRegisteredBuilder: vi.fn().mockResolvedValue(true),
    getBuilder: vi.fn().mockResolvedValue(null),
    getGrant: vi.fn().mockResolvedValue(null),
  }
}

function createMockAccessLogWriter(): AccessLogWriter {
  return {
    write: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createApp', () => {
  let tempDir: string
  let indexManager: IndexManager

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'app-test-'))
    const db = initializeDatabase(':memory:')
    indexManager = createIndexManager(db)
  })

  afterEach(async () => {
    indexManager.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  function makeApp() {
    const logger = pino({ level: 'silent' })
    return createApp({
      logger,
      version: '0.0.1',
      startedAt: new Date(),
      indexManager,
      hierarchyOptions: { dataDir: join(tempDir, 'data') },
      serverOrigin: 'http://localhost:8080',
      serverOwner: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      gateway: createMockGateway(),
      accessLogWriter: createMockAccessLogWriter(),
    })
  }

  it('GET /health returns 200', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('healthy')
  })

  it('ProtocolError returns correct status and JSON body', async () => {
    const app = makeApp()

    app.get('/test-protocol-error', () => {
      throw new MissingAuthError({ reason: 'no token' })
    })

    const res = await app.request('/test-protocol-error')
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body.error.code).toBe(401)
    expect(body.error.errorCode).toBe('MISSING_AUTH')
    expect(body.error.message).toBe('Missing authentication')
    expect(body.error.details).toEqual({ reason: 'no token' })
  })

  it('unknown error returns 500 INTERNAL_ERROR', async () => {
    const app = makeApp()

    app.get('/test-unknown-error', () => {
      throw new Error('something broke')
    })

    const res = await app.request('/test-unknown-error')
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.error.code).toBe(500)
    expect(body.error.errorCode).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('Internal server error')
  })

  it('unknown route returns 404', async () => {
    const app = makeApp()
    const res = await app.request('/nonexistent')
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error.code).toBe(404)
    expect(body.error.errorCode).toBe('NOT_FOUND')
  })
})
