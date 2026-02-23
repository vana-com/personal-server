/**
 * Tunnel URL helpers: build the canonical tunnel URL and verify reachability.
 */

export interface VerifyTunnelOptions {
  /** Maximum number of attempts (default: 5) */
  maxAttempts?: number;
  /** Delay between retries in ms (default: 2000) */
  retryDelayMs?: number;
  /** Timeout per request in ms (default: 5000) */
  timeoutMs?: number;
  /** Custom fetch implementation (for testing) */
  fetchFn?: typeof fetch;
}

export interface VerifyTunnelResult {
  reachable: boolean;
  attempts: number;
  error?: string;
}

const ALLOWED_SERVER_ADDRS: Record<string, string> = {
  "frpc.server.vana.org": "server.vana.org",
  "frpc.server-dev.vana.org": "server-dev.vana.org",
};

const DEFAULT_DOMAIN = "server.vana.org";

/**
 * Build the canonical tunnel URL for a wallet address.
 */
export function buildTunnelUrl(
  walletAddress: string,
  serverAddr?: string,
): string {
  const domain =
    (serverAddr && ALLOWED_SERVER_ADDRS[serverAddr]) || DEFAULT_DOMAIN;
  return `https://${walletAddress.toLowerCase()}.${domain}`;
}

/**
 * Verify that a tunnel URL is reachable by hitting its /health endpoint.
 * Retries on failure with configurable attempts, delay, and timeout.
 */
export async function verifyTunnelUrl(
  publicUrl: string,
  options?: VerifyTunnelOptions,
): Promise<VerifyTunnelResult> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 2000;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const fetchFn = options?.fetchFn ?? fetch;

  const healthUrl = `${publicUrl}/health`;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchFn(healthUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return { reachable: true, attempts: attempt };
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return { reachable: false, attempts: maxAttempts, error: lastError };
}
