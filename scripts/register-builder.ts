/**
 * Register a builder (grantee) with the Vana Gateway.
 *
 * Usage:
 *   VANA_OWNER_PRIVATE_KEY=0x... npm run register-builder
 *   VANA_OWNER_PRIVATE_KEY=0x... npm run register-builder https://my-builder-app.com
 *   PERSONAL_SERVER_ROOT_PATH=~/data-connect/personal-server VANA_OWNER_PRIVATE_KEY=0x... npm run register-builder
 */

import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../packages/core/src/config/loader.js";
import { resolveRootPath } from "../packages/core/src/config/paths.js";
import { loadOrCreateServerAccount } from "../packages/core/src/keys/server-account.js";
import {
  builderRegistrationDomain,
  BUILDER_REGISTRATION_TYPES,
  type BuilderRegistrationMessage,
} from "../packages/core/src/signing/index.js";
import { join } from "node:path";
import { readFileSync } from "node:fs";

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

  const keyPath = join(rootPath, "builder-key.json");
  const builderAccount = loadOrCreateServerAccount(keyPath);
  const builderPrivateKey = JSON.parse(readFileSync(keyPath, "utf-8"))
    .privateKey as string;
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
    message,
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
    console.log("Builder is already registered (409). Nothing to do.");
    return;
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
Grantee address: ${builderAccount.address}  (this is your GRANTEE_ADDRESS)
Public key:      ${builderAccount.publicKey}
App URL:         ${appUrl}
Builder ID:      ${(body as Record<string, unknown>).id ?? "unknown"}

Add these to your test builder app .env.local:
  BUILDER_PRIVATE_KEY=${builderPrivateKey}
  GRANTEE_ADDRESS=${builderAccount.address}
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
