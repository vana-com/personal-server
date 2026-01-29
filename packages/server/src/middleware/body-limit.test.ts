import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createBodyLimit, DATA_INGEST_MAX_SIZE, DEFAULT_MAX_SIZE } from './body-limit.js'

describe('createBodyLimit', () => {
  function createApp(maxSize: number) {
    const app = new Hono()
    app.post('/upload', createBodyLimit(maxSize), async (c) => {
      await c.req.json()
      return c.json({ ok: true }, 200)
    })
    return app
  }

  it('request within limit passes through with 200', async () => {
    const app = createApp(1024)
    const body = JSON.stringify({ hello: 'world' })
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('request exceeding limit returns 413 with error JSON', async () => {
    const maxSize = 16
    const app = createApp(maxSize)
    const body = JSON.stringify({ data: 'x'.repeat(100) })
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    })
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.error).toBe('CONTENT_TOO_LARGE')
    expect(json.message).toContain(`${maxSize} bytes`)
  })

  it('constants have correct values', () => {
    expect(DATA_INGEST_MAX_SIZE).toBe(52428800)
    expect(DEFAULT_MAX_SIZE).toBe(1048576)
  })
})
