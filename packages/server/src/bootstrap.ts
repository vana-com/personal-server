import { join } from 'node:path'
import type { ServerConfig } from '@personal-server/core/schemas'
import { DEFAULT_CONFIG_DIR } from '@personal-server/core/config'
import { createLogger, type Logger } from '@personal-server/core/logger'
import {
  initializeDatabase,
  createIndexManager,
  type IndexManager,
} from '@personal-server/core/storage/index'
import type { HierarchyManagerOptions } from '@personal-server/core/storage/hierarchy'
import { createGatewayClient } from '@personal-server/core/gateway'
import type { GatewayClient } from '@personal-server/core/gateway'
import { createAccessLogWriter } from '@personal-server/core/logging/access-log'
import type { Hono } from 'hono'
import { createApp } from './app.js'

export interface ServerContext {
  app: Hono
  logger: Logger
  config: ServerConfig
  startedAt: Date
  indexManager: IndexManager
  gatewayClient: GatewayClient
  cleanup: () => void
}

export interface CreateServerOptions {
  configDir?: string
}

export function createServer(config: ServerConfig, options?: CreateServerOptions): ServerContext {
  const logger = createLogger(config.logging)
  const startedAt = new Date()

  const configDir = options?.configDir ?? DEFAULT_CONFIG_DIR
  const dataDir = join(configDir, 'data')
  const indexPath = join(configDir, 'index.db')

  const db = initializeDatabase(indexPath)
  const indexManager = createIndexManager(db)
  const hierarchyOptions: HierarchyManagerOptions = { dataDir }

  const gatewayClient = createGatewayClient(config.gatewayUrl)

  const serverPort = config.server.port
  const serverOrigin = config.server.origin ?? `http://localhost:${serverPort}`
  const serverOwner = (config.server.address
    ?? '0x0000000000000000000000000000000000000000') as `0x${string}`

  const logsDir = join(configDir, 'logs')
  const accessLogWriter = createAccessLogWriter(logsDir)

  const app = createApp({
    logger,
    version: '0.0.1',
    startedAt,
    indexManager,
    hierarchyOptions,
    serverOrigin,
    serverOwner,
    gateway: gatewayClient,
    accessLogWriter,
  })

  const cleanup = () => {
    indexManager.close()
  }

  return { app, logger, config, startedAt, indexManager, gatewayClient, cleanup }
}
