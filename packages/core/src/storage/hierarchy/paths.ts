import { join } from "node:path";
import { scopeToPathSegments } from "../../scopes/parse.js";

/** "2026-01-21T10:00:00Z" → "2026-01-21T10-00-00Z" */
export function timestampToFilename(isoTimestamp: string): string {
  return isoTimestamp.replace(/:/g, "-");
}

/** "2026-01-21T10-00-00Z" → "2026-01-21T10:00:00Z" */
export function filenameToTimestamp(filename: string): string {
  // Replace hyphens that appear in the time portion (after the T) back to colons.
  // The date portion also has hyphens (2026-01-21) which must stay.
  // Pattern: after T, every hyphen that separates HH-MM-SS should become a colon.
  const tIndex = filename.indexOf("T");
  if (tIndex === -1) return filename;
  const datePart = filename.slice(0, tIndex);
  const timePart = filename.slice(tIndex);
  return datePart + timePart.replace(/-/g, ":");
}

/** Full file path: join(baseDir, ...scopeSegments, timestamp.json) */
export function buildDataFilePath(
  baseDir: string,
  scope: string,
  collectedAt: string,
): string {
  const segments = scopeToPathSegments(scope);
  const filename = timestampToFilename(collectedAt) + ".json";
  return join(baseDir, ...segments, filename);
}

/** Directory path for a scope */
export function buildScopeDir(baseDir: string, scope: string): string {
  const segments = scopeToPathSegments(scope);
  return join(baseDir, ...segments);
}

/** Generate current UTC timestamp without milliseconds, ending in Z */
export function generateCollectedAt(): string {
  const now = new Date();
  now.setMilliseconds(0);
  return now.toISOString().replace(".000Z", "Z");
}
