import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createApp } from './app.js'
import { ProtocolError, MissingAuthError } from '@personal-server/core/errors'
import pino from 'pino'

function makeApp() {
  const logger = pino({ level: 'silent' })
  return createApp({ logger, version: '0.0.1', startedAt: new Date() })
}

describe('createApp', () => {
  it('GET /health returns 200', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('healthy')
  })

  it('ProtocolError returns correct status and JSON body', async () => {
    const app = makeApp()

    // Add a test route that throws a ProtocolError
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
