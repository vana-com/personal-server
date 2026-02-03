import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_ROOT_PATH } from "./defaults.js";
import { expandHomePath, resolveRootPath } from "./paths.js";

describe("expandHomePath", () => {
  it('expands "~" to the current home directory', () => {
    expect(expandHomePath("~")).toBe(homedir());
  });

  it('expands "~/" prefixes to the current home directory', () => {
    expect(expandHomePath("~/data-connect/personal-server")).toBe(
      resolve(homedir(), "data-connect/personal-server"),
    );
  });

  it("leaves non-home paths unchanged", () => {
    expect(expandHomePath("/tmp/sandbox")).toBe("/tmp/sandbox");
  });
});

describe("resolveRootPath", () => {
  it("returns default root path when no input is provided", () => {
    expect(resolveRootPath()).toBe(resolve(DEFAULT_ROOT_PATH));
  });

  it("passes through absolute paths", () => {
    expect(resolveRootPath("/tmp/personal-server")).toBe(
      resolve("/tmp/personal-server"),
    );
  });

  it("resolves relative paths to absolute", () => {
    expect(resolveRootPath("relative/personal-server")).toBe(
      resolve("relative/personal-server"),
    );
  });
});
