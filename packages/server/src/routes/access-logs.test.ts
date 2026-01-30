import { describe, it, expect, vi } from "vitest";
import { pino } from "pino";
import type {
  AccessLogReader,
  AccessLogReadResult,
} from "@personal-server/core/logging/access-reader";
import {
  createTestWallet,
  buildWeb3SignedHeader,
} from "@personal-server/core/test-utils";
import { accessLogsRoutes } from "./access-logs.js";

const logger = pino({ level: "silent" });
const SERVER_ORIGIN = "http://localhost:8080";
const owner = createTestWallet(0);

function createMockReader(result: AccessLogReadResult): AccessLogReader {
  return {
    read: vi.fn().mockResolvedValue(result),
  };
}

function createApp(reader: AccessLogReader) {
  return accessLogsRoutes({
    logger,
    accessLogReader: reader,
    serverOrigin: SERVER_ORIGIN,
    serverOwner: owner.address,
  });
}

async function getWithOwnerAuth(
  app: ReturnType<typeof accessLogsRoutes>,
  query = "",
) {
  const auth = await buildWeb3SignedHeader({
    wallet: owner,
    aud: SERVER_ORIGIN,
    method: "GET",
    uri: "/",
  });
  return app.request(`/${query}`, {
    method: "GET",
    headers: { authorization: auth },
  });
}

describe("GET /", () => {
  it("returns { logs, total, limit: 50, offset: 0 } shape", async () => {
    const mockResult: AccessLogReadResult = {
      logs: [
        {
          logId: "log-1",
          grantId: "grant-1",
          builder: "0x1234567890abcdef1234567890abcdef12345678",
          action: "read",
          scope: "instagram.profile",
          timestamp: "2026-01-28T12:00:00Z",
          ipAddress: "127.0.0.1",
          userAgent: "TestAgent/1.0",
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };

    const reader = createMockReader(mockResult);
    const app = createApp(reader);

    const res = await getWithOwnerAuth(app);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.limit).toBe(50);
    expect(json.offset).toBe(0);
    expect(reader.read).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it("passes limit and offset query params to reader", async () => {
    const mockResult: AccessLogReadResult = {
      logs: [],
      total: 20,
      limit: 10,
      offset: 5,
    };

    const reader = createMockReader(mockResult);
    const app = createApp(reader);

    const res = await getWithOwnerAuth(app, "?limit=10&offset=5");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(10);
    expect(json.offset).toBe(5);
    expect(reader.read).toHaveBeenCalledWith({ limit: 10, offset: 5 });
  });

  it("returns empty logs when no access logs exist", async () => {
    const mockResult: AccessLogReadResult = {
      logs: [],
      total: 0,
      limit: 50,
      offset: 0,
    };

    const reader = createMockReader(mockResult);
    const app = createApp(reader);

    const res = await getWithOwnerAuth(app);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toEqual([]);
    expect(json.total).toBe(0);
  });

  it("defaults to limit=50 when non-numeric limit provided", async () => {
    const mockResult: AccessLogReadResult = {
      logs: [],
      total: 0,
      limit: 50,
      offset: 0,
    };

    const reader = createMockReader(mockResult);
    const app = createApp(reader);

    const res = await getWithOwnerAuth(app, "?limit=abc");

    expect(res.status).toBe(200);
    expect(reader.read).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });
});
