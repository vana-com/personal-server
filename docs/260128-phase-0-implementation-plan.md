# Phase 0: Skeleton — Atomic Implementation Plan

## Goal
Deliver a minimal, runnable personal server with: NPM workspace monorepo (3 packages), TypeScript composite project references, Hono HTTP server with `/health`, config loading with Zod validation, structured pino logging, server lifecycle (startup + graceful shutdown), and a composition root.

**Source of truth:** `@docs/260127-personal-server-scaffold.md` (Phase 0, sections 3-5)
**Vana protocol spec:** `docs/260121-data-portability-protocol-spec.md` (Reference when more details are needed)

---

## Dependency Graph

```
Layer 0 (all parallel):
  0.1  Root package.json + workspace config
  0.2  Root tsconfig.json + composite refs
  0.3  .gitignore + .nvmrc
  0.4  vitest.config.ts

Layer 1 (parallel, after Layer 0):
  1.1  Core package scaffold
  1.2  Server package scaffold
  1.3  CLI package scaffold (placeholder)

Layer 2 (after Layer 1 — partial parallelism):
  2.1  Zod config schema              (after 1.1)
  2.2  Config loader + tests          (after 2.1)
  2.3  Logger setup + tests           (after 2.1)
  2.4  Error catalog + tests          (after 1.1, parallel with 2.1)

Layer 3 (after Layer 2):
  3.1  Health route + tests            (after 2.4)
  3.2  Hono app setup + tests          (after 3.1, 2.4)
  3.3  Composition root + tests        (after 2.2, 2.3, 3.2)

Layer 4 (after Layer 3):
  4.1  Server entry point + lifecycle  (after 3.3)

Layer 5 (final):
  5.1  npm install + build + test      (after all)
```

**Critical path:** 0.1 → 1.1 → 2.1 → 2.2 → 3.3 → 4.1 → 5.1

---

## Tasks

### Layer 0: Root Project Setup

#### Task 0.1: Root package.json
- **Status:** `[x]`
- **Files:** `package.json`
- **Deps:** none
- **Spec:**
  ```json
  {
    "name": "personal-server-ts",
    "private": true,
    "workspaces": ["packages/*"],
    "scripts": {
      "build": "tsc --build",
      "clean": "tsc --build --clean",
      "test": "vitest run",
      "test:watch": "vitest",
      "lint": "tsc --noEmit"
    },
    "engines": { "node": ">=20.0.0" },
    "devDependencies": {
      "typescript": "^5.7.0",
      "vitest": "^3.0.0",
      "esbuild": "^0.24.0"
    }
  }
  ```
- **Done when:** File exists, has `workspaces: ["packages/*"]`, has build/test/lint scripts

#### Task 0.2: Root tsconfig.json
- **Status:** `[x]`
- **Files:** `tsconfig.json`
- **Deps:** none
- **Spec:**
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "target": "ES2022",
      "module": "Node16",
      "moduleResolution": "Node16",
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "composite": true
    },
    "references": [
      { "path": "packages/core" },
      { "path": "packages/server" },
      { "path": "packages/cli" }
    ],
    "exclude": ["node_modules", "dist"]
  }
  ```
- **Done when:** References all 3 packages, `strict: true`, `composite: true`, `ES2022` + `Node16`

#### Task 0.3: Git config files
- **Status:** `[x]`
- **Files:** `.gitignore`, `.nvmrc`
- **Deps:** none
- **`.gitignore`:** `node_modules/`, `dist/`, `*.tsbuildinfo`, `.DS_Store`, `coverage/`, `.env`, `*.log`
- **`.nvmrc`:** `20`

#### Task 0.4: Vitest config
- **Status:** `[x]`
- **Files:** `vitest.config.ts`
- **Deps:** none
- **Spec:**
  ```typescript
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: {
      globals: true,
      include: ['packages/*/src/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['packages/*/src/**/*.ts'],
        exclude: ['packages/*/src/**/*.test.ts'],
      },
    },
  })
  ```

---

### Layer 1: Package Scaffolds

#### Task 1.1: Core package scaffold
- **Status:** `[x]`
- **Files:** `packages/core/package.json`, `packages/core/tsconfig.json`
- **Deps:** 0.1, 0.2
- **package.json:** name `@personal-server/core`, `"type": "module"`, exports map for `./config`, `./logger`, `./errors`, `./schemas` subpaths. Deps: `pino ^9`, `pino-pretty ^13`, `zod ^3.24`
- **tsconfig.json:** extends `../../tsconfig.json`, `outDir: "dist"`, `rootDir: "src"`, `composite: true`. Exclude `src/**/*.test.ts`

#### Task 1.2: Server package scaffold
- **Status:** `[x]`
- **Files:** `packages/server/package.json`, `packages/server/tsconfig.json`
- **Deps:** 0.1, 0.2
- **package.json:** name `@personal-server/server`, `"type": "module"`. Deps: `@personal-server/core *`, `hono ^4.7`, `@hono/node-server ^1.14`. Scripts: `start`, `dev`
- **tsconfig.json:** extends root, references `../core`

#### Task 1.3: CLI package scaffold (placeholder)
- **Status:** `[x]`
- **Files:** `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/index.ts`
- **Deps:** 0.1, 0.2
- **package.json:** name `@personal-server/cli`, `"type": "module"`. Deps: `@personal-server/core *`, `@personal-server/server *`
- **tsconfig.json:** extends root, references `../core` and `../server`
- **src/index.ts:** placeholder export `main()` that logs "not yet implemented"

---

### Layer 2: Core Module Implementation

#### Task 2.1: Zod config schema
- **Status:** `[ ]`
- **Files:** `packages/core/src/schemas/server-config.ts`
- **Deps:** 1.1
- **Spec:** Export `ServerConfigSchema` (Zod object) and `ServerConfig` type. Fields:
  - `server.port` (int, 1-65535, default 8080)
  - `server.address` (string, optional — owner wallet)
  - `gatewayUrl` (url string, default `https://rpc.vana.org`)
  - `logging.level` (enum fatal/error/warn/info/debug, default info)
  - `logging.pretty` (boolean, default false)
  - `storage.backend` (enum local/vana/ipfs/gdrive/dropbox, default local)
  - All fields have defaults so empty `{}` is valid

#### Task 2.2: Config loader + tests
- **Status:** `[ ]`
- **Files:** `packages/core/src/config/defaults.ts`, `packages/core/src/config/loader.ts`, `packages/core/src/config/loader.test.ts`
- **Deps:** 2.1
- **defaults.ts:** Export `DEFAULT_CONFIG_DIR` (`~/.vana`), `DEFAULT_CONFIG_PATH` (`~/.vana/server.json`)
- **loader.ts:** `loadConfig(options?)` — reads JSON file, parses with Zod, returns `ServerConfig`. Falls back to defaults on ENOENT. Accepts `configPath` override for testing.
- **Tests (6 cases):**
  1. Returns defaults when file missing
  2. Parses valid config
  3. Merges partial config with defaults
  4. Throws ZodError for invalid config
  5. Throws for malformed JSON
  6. Accepts custom `configPath`
- **Verify:** `npx vitest run packages/core/src/config/`

#### Task 2.3: Logger setup + tests
- **Status:** `[ ]`
- **Files:** `packages/core/src/logger/index.ts`, `packages/core/src/logger/index.test.ts`
- **Deps:** 2.1 (for LoggingConfig type)
- **index.ts:** `createLogger(config: LoggingConfig): Logger` — pino instance, pretty when `config.pretty || NODE_ENV !== 'production'`
- **Tests (4 cases):**
  1. Creates logger with specified level
  2. Uses pino-pretty when `pretty: true`
  3. No pino-pretty when `pretty: false` + production
  4. Logger has standard pino methods
- **Verify:** `npx vitest run packages/core/src/logger/`

#### Task 2.4: Error catalog + tests
- **Status:** `[ ]`
- **Files:** `packages/core/src/errors/catalog.ts`, `packages/core/src/errors/catalog.test.ts`
- **Deps:** 1.1
- **catalog.ts:** `ProtocolError` base class (code, errorCode, message, details, toJSON). 10 subclasses:
  - 401: `MissingAuthError`, `InvalidSignatureError`, `UnregisteredBuilderError`, `NotOwnerError`, `ExpiredTokenError`
  - 403: `GrantRequiredError`, `GrantExpiredError`, `GrantRevokedError`, `ScopeMismatchError`
  - 413: `ContentTooLargeError`
- **Tests (5 cases):**
  1. ProtocolError has correct code/errorCode/message/details
  2. toJSON() returns serializable object
  3. Subclasses have correct HTTP code and error code
  4. All extend Error and ProtocolError
  5. Error name property set correctly
- **Verify:** `npx vitest run packages/core/src/errors/`

---

### Layer 3: Server Implementation

#### Task 3.1: Health route + tests
- **Status:** `[ ]`
- **Files:** `packages/server/src/routes/health.ts`, `packages/server/src/routes/health.test.ts`
- **Deps:** 2.4
- **health.ts:** `healthRoute(deps: { version, startedAt })` returns Hono sub-app. `GET /health` → `{ status: "healthy", version, uptime }` (uptime in seconds)
- **Tests (4 cases):**
  1. GET /health returns 200
  2. Body has status/version/uptime
  3. Uptime increases over time
  4. Content-Type is application/json
- **Verify:** `npx vitest run packages/server/src/routes/`

#### Task 3.2: Hono app setup + tests
- **Status:** `[ ]`
- **Files:** `packages/server/src/app.ts`, `packages/server/src/app.test.ts`
- **Deps:** 3.1, 2.4
- **app.ts:** `createApp(deps: { logger, version, startedAt })` returns Hono app. Mounts health route. Global error handler: ProtocolError → JSON with correct status; other errors → 500 INTERNAL_ERROR.
- **Tests (4 cases):**
  1. GET /health returns 200
  2. ProtocolError → correct status + JSON body
  3. Unknown error → 500 INTERNAL_ERROR
  4. Unknown route → 404
- **Verify:** `npx vitest run packages/server/src/app.test.ts`

#### Task 3.3: Composition root + tests
- **Status:** `[ ]`
- **Files:** `packages/server/src/bootstrap.ts`, `packages/server/src/bootstrap.test.ts`
- **Deps:** 2.2, 2.3, 3.2
- **bootstrap.ts:** `createServer(config: ServerConfig): ServerContext` — wires logger, app, config, startedAt. Returns `{ app, logger, config, startedAt }`.
- **Tests (4 cases):**
  1. Returns object with app/logger/config/startedAt
  2. app responds to GET /health
  3. Logger is valid pino instance
  4. startedAt is reasonable timestamp
- **Verify:** `npx vitest run packages/server/src/bootstrap.test.ts`

---

### Layer 4: Entry Point

#### Task 4.1: Server entry point + lifecycle
- **Status:** `[ ]`
- **Files:** `packages/server/src/index.ts`
- **Deps:** 3.3
- **Spec:** Loads config via `loadConfig()`, creates server via `createServer()`, starts HTTP via `@hono/node-server` `serve()`. Registers SIGTERM/SIGINT handlers for graceful shutdown (5s drain timeout). Logs "Server started" with port/version on start, "Server stopped" on shutdown.
- **Verify:** Manual — `node packages/server/dist/index.js`, `curl localhost:8080/health`, Ctrl+C shows shutdown log

---

### Layer 5: Final Verification

#### Task 5.1: Install, build, test
- **Status:** `[ ]`
- **Deps:** all previous
- **Steps:**
  1. `npm install` — succeeds
  2. `npm run build` (`tsc --build`) — all 3 packages compile
  3. `npm test` (`vitest run`) — all tests pass
  4. `node packages/server/dist/index.js` — server starts, `/health` returns JSON
  5. Ctrl+C — graceful shutdown logged

---

## File Inventory (22 files)

| Task | Files |
|------|-------|
| 0.1 | `package.json` |
| 0.2 | `tsconfig.json` |
| 0.3 | `.gitignore`, `.nvmrc` |
| 0.4 | `vitest.config.ts` |
| 1.1 | `packages/core/package.json`, `packages/core/tsconfig.json` |
| 1.2 | `packages/server/package.json`, `packages/server/tsconfig.json` |
| 1.3 | `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/index.ts` |
| 2.1 | `packages/core/src/schemas/server-config.ts` |
| 2.2 | `packages/core/src/config/defaults.ts`, `packages/core/src/config/loader.ts`, `packages/core/src/config/loader.test.ts` |
| 2.3 | `packages/core/src/logger/index.ts`, `packages/core/src/logger/index.test.ts` |
| 2.4 | `packages/core/src/errors/catalog.ts`, `packages/core/src/errors/catalog.test.ts` |
| 3.1 | `packages/server/src/routes/health.ts`, `packages/server/src/routes/health.test.ts` |
| 3.2 | `packages/server/src/app.ts`, `packages/server/src/app.test.ts` |
| 3.3 | `packages/server/src/bootstrap.ts`, `packages/server/src/bootstrap.test.ts` |
| 4.1 | `packages/server/src/index.ts` |

---

## Agent Parallelism Strategy

Tasks within the same layer can be dispatched to parallel agents when their deps are satisfied:

| Batch | Tasks | Agents |
|-------|-------|--------|
| 1 | 0.1, 0.2, 0.3, 0.4 | 4 parallel |
| 2 | 1.1, 1.2, 1.3 | 3 parallel |
| 3 | 2.1, 2.4 | 2 parallel (2.4 only needs 1.1) |
| 4 | 2.2, 2.3 | 2 parallel (both need 2.1) |
| 5 | 3.1 | 1 |
| 6 | 3.2 | 1 |
| 7 | 3.3 | 1 |
| 8 | 4.1 | 1 |
| 9 | 5.1 | 1 (verification) |
