/**
 * Register this Personal Server with the Vana Gateway.
 *
 * Usage:
 *   VANA_OWNER_PRIVATE_KEY=0x... npm run register-server
 *   VANA_OWNER_PRIVATE_KEY=0x... npm run register-server https://my-server.com
 *   PERSONAL_SERVER_ROOT_PATH=~/data-connect/personal-server VANA_OWNER_PRIVATE_KEY=0x... npm run register-server
 */

import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../packages/core/src/config/loader.js";
import { resolveRootPath } from "../packages/core/src/config/paths.js";
import { loadOrCreateServerAccount } from "../packages/core/src/keys/server-account.js";
import {
  serverRegistrationDomain,
  SERVER_REGISTRATION_TYPES,
  type ServerRegistrationMessage,
} from "../packages/core/src/signing/index.js";
import { join } from "node:path";
import { buildTunnelUrl } from "../packages/server/src/tunnel/verify.js";

async function main() {
  const ownerKey = process.env.VANA_OWNER_PRIVATE_KEY;
  if (!ownerKey) {
    console.error(
      "Error: VANA_OWNER_PRIVATE_KEY environment variable is required.",
    );
    process.exit(1);
  }

  const rootPath = resolveRootPath(process.env.PERSONAL_SERVER_ROOT_PATH);

  const normalizedKey = ownerKey.startsWith("0x")
    ? (ownerKey as `0x${string}`)
    : (`0x${ownerKey}` as `0x${string}`);
  const ownerAccount = privateKeyToAccount(normalizedKey);
  console.log(`Owner address: ${ownerAccount.address}`);

  const keyPath = join(rootPath, "key.json");
  const serverAccount = loadOrCreateServerAccount(keyPath);
  console.log(`Server address: ${serverAccount.address}`);

  const config = await loadConfig({ rootPath });

  let serverUrl: string;
  if (process.argv[2]) {
    serverUrl = process.argv[2];
  } else if (config.tunnel.enabled) {
    serverUrl = buildTunnelUrl(serverAccount.address);
  } else {
    serverUrl = config.server.origin;
  }
  console.log(`Server URL: ${serverUrl}`);
  console.log(`Gateway URL: ${config.gateway.url}`);

  const message: ServerRegistrationMessage = {
    ownerAddress: ownerAccount.address,
    serverAddress: serverAccount.address,
    publicKey: serverAccount.publicKey,
    serverUrl,
  };

  const domain = serverRegistrationDomain(config.gateway);

  const signature = await ownerAccount.signTypedData({
    domain: domain as Parameters<
      typeof ownerAccount.signTypedData
    >[0]["domain"],
    types: SERVER_REGISTRATION_TYPES,
    primaryType: "ServerRegistration",
    message: message as unknown as Record<string, unknown>,
  });

  console.log("Registering server with gateway...");

  const res = await fetch(`${config.gateway.url}/v1/servers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Web3Signed ${signature}`,
    },
    body: JSON.stringify(message),
  });

  if (res.status === 409) {
    console.log("Server is already registered (409). Nothing to do.");
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Registration failed: ${res.status} ${res.statusText}`);
    if (body) console.error(body);
    process.exit(1);
  }

  const body = await res.json();
  console.log("Server registered successfully:", JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
