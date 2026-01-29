/**
 * Check if a requested concrete scope is covered by a single grant scope pattern.
 * Patterns:
 *   "*"                -> matches any scope
 *   "instagram.*"      -> matches any scope starting with "instagram."
 *   "instagram.profile" -> exact match only
 */
export function scopeMatchesPattern(requestedScope: string, grantPattern: string): boolean {
  if (grantPattern === '*') return true

  if (grantPattern.endsWith('.*')) {
    const prefix = grantPattern.slice(0, -1) // "instagram." from "instagram.*"
    return requestedScope.startsWith(prefix)
  }

  return requestedScope === grantPattern
}

/**
 * Check if a requested scope is covered by ANY of the granted scope patterns.
 */
export function scopeCoveredByGrant(requestedScope: string, grantedScopes: string[]): boolean {
  return grantedScopes.some((pattern) => scopeMatchesPattern(requestedScope, pattern))
}
