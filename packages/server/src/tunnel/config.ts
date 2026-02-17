/**
 * FRP client configuration generation.
 *
 * Generates frpc.toml configuration for connecting to the FRP server.
 */

export interface FrpcConfigOptions {
  serverAddr: string;
  serverPort: number;
  localPort: number;
  subdomain: string;
  walletAddress: string;
  ownerAddress: string;
  runId: string;
  authClaim: string;
  authSig: string;
}

/**
 * Derive a unique proxy name from the runId.
 * Uses the first 8 characters to avoid FRP proxy name collisions
 * between concurrent or stale sessions.
 */
export function deriveProxyName(runId: string): string {
  return `ps-${runId.slice(0, 8)}`;
}

/**
 * Generate frpc.toml configuration content.
 *
 * Uses TOML format with:
 * - serverAddr/serverPort for FRP control plane connection
 * - loginFailExit = false for resilience (keeps trying on auth failure)
 * - HTTP proxy with subdomain routing
 * - Root-level metadatas for Auth Plugin validation (required by frps server)
 */
export function generateFrpcConfig(options: FrpcConfigOptions): string {
  const proxyName = deriveProxyName(options.runId);

  return `# Auto-generated frpc configuration
# Do not edit - regenerated on each server start

serverAddr = "${options.serverAddr}"
serverPort = ${options.serverPort}
loginFailExit = false

# Metadata for Auth Plugin validation (at root level for Login operation)
metadatas.wallet = "${options.walletAddress}"
metadatas.owner = "${options.ownerAddress}"
metadatas.run_id = "${options.runId}"
metadatas.auth_claim = "${options.authClaim}"
metadatas.auth_sig = "${options.authSig}"

[[proxies]]
name = "${proxyName}"
type = "http"
localIP = "127.0.0.1"
localPort = ${options.localPort}
subdomain = "${options.subdomain}"
[proxies.requestHeaders.set]
x-ps-transport = "tunnel"
`;
}
