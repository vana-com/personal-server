import { describe, it, expect } from 'vitest'
import { createServer } from './bootstrap.js'
import { ServerConfigSchema } from '@personal-server/core/schemas'

function makeDefaultConfig() {
  return ServerConfigSchema.parse({})
}

describe('createServer', () => {
  it('returns object with app, logger, config, startedAt', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config)

    expect(ctx).toHaveProperty('app')
    expect(ctx).toHaveProperty('logger')
    expect(ctx).toHaveProperty('config')
    expect(ctx).toHaveProperty('startedAt')
  })

  it('app responds to GET /health', async () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config)

    const res = await ctx.app.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('healthy')
  })

  it('logger is a valid pino instance', () => {
    const config = makeDefaultConfig()
    const ctx = createServer(config)

    expect(typeof ctx.logger.info).toBe('function')
    expect(typeof ctx.logger.error).toBe('function')
    expect(typeof ctx.logger.warn).toBe('function')
    expect(typeof ctx.logger.debug).toBe('function')
  })

  it('startedAt is a reasonable timestamp', () => {
    const before = new Date()
    const config = makeDefaultConfig()
    const ctx = createServer(config)
    const after = new Date()

    expect(ctx.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(ctx.startedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})
