import { describe, it, expect, vi, beforeEach } from "vitest";
import { uiRoute } from "./ui.js";

// Mock fs.readFileSync to avoid needing the actual HTML file during tests
vi.mock("node:fs", () => ({
  readFileSync: () =>
    '<html><script>const TOKEN = "__DEV_TOKEN__";</script></html>',
}));

describe("uiRoute", () => {
  const DEV_TOKEN = "test-dev-token-456";

  beforeEach(() => {
    // Reset the cached HTML between tests by clearing the module-level cache
    // Since we mocked readFileSync, each test gets a fresh read
  });

  it("serves HTML with dev token injected", async () => {
    const app = uiRoute({ devToken: DEV_TOKEN });

    const res = await app.request("/");

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`const TOKEN = "${DEV_TOKEN}";`);
    expect(html).not.toContain("__DEV_TOKEN__");
  });

  it("returns HTML content type", async () => {
    const app = uiRoute({ devToken: DEV_TOKEN });

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
