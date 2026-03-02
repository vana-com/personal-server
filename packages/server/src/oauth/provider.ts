import { randomBytes, createHash } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface OAuthClientMetadata {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
}

export interface OAuthClient {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name?: string;
  client_id_issued_at: number;
}

interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
  scopes: string[];
  walletAddress?: `0x${string}`;
  createdAt: number;
}

interface TokenRecord {
  clientId: string;
  walletAddress: `0x${string}`;
  scopes: string[];
  expiresAt: number;
}

function generateId(): string {
  return randomBytes(32).toString("hex");
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class OAuthProvider {
  private clients = new Map<string, OAuthClient>();
  private pendingAuths = new Map<string, PendingAuth>();
  private tokens = new Map<string, TokenRecord>();
  private refreshTokens = new Map<
    string,
    { clientId: string; walletAddress: `0x${string}`; scopes: string[] }
  >();

  constructor(private readonly serverOwner: `0x${string}`) {}

  registerClient(metadata: OAuthClientMetadata): OAuthClient {
    if (!metadata.redirect_uris || metadata.redirect_uris.length === 0) {
      throw new Error("redirect_uris is required");
    }

    const client: OAuthClient = {
      client_id: generateId(),
      client_secret: generateId(),
      redirect_uris: metadata.redirect_uris,
      client_name: metadata.client_name,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    this.clients.set(client.client_id, client);
    return client;
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  createPendingAuth(opts: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    state: string | null;
    scopes: string[];
  }): string {
    const client = this.clients.get(opts.clientId);
    if (!client) throw new Error("Unknown client");
    if (!client.redirect_uris.includes(opts.redirectUri)) {
      throw new Error("Invalid redirect_uri");
    }

    const authCode = generateId();
    this.pendingAuths.set(authCode, {
      clientId: opts.clientId,
      redirectUri: opts.redirectUri,
      codeChallenge: opts.codeChallenge,
      codeChallengeMethod: opts.codeChallengeMethod,
      state: opts.state,
      scopes: opts.scopes,
      createdAt: Date.now(),
    });

    return authCode;
  }

  completeAuth(
    authCode: string,
    walletAddress: `0x${string}`,
  ): { redirectUri: string; state: string | null } {
    const pending = this.pendingAuths.get(authCode);
    if (!pending) throw new Error("Unknown auth code");
    pending.walletAddress = walletAddress;
    return { redirectUri: pending.redirectUri, state: pending.state };
  }

  exchangeCode(
    authCode: string,
    codeVerifier: string,
    clientId: string,
  ): {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
  } {
    const pending = this.pendingAuths.get(authCode);
    if (!pending) throw new Error("Invalid authorization code");
    if (pending.clientId !== clientId) throw new Error("Client mismatch");
    if (!pending.walletAddress) throw new Error("Authorization not completed");
    if (Date.now() - pending.createdAt > AUTH_CODE_TTL_MS) {
      this.pendingAuths.delete(authCode);
      throw new Error("Authorization code expired");
    }

    // Verify PKCE challenge
    if (!this.verifyCodeChallenge(codeVerifier, pending.codeChallenge)) {
      throw new Error("Invalid code_verifier");
    }

    // Single-use: remove the auth code
    this.pendingAuths.delete(authCode);

    const accessToken = generateId();
    const refreshToken = generateId();
    const expiresIn = Math.floor(TOKEN_TTL_MS / 1000);

    this.tokens.set(accessToken, {
      clientId,
      walletAddress: pending.walletAddress,
      scopes: pending.scopes,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });

    this.refreshTokens.set(refreshToken, {
      clientId,
      walletAddress: pending.walletAddress,
      scopes: pending.scopes,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
    };
  }

  verifyToken(token: string): AuthInfo | null {
    const record = this.tokens.get(token);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
      this.tokens.delete(token);
      return null;
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
    };
  }

  refreshAccessToken(
    refreshToken: string,
    clientId: string,
  ): {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
  } {
    const record = this.refreshTokens.get(refreshToken);
    if (!record) throw new Error("Invalid refresh token");
    if (record.clientId !== clientId) throw new Error("Client mismatch");

    // Rotate: remove old refresh token
    this.refreshTokens.delete(refreshToken);

    const newAccessToken = generateId();
    const newRefreshToken = generateId();
    const expiresIn = Math.floor(TOKEN_TTL_MS / 1000);

    this.tokens.set(newAccessToken, {
      clientId,
      walletAddress: record.walletAddress,
      scopes: record.scopes,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });

    this.refreshTokens.set(newRefreshToken, {
      clientId,
      walletAddress: record.walletAddress,
      scopes: record.scopes,
    });

    return {
      access_token: newAccessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Check if a wallet has access (is the owner or has a grant).
   * For now, only the server owner gets full access.
   */
  isAuthorizedWallet(walletAddress: `0x${string}`): boolean {
    return walletAddress.toLowerCase() === this.serverOwner.toLowerCase();
  }

  private verifyCodeChallenge(
    codeVerifier: string,
    codeChallenge: string,
  ): boolean {
    // S256: BASE64URL(SHA256(code_verifier)) === code_challenge
    const hash = createHash("sha256").update(codeVerifier).digest();
    const computed = hash
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return computed === codeChallenge;
  }
}
