/**
 * Endpoint ownership matrix.
 *
 * Defines which routes are served on which transport (HTTP vs IPC)
 * and what auth model applies to each.
 */

export type Transport = "http" | "ipc" | "both";

export type AuthModel =
  | "none"
  | "local-only"
  | "web3-signed"
  | "web3-signed+owner"
  | "web3-signed+builder"
  | "web3-signed+builder+grant";

export interface EndpointSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  transport: Transport;
  auth: AuthModel;
  description: string;
}

/**
 * Canonical endpoint ownership matrix.
 *
 * HTTP transport: routes reachable through FRP tunnel by builders.
 * IPC transport: routes reachable only via UDS by local clients (DataBridge/CLI).
 */
export const ENDPOINT_MATRIX: readonly EndpointSpec[] = [
  // --- Protocol routes (HTTP) ---
  {
    method: "GET",
    path: "/health",
    transport: "http",
    auth: "none",
    description: "Health check and server info",
  },
  {
    method: "GET",
    path: "/v1/data",
    transport: "http",
    auth: "web3-signed+builder",
    description: "List available scopes",
  },
  {
    method: "GET",
    path: "/v1/data/:scope/versions",
    transport: "http",
    auth: "web3-signed+builder",
    description: "List versions for a scope",
  },
  {
    method: "GET",
    path: "/v1/data/:scope",
    transport: "http",
    auth: "web3-signed+builder+grant",
    description: "Read data for a scope (grant required)",
  },
  {
    method: "POST",
    path: "/v1/grants/verify",
    transport: "http",
    auth: "none",
    description: "Verify a grant EIP-712 signature",
  },

  // --- Admin routes (IPC) ---
  {
    method: "POST",
    path: "/v1/data/:scope",
    transport: "ipc",
    auth: "none",
    description: "Ingest data (local-only)",
  },
  {
    method: "DELETE",
    path: "/v1/data/:scope",
    transport: "ipc",
    auth: "none",
    description: "Delete scope data (local-only)",
  },
  {
    method: "GET",
    path: "/v1/grants",
    transport: "ipc",
    auth: "none",
    description: "List grants (local-only)",
  },
  {
    method: "POST",
    path: "/v1/grants",
    transport: "ipc",
    auth: "none",
    description: "Create grant (local-only)",
  },
  {
    method: "GET",
    path: "/v1/access-logs",
    transport: "ipc",
    auth: "none",
    description: "Read access logs (local-only)",
  },
  {
    method: "GET",
    path: "/v1/sync",
    transport: "ipc",
    auth: "none",
    description: "Get sync status (local-only)",
  },
  {
    method: "POST",
    path: "/v1/sync",
    transport: "ipc",
    auth: "none",
    description: "Trigger sync (local-only)",
  },
] as const;
