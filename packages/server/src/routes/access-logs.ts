/**
 * Access logs routes — GET / returns paginated access log entries.
 * Owner auth is wired in Task 4.1.
 */

import { Hono } from "hono";
import type { Logger } from "pino";
import type { AccessLogReader } from "@opendatalabs/personal-server-ts-core/logging/access-reader";
import { createWeb3AuthMiddleware } from "../middleware/web3-auth.js";
import { createOwnerCheckMiddleware } from "../middleware/owner-check.js";

export interface AccessLogsRouteDeps {
  logger: Logger;
  accessLogReader: AccessLogReader;
  serverOrigin: string | (() => string);
  serverOwner?: `0x${string}`;
  devToken?: string;
}

export function accessLogsRoutes(deps: AccessLogsRouteDeps): Hono {
  const app = new Hono();

  const web3Auth = createWeb3AuthMiddleware({
    serverOrigin: deps.serverOrigin,
    devToken: deps.devToken,
    serverOwner: deps.serverOwner,
  });
  const ownerCheck = createOwnerCheckMiddleware(deps.serverOwner);

  // GET / — list access logs with pagination (owner auth required)
  app.get("/", web3Auth, ownerCheck, async (c) => {
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");

    const limit = limitParam !== undefined ? parseInt(limitParam, 10) : 50;
    const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : 0;

    const result = await deps.accessLogReader.read({
      limit: Number.isNaN(limit) ? 50 : limit,
      offset: Number.isNaN(offset) ? 0 : offset,
    });

    return c.json(result);
  });

  return app;
}
