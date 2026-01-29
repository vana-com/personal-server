import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createWeb3AuthMiddleware } from './web3-auth.js'
import { createGrantCheckMiddleware } from './grant-check.js'
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from '@personal-server/core/test-utils'
import type { GatewayClient } from '@personal-server/core/gateway'
import type { GatewayGrantResponse } from '@personal-server/core/grants'

const SERVER_ORIGIN = 'http://localhost:8080'
const wallet = createTestWallet(0)
const otherWallet = createTestWallet(1)

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
    expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    revoked: false,
    ...overrides,
  }
}

function createApp(gateway: GatewayClient, serverOwner: `0x${string}` = '0xOwnerAddress') {
  const app = new Hono()
  const web3Auth = createWeb3AuthMiddleware(SERVER_ORIGIN)
  const grantCheck = createGrantCheckMiddleware({ gateway, serverOwner })

  app.get('/v1/data/:scope', web3Auth, grantCheck, (c) => {
    const grant = c.get('grant')
    return c.json({ ok: true, grant })
  })

  return app
}

async function makeAuthRequest(
  app: Hono,
  options: { scope?: string; grantId?: string; useWallet?: typeof wallet } = {},
) {
  const { scope = 'instagram.profile', grantId = 'grant-123', useWallet = wallet } = options
  const header = await buildWeb3SignedHeader({
    wallet: useWallet,
    aud: SERVER_ORIGIN,
    method: 'GET',
    uri: `/v1/data/${scope}`,
    grantId,
  })
  return app.request(`/v1/data/${scope}`, {
    headers: { Authorization: header },
  })
}

describe('createGrantCheckMiddleware', () => {
  it('valid grant calls next and sets grant on context', async () => {
    const grant = makeGrant()
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(grant) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app)

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; grant: GatewayGrantResponse }
    expect(json.ok).toBe(true)
    expect(json.grant.grantId).toBe('grant-123')
    expect(gateway.getGrant).toHaveBeenCalledWith('grant-123')
  })

  it('missing grantId returns 403 GRANT_REQUIRED', async () => {
    const gateway = createMockGateway()
    const app = createApp(gateway)

    const header = await buildWeb3SignedHeader({
      wallet,
      aud: SERVER_ORIGIN,
      method: 'GET',
      uri: '/v1/data/instagram.profile',
      // no grantId
    })
    const res = await app.request('/v1/data/instagram.profile', {
      headers: { Authorization: header },
    })

    expect(res.status).toBe(403)
    const json = await res.json() as { error: { errorCode: string } }
    expect(json.error.errorCode).toBe('GRANT_REQUIRED')
  })

  it('grant not found returns 403 GRANT_REQUIRED', async () => {
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(null) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app)

    expect(res.status).toBe(403)
    const json = await res.json() as { error: { errorCode: string } }
    expect(json.error.errorCode).toBe('GRANT_REQUIRED')
  })

  it('revoked grant returns 403 GRANT_REVOKED', async () => {
    const grant = makeGrant({ revoked: true })
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(grant) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app)

    expect(res.status).toBe(403)
    const json = await res.json() as { error: { errorCode: string } }
    expect(json.error.errorCode).toBe('GRANT_REVOKED')
  })

  it('expired grant returns 403 GRANT_EXPIRED', async () => {
    const grant = makeGrant({ expiresAt: Math.floor(Date.now() / 1000) - 3600 }) // expired 1 hour ago
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(grant) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app)

    expect(res.status).toBe(403)
    const json = await res.json() as { error: { errorCode: string } }
    expect(json.error.errorCode).toBe('GRANT_EXPIRED')
  })

  it('scope mismatch returns 403 SCOPE_MISMATCH', async () => {
    const grant = makeGrant({ scopes: ['twitter.*'] }) // grant covers twitter, not instagram
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(grant) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app, { scope: 'instagram.profile' })

    expect(res.status).toBe(403)
    const json = await res.json() as { error: { errorCode: string } }
    expect(json.error.errorCode).toBe('SCOPE_MISMATCH')
  })

  it('grantee mismatch returns 401 INVALID_SIGNATURE', async () => {
    const grant = makeGrant({ builder: otherWallet.address }) // grant is for a different builder
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(grant) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app)

    expect(res.status).toBe(401)
    const json = await res.json() as { error: { errorCode: string } }
    expect(json.error.errorCode).toBe('INVALID_SIGNATURE')
  })

  it('expiresAt=0 (no expiry) passes', async () => {
    const grant = makeGrant({ expiresAt: 0 })
    const gateway = createMockGateway({ getGrant: vi.fn().mockResolvedValue(grant) })
    const app = createApp(gateway)

    const res = await makeAuthRequest(app)

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean }
    expect(json.ok).toBe(true)
  })
})
