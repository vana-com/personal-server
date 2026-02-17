/**
 * Register a builder (grantee) with the Vana Gateway.
 *
 * Usage:
 *   VANA_OWNER_PRIVATE_KEY=0x... npm run register-builder
 *   VANA_OWNER_PRIVATE_KEY=0x... npm run register-builder https://my-builder-app.com
 *   PERSONAL_SERVER_ROOT_PATH=~/data-connect/personal-server VANA_OWNER_PRIVATE_KEY=0x... npm run register-builder
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../packages/core/src/config/loader.js";
import { resolveRootPath } from "../packages/core/src/config/paths.js";
import {
  builderRegistrationDomain,
  BUILDER_REGISTRATION_TYPES,
  type BuilderRegistrationMessage,
} from "../packages/core/src/signing/index.js";

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

  const builderPrivateKey = generatePrivateKey();
  const builderAccount = privateKeyToAccount(builderPrivateKey);
  console.log(`Grantee address: ${builderAccount.address}`);

  const config = await loadConfig({ rootPath });

  const appUrl = process.argv[2] ?? "http://localhost:3001";
  console.log(`App URL: ${appUrl}`);
  console.log(`Gateway URL: ${config.gateway.url}`);

  const message: BuilderRegistrationMessage = {
    ownerAddress: ownerAccount.address,
    granteeAddress: builderAccount.address,
    publicKey: builderAccount.publicKey,
    appUrl,
  };

  const domain = builderRegistrationDomain(config.gateway);

  const signature = await ownerAccount.signTypedData({
    domain: domain as Parameters<
      typeof ownerAccount.signTypedData
    >[0]["domain"],
    types: BUILDER_REGISTRATION_TYPES,
    primaryType: "BuilderRegistration",
    message: message as unknown as Record<string, unknown>,
  });

  console.log("Registering builder with gateway...");

  const res = await fetch(`${config.gateway.url}/v1/builders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Web3Signed ${signature}`,
    },
    body: JSON.stringify(message),
  });

  if (res.status === 409) {
    console.error(
      "This grantee address is already registered (409). " +
        "Each builder registration requires a unique grantee address.",
    );
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Registration failed: ${res.status} ${res.statusText}`);
    if (body) console.error(body);
    process.exit(1);
  }

  const body = await res.json();

  console.log(`
=== Builder registered successfully ===

Owner address:   ${ownerAccount.address}
Grantee address: ${builderAccount.address}
Public key:      ${builderAccount.publicKey}
App URL:         ${appUrl}
Builder ID:      ${(body as Record<string, unknown>).builderId ?? "unknown"}

Add these to your test builder app .env.local:
  VANA_APP_PRIVATE_KEY=${builderPrivateKey}
  APP_URL=${appUrl}
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
