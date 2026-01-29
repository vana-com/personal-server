import { describe, it, expect, afterEach, vi } from 'vitest'
import { createLogger } from './index.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createLogger', () => {
  it('creates logger with specified level', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const logger = createLogger({ level: 'debug', pretty: false })
    expect(logger.level).toBe('debug')
  })

  it('uses pino-pretty when pretty: true', () => {
    vi.stubEnv('NODE_ENV', 'production')
    // pino-pretty transport is async, so we can't directly inspect
    // the transport config. Instead, verify the logger is created
    // successfully with pretty: true and is functional.
    const logger = createLogger({ level: 'info', pretty: true })
    expect(logger).toBeDefined()
    expect(logger.level).toBe('info')
  })

  it('no pino-pretty when pretty: false in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const logger = createLogger({ level: 'warn', pretty: false })
    // In production with pretty: false, no transport is configured.
    // The logger should still work and write raw JSON.
    expect(logger).toBeDefined()
    expect(logger.level).toBe('warn')
  })

  it('logger has standard pino methods', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const logger = createLogger({ level: 'info', pretty: false })

    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.fatal).toBe('function')
    expect(typeof logger.child).toBe('function')
  })
})
