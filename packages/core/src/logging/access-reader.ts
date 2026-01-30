import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccessLogEntry } from "./access-log.js";

export interface AccessLogReadResult {
  logs: AccessLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AccessLogReader {
  read(options?: {
    limit?: number;
    offset?: number;
  }): Promise<AccessLogReadResult>;
}

/**
 * Reads all access-*.log files from logsDir, merges entries,
 * sorts by timestamp DESC, and paginates.
 */
export function createAccessLogReader(logsDir: string): AccessLogReader {
  return {
    async read(options?: {
      limit?: number;
      offset?: number;
    }): Promise<AccessLogReadResult> {
      const limit = options?.limit ?? 50;
      const offset = options?.offset ?? 0;

      let filenames: string[];
      try {
        filenames = await readdir(logsDir);
      } catch {
        // Directory doesn't exist — return empty result
        return { logs: [], total: 0, limit, offset };
      }

      const logFiles = filenames.filter(
        (f) => f.startsWith("access-") && f.endsWith(".log"),
      );

      const allEntries: AccessLogEntry[] = [];

      for (const filename of logFiles) {
        const filepath = join(logsDir, filename);
        const content = await readFile(filepath, "utf-8");
        const lines = content
          .split("\n")
          .filter((line) => line.trim().length > 0);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AccessLogEntry;
            allEntries.push(entry);
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Sort by timestamp DESC (newest first)
      allEntries.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        return tb - ta;
      });

      const total = allEntries.length;
      const paginated = allEntries.slice(offset, offset + limit);

      return { logs: paginated, total, limit, offset };
    },
  };
}
