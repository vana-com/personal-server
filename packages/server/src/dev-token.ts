import { randomBytes } from "node:crypto";

/**
 * Generates a random 32-byte hex string for use as an ephemeral dev token.
 * This token is generated once at startup and lives only in memory.
 */
export function generateDevToken(): string {
  return randomBytes(32).toString("hex");
}
