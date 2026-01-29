import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer } from './bootstrap.js'
import { ServerConfigSchema } from '@personal-server/core/schemas'

function makeDefaultConfig() {
  return ServerConfigSchema.parse({})
}

describe('createServer', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bootstrap-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns object with app, logger, config, startedAt', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    expect(ctx).toHaveProperty('app')
    expect(ctx).toHaveProperty('logger')
    expect(ctx).toHaveProperty('config')
    expect(ctx).toHaveProperty('startedAt')
    ctx.cleanup()
  })

  it('app responds to GET /health', async () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    const res = await ctx.app.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('healthy')
    ctx.cleanup()
  })

  it('logger is a valid pino instance', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    expect(typeof ctx.logger.info).toBe('function')
    expect(typeof ctx.logger.error).toBe('function')
    expect(typeof ctx.logger.warn).toBe('function')
    expect(typeof ctx.logger.debug).toBe('function')
    ctx.cleanup()
  })

  it('startedAt is a reasonable timestamp', () => {
    const before = new Date()
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })
    const after = new Date()

    expect(ctx.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(ctx.startedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    ctx.cleanup()
  })

  it('ServerContext has indexManager property', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    expect(ctx).toHaveProperty('indexManager')
    expect(typeof ctx.indexManager.insert).toBe('function')
    expect(typeof ctx.indexManager.findByPath).toBe('function')
    expect(typeof ctx.indexManager.close).toBe('function')
    ctx.cleanup()
  })

  it('ServerContext has cleanup function', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    expect(typeof ctx.cleanup).toBe('function')
    ctx.cleanup()
  })

  it('app responds to POST /v1/data/test.scope with 201', async () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    const res = await ctx.app.request('/v1/data/test.scope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.scope).toBe('test.scope')
    expect(body.status).toBe('stored')
    ctx.cleanup()
  })

  it('cleanup() can be called without error', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config, { configDir: tempDir })

    expect(() => ctx.cleanup()).not.toThrow()
  })
})
