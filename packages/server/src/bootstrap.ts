import type { ServerConfig } from '@personal-server/core/schemas'
import { createLogger, type Logger } from '@personal-server/core/logger'
import type { Hono } from 'hono'
import { createApp } from './app.js'

export interface ServerContext {
  app: Hono
  logger: Logger
  config: ServerConfig
  startedAt: Date
}

export function createServer(config: ServerConfig): ServerContext {
  const logger = createLogger(config.logging)
  const startedAt = new Date()
  const app = createApp({ logger, version: '0.0.1', startedAt })

  return { app, logger, config, startedAt }
}
