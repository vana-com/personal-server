import { Hono } from "hono";
import { recoverServerOwner } from "@opendatalabs/personal-server-ts-core/keys";
import type { OAuthProvider } from "./provider.js";

const ACCOUNT_PORTAL_ORIGIN = "https://account.vana.org";

export interface OAuthRouteDeps {
  oauthProvider: OAuthProvider;
  serverOwner: `0x${string}`;
}

export function oauthRoutes(deps: OAuthRouteDeps): Hono {
  const app = new Hono();
  const { oauthProvider } = deps;

  // --- Discovery endpoints ---

  app.get("/.well-known/oauth-authorization-server", (c) => {
    const issuer = new URL(c.req.url).origin;
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  app.get("/.well-known/oauth-protected-resource", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      resource: origin,
      authorization_servers: [origin],
    });
  });

  // --- Dynamic Client Registration (RFC 7591) ---

  app.post("/register", async (c) => {
    try {
      const body = await c.req.json();
      const client = oauthProvider.registerClient({
        redirect_uris: body.redirect_uris,
        client_name: body.client_name,
        token_endpoint_auth_method: body.token_endpoint_auth_method,
      });

      return c.json(
        {
          client_id: client.client_id,
          client_secret: client.client_secret,
          redirect_uris: client.redirect_uris,
          client_name: client.client_name,
          client_id_issued_at: client.client_id_issued_at,
        },
        201,
      );
    } catch (err) {
      return c.json(
        { error: "invalid_client_metadata", error_description: String(err) },
        400,
      );
    }
  });

  // --- Authorization endpoint ---

  app.get("/authorize", (c) => {
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method");
    const state = c.req.query("state") ?? null;
    const scope = c.req.query("scope") ?? "";
    const responseType = c.req.query("response_type");

    if (responseType !== "code") {
      return c.json({ error: "unsupported_response_type" }, 400);
    }
    if (!clientId || !redirectUri || !codeChallenge) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing required parameters",
        },
        400,
      );
    }
    if (codeChallengeMethod !== "S256") {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Only S256 code_challenge_method is supported",
        },
        400,
      );
    }

    const client = oauthProvider.getClient(clientId);
    if (!client) {
      return c.json({ error: "invalid_client" }, 400);
    }
    if (!client.redirect_uris.includes(redirectUri)) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "redirect_uri not registered",
        },
        400,
      );
    }

    const scopes = scope ? scope.split(" ") : [];

    let authCode: string;
    try {
      authCode = oauthProvider.createPendingAuth({
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        state,
        scopes,
      });
    } catch (err) {
      return c.json(
        { error: "server_error", error_description: String(err) },
        500,
      );
    }

    // Redirect to Account Portal for identity verification.
    // The callback URL points back to our /oauth/callback with the auth code as state.
    const origin = new URL(c.req.url).origin;
    const callbackUrl = `${origin}/oauth/callback`;

    const portalParams = new URLSearchParams({
      // Use a placeholder sessionId — the Account Portal requires one to render the connect page.
      // We pass the authCode via the redirect_uri so it comes back to us.
      sessionId: `mcp-oauth-${authCode.slice(0, 8)}`,
      redirect_uri: callbackUrl,
      oauth_state: authCode,
      appName: client.client_name ?? "MCP Client",
    });

    return c.redirect(
      `${ACCOUNT_PORTAL_ORIGIN}/connect?${portalParams.toString()}`,
    );
  });

  // --- OAuth callback (receives wallet proof from Account Portal) ---

  app.get("/oauth/callback", async (c) => {
    const masterKeySig = c.req.query("masterKeySig") as
      | `0x${string}`
      | undefined;
    const authCode = c.req.query("oauth_state");

    if (!masterKeySig || !authCode) {
      return c.text("Missing masterKeySig or oauth_state parameter", 400);
    }

    // Recover wallet address from the master key signature
    let walletAddress: `0x${string}`;
    try {
      walletAddress = await recoverServerOwner(masterKeySig);
    } catch {
      return c.text("Invalid master key signature", 400);
    }

    // Check authorization: must be the server owner
    if (!oauthProvider.isAuthorizedWallet(walletAddress)) {
      return c.text("Unauthorized: wallet is not the server owner", 403);
    }

    // Complete the pending auth with the verified wallet
    let authResult: { redirectUri: string; state: string | null };
    try {
      authResult = oauthProvider.completeAuth(authCode, walletAddress);
    } catch (err) {
      return c.text(`Authorization failed: ${err}`, 400);
    }

    // Redirect back to the OAuth client (e.g., Claude) with the auth code
    const redirectUrl = new URL(authResult.redirectUri);
    redirectUrl.searchParams.set("code", authCode);
    if (authResult.state) {
      redirectUrl.searchParams.set("state", authResult.state);
    }

    return c.redirect(redirectUrl.toString());
  });

  // --- Token endpoint ---

  app.post("/token", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    let body: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      body = Object.fromEntries(
        Object.entries(formData).map(([k, v]) => [k, String(v)]),
      );
    } else {
      body = await c.req.json();
    }

    const grantType = body.grant_type;
    const clientId = body.client_id;

    if (!clientId) {
      return c.json(
        { error: "invalid_client", error_description: "Missing client_id" },
        400,
      );
    }

    try {
      if (grantType === "authorization_code") {
        const code = body.code;
        const codeVerifier = body.code_verifier;
        if (!code || !codeVerifier) {
          return c.json(
            {
              error: "invalid_request",
              error_description: "Missing code or code_verifier",
            },
            400,
          );
        }

        const tokens = oauthProvider.exchangeCode(code, codeVerifier, clientId);
        return c.json(tokens);
      }

      if (grantType === "refresh_token") {
        const refreshToken = body.refresh_token;
        if (!refreshToken) {
          return c.json(
            {
              error: "invalid_request",
              error_description: "Missing refresh_token",
            },
            400,
          );
        }

        const tokens = oauthProvider.refreshAccessToken(refreshToken, clientId);
        return c.json(tokens);
      }

      return c.json({ error: "unsupported_grant_type" }, 400);
    } catch (err) {
      return c.json(
        { error: "invalid_grant", error_description: String(err) },
        400,
      );
    }
  });

  return app;
}
