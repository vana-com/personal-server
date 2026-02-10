# Publish core, server, and facade packages to npm

## Motivation

The [databridge](https://github.com/vana-com/databridge) desktop app bundles personal-server-ts and manages its lifecycle (auto-starts after login, finds free port). Currently it pulls the entire monorepo as a private GitHub git dependency:

```json
"personal-server-ts": "github:vana-com/personal-server-ts#main"
```

with a postinstall script that runs `npm install && npm run build` inside the cloned monorepo, then deep-imports internal packages:

```js
import { loadConfig } from "./node_modules/personal-server-ts/packages/core/dist/config/index.js";
import { createServer } from "./node_modules/personal-server-ts/packages/server/dist/bootstrap.js";
```

### CI/CD failure

The databridge release workflow ([failing run](https://github.com/vana-com/databridge/actions/runs/21558994761/job/62119948769)) breaks on Windows because:

1. The `personal-server/package.json` dependency `github:vana-com/personal-server-ts#main` triggers npm to run `git ls-remote ssh://git@github.com/vana-com/personal-server-ts.git`
2. The workflow configures a GH_PAT via `git config --global url."https://x-access-token:${GH_PAT}@github.com/"...` but `${GH_PAT}` doesn't expand in the Windows PowerShell runner
3. Result: `Permission denied (publickey)` → build fails

### Underlying issues (even if auth is fixed)

- Fragile postinstall that builds the monorepo from source inside `node_modules`
- Deep path imports into monorepo internals (break on any structural refactor)
- No versioning — `#main` is a moving target
- Slow installs (git clone + full npm install + TypeScript compilation)

## Solution

Two changes, in order:

### 1. Make the repo public

Go to https://github.com/vana-com/personal-server-ts/settings → Change visibility → Public.

This immediately unblocks the databridge CI (no auth needed for public repos), buying time for the proper fix.

### 2. Publish core and server as public npm packages, and make the top-level package a facade

Rename internal packages and publish under the existing `@opendatalabs` npm scope:

| Current package                                            | Published npm package                       | Role                                                 |
| ---------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `@personal-server/core`                                    | `@opendatalabs/personal-server-ts-core`     | low-level protocol primitives                        |
| `@personal-server/server`                                  | `@opendatalabs/personal-server-ts-server`   | server composition and bootstrap API                 |
| `@opendatalabs/personal-server-ts` (placeholder CLI today) | `@opendatalabs/personal-server-ts` (facade) | stable integration entrypoint for app/tool consumers |
| _future package_                                           | `@opendatalabs/personal-server-ts-cli`      | actual CLI executable (`bin`)                        |

After publishing, databridge replaces its git dependency with the facade package:

```json
"dependencies": {
  "@opendatalabs/personal-server-ts": "^0.0.1"
}
```

and imports cleanly via one stable entrypoint:

```js
import { loadConfig, createServer } from "@opendatalabs/personal-server-ts";
```

Internally, the facade depends on `-core` and `-server` and re-exports a curated API for consumers.

No private git dep, no postinstall build, no deep path imports, proper semver, and no confusing top-level package that points to an unimplemented CLI.

---

## Implementation stages

### Stage 1: Rename packages and define package boundaries

**Goal**: All internal references use the new names, and the top-level package is a real library facade.
**Status**: Not Started

#### 1a. Update package.json files

- `packages/core/package.json`: rename to `@opendatalabs/personal-server-ts-core`, add `publishConfig` and `files`
- `packages/server/package.json`: rename to `@opendatalabs/personal-server-ts-server`, add `publishConfig` and `files`, update core dependency name
- `packages/cli/package.json`: keep name `@opendatalabs/personal-server-ts`, change description from CLI to facade, update dependencies to core and server with new names
- `packages/cli/package.json`: add explicit facade exports (root entrypoint that re-exports selected APIs)

#### 1b. Make `server` import-safe for libraries

- `packages/server`: change package root export to API module (e.g. `createServer`), not process-starting runtime code
- Keep standalone runtime in a separate module/export (for local dev/start scripts), but do not expose it as the default consumer import surface

#### 1c. Rename all TypeScript imports (57 occurrences across ~24 files)

Global find-and-replace:

- `@personal-server/core` → `@opendatalabs/personal-server-ts-core`
- `@personal-server/server` → `@opendatalabs/personal-server-ts-server`

#### 1d. Implement facade exports

- `packages/cli/src/index.ts`: remove placeholder implementation and re-export curated APIs (e.g. `loadConfig`, `createServer`, and key types)
- Keep facade intentionally small: only exports needed by databridge + other expected consumers

#### 1e. Update tsconfig path mappings

- `tests/e2e/tsconfig.json`: update path mapping keys to new package names

#### Success criteria

- `npm run build` succeeds
- `npm test` passes
- `npm pack --dry-run` in core, server, and facade shows only `dist/` files
- `node -e "import('@opendatalabs/personal-server-ts').then(m => console.log(Object.keys(m)))"` shows expected facade exports (local pack/install check)

---

### Stage 2: Update CI workflows to publish all packages

**Goal**: Prerelease and release workflows publish core, server, and facade in dependency order.
**Status**: Not Started

#### 2a. `.github/workflows/prerelease.yml`

Update to version and publish all three packages (core → server → facade), with cross-references updated to the canary version.

#### 2b. `.releaserc.yaml`

Add `@semantic-release/npm` entries for core and server before facade.

#### Success criteria

- Push to `feat/*` triggers prerelease workflow
- All three packages appear on npmjs.com with canary tag
- `npm install @opendatalabs/personal-server-ts@canary` works

---

## Verification

1. `npm run build` — all packages compile with new import paths
2. `npm test` — all tests pass
3. `cd packages/core && npm pack --dry-run` — verify only `dist/` is included
4. `cd packages/server && npm pack --dry-run` — same
5. `cd packages/cli && npm pack --dry-run` — same (facade package)
6. After push, verify prerelease workflow publishes all 3 packages
7. `npm view @opendatalabs/personal-server-ts` — package exists and is installable
