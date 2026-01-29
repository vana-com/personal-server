import { mkdir, readFile, writeFile, readdir, unlink, rename, stat, rm } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DataFileEnvelope } from '../../schemas/data-file.js'
import { DataFileEnvelopeSchema } from '../../schemas/data-file.js'
import { buildDataFilePath, buildScopeDir, filenameToTimestamp } from './paths.js'

export interface HierarchyManagerOptions {
  dataDir: string
}

export interface WriteResult {
  path: string
  relativePath: string
  sizeBytes: number
}

/** Atomic write: mkdir -p, write temp file, rename */
export async function writeDataFile(
  options: HierarchyManagerOptions,
  envelope: DataFileEnvelope,
): Promise<WriteResult> {
  const filePath = buildDataFilePath(options.dataDir, envelope.scope, envelope.collectedAt)
  const dir = dirname(filePath)

  await mkdir(dir, { recursive: true })

  const content = JSON.stringify(envelope, null, 2)
  const tempPath = filePath + '.tmp.' + randomUUID()

  await writeFile(tempPath, content, 'utf-8')
  await rename(tempPath, filePath)

  const stats = await stat(filePath)

  return {
    path: filePath,
    relativePath: relative(options.dataDir, filePath),
    sizeBytes: stats.size,
  }
}

/** Read and parse a data file */
export async function readDataFile(
  options: HierarchyManagerOptions,
  scope: string,
  collectedAt: string,
): Promise<DataFileEnvelope> {
  const filePath = buildDataFilePath(options.dataDir, scope, collectedAt)
  const content = await readFile(filePath, 'utf-8')
  return DataFileEnvelopeSchema.parse(JSON.parse(content))
}

/** List version filenames for a scope, newest first. Empty array if scope dir doesn't exist. */
export async function listVersions(
  options: HierarchyManagerOptions,
  scope: string,
): Promise<string[]> {
  const scopeDir = buildScopeDir(options.dataDir, scope)

  let entries: string[]
  try {
    entries = await readdir(scopeDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort().reverse()

  return jsonFiles.map((f) => filenameToTimestamp(f.replace('.json', '')))
}

/** Delete a single data file */
export async function deleteDataFile(
  options: HierarchyManagerOptions,
  scope: string,
  collectedAt: string,
): Promise<void> {
  const filePath = buildDataFilePath(options.dataDir, scope, collectedAt)
  await unlink(filePath)
}

/**
 * Delete all files for a scope by removing the scope directory recursively.
 * No-op if directory doesn't exist.
 */
export async function deleteAllForScope(
  options: HierarchyManagerOptions,
  scope: string,
): Promise<void> {
  const scopeDir = buildScopeDir(options.dataDir, scope)
  await rm(scopeDir, { recursive: true, force: true })
}
