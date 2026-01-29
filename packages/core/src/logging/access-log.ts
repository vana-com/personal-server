import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface AccessLogEntry {
  logId: string
  grantId: string
  builder: string
  action: 'read'
  scope: string
  timestamp: string
  ipAddress: string
  userAgent: string
}

export interface AccessLogWriter {
  write(entry: AccessLogEntry): Promise<void>
}

function formatDateForFilename(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function createAccessLogWriter(logsDir: string): AccessLogWriter {
  let dirCreated = false

  return {
    async write(entry: AccessLogEntry): Promise<void> {
      if (!dirCreated) {
        await mkdir(logsDir, { recursive: true })
        dirCreated = true
      }

      const dateStr = formatDateForFilename(entry.timestamp)
      const filename = `access-${dateStr}.log`
      const filepath = join(logsDir, filename)

      await appendFile(filepath, JSON.stringify(entry) + '\n', 'utf-8')
    },
  }
}
