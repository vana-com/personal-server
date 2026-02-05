/**
 * FRP tunnel module for establishing reverse proxy connections.
 */

export { generateSignedClaim, base64urlEncode } from "./auth.js";
export type { SignedClaim, ClaimPayload, ClaimConfig } from "./auth.js";

export { generateFrpcConfig } from "./config.js";
export type { FrpcConfigOptions } from "./config.js";

export { TunnelManager } from "./manager.js";
export type {
  TunnelConfig,
  TunnelStatus,
  TunnelStatusInfo,
} from "./manager.js";
