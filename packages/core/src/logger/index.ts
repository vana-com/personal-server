import pino, { type Logger } from 'pino'
import type { LoggingConfig } from '../schemas/server-config.js'

export type { Logger } from 'pino'

export function createLogger(config: LoggingConfig): Logger {
  const usePretty =
    config.pretty || process.env.NODE_ENV !== 'production'

  return pino({
    level: config.level,
    ...(usePretty
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  })
}
