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
import type { Hono } from 'hono'
import { createApp } from './app.js'

export interface ServerContext {
  app: Hono
  logger: Logger
  config: ServerConfig
  startedAt: Date
  indexManager: IndexManager
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

  const app = createApp({
    logger,
    version: '0.0.1',
    startedAt,
    indexManager,
    hierarchyOptions,
  })

  const cleanup = () => {
    indexManager.close()
  }

  return { app, logger, config, startedAt, indexManager, cleanup }
}
