import type { MiddlewareHandler } from 'hono'
import type { GatewayClient } from '@personal-server/core/gateway'
import type { VerifiedAuth } from '@personal-server/core/auth'
import type { GatewayGrantResponse } from '@personal-server/core/grants'
import { scopeCoveredByGrant } from '@personal-server/core/scopes'
import {
  GrantRequiredError,
  GrantRevokedError,
  GrantExpiredError,
  ScopeMismatchError,
  InvalidSignatureError,
  ProtocolError,
} from '@personal-server/core/errors'

/**
 * Enforces grant for data reads. Must run AFTER web3-auth middleware.
 * Fetches grant from Gateway, checks revocation/expiry/scope/grantee.
 * Sets c.set('grant', grantResponse).
 */
export function createGrantCheckMiddleware(params: {
  gateway: GatewayClient
  serverOwner: `0x${string}`
}): MiddlewareHandler {
  const { gateway, serverOwner } = params

  return async (c, next) => {
    const auth = c.get('auth') as VerifiedAuth

    try {
      // 1. Extract grantId from auth payload
      const grantId = auth.payload.grantId
      if (!grantId) {
        throw new GrantRequiredError({ reason: 'No grantId in authorization payload' })
      }

      // 2. Fetch grant from Gateway
      const grant = await gateway.getGrant(grantId)
      if (!grant) {
        throw new GrantRequiredError({ reason: 'Grant not found', grantId })
      }

      // 3. Check revocation
      if (grant.revoked) {
        throw new GrantRevokedError({ grantId })
      }

      // 4. Check expiry (expiresAt > 0 && expiresAt < now means expired)
      if (grant.expiresAt > 0) {
        const now = Math.floor(Date.now() / 1000)
        if (grant.expiresAt < now) {
          throw new GrantExpiredError({ expiresAt: grant.expiresAt })
        }
      }

      // 5. Check scope coverage — extract scope from route param
      const scope = c.req.param('scope')
      if (scope && !scopeCoveredByGrant(scope, grant.scopes)) {
        throw new ScopeMismatchError({
          requestedScope: scope,
          grantedScopes: grant.scopes,
        })
      }

      // 6. Check grantee — signer must be the grant's builder
      if (auth.signer.toLowerCase() !== grant.builder.toLowerCase()) {
        throw new InvalidSignatureError({
          reason: 'Request signer is not the grant builder',
          expected: grant.builder,
          actual: auth.signer,
        })
      }

      // Set grant on context for downstream handlers
      c.set('grant', grant)
      await next()
    } catch (err) {
      if (err instanceof ProtocolError) {
        return c.json(err.toJSON(), err.code as 401 | 403)
      }
      throw err
    }
  }
}
