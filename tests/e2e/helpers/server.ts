import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { ServerConfigSchema } from '../../../packages/core/src/schemas/server-config.js'
import { createServer } from '../../../packages/server/src/bootstrap.js'

export interface TestServer {
  url: string
  cleanup: () => Promise<void>
}

export async function startTestServer(options?: { gatewayUrl?: string }): Promise<TestServer> {
  const configDir = await mkdtemp(join(tmpdir(), 'e2e-server-'))

  const tempServer: ServerType = serve({ fetch: new Hono().fetch, port: 0 })
  const tempAddr = tempServer.address()
  if (!tempAddr || typeof tempAddr === 'string') {
    throw new Error('Failed to get temporary server address')
  }
  const port = (tempAddr as AddressInfo).port
  await new Promise<void>((resolve, reject) => {
    tempServer.close((err) => (err ? reject(err) : resolve()))
  })

  const config = ServerConfigSchema.parse({
    server: { port, origin: `http://localhost:${port}` },
    gatewayUrl: options?.gatewayUrl ?? 'http://localhost:9999',
    logging: { level: 'fatal' },
  })

  const context = createServer(config, { configDir })

  const server: ServerType = serve({
    fetch: context.app.fetch,
    port,
  })

  const url = `http://localhost:${port}`

  return {
    url,
    cleanup: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
      context.cleanup()
      await rm(configDir, { recursive: true, force: true })
    },
  }
}
