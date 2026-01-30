# Vana Personal Server

[![CI](https://github.com/vana-com/personal-server-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/vana-com/personal-server-ts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@opendatalabs/personal-server-ts)](https://www.npmjs.com/package/@opendatalabs/personal-server-ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)

TypeScript implementation of the Vana Data Portability Protocol's Personal Server. Stores user data locally, serves it to authorized users via grant-enforced APIs, and syncs encrypted copies to storage backends.

## Architecture

NPM workspaces monorepo with three packages:

| Package           | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `packages/core`   | Protocol logic — auth, grants, scopes, storage, keys, gateway client |
| `packages/server` | Hono HTTP server — routes, middleware, composition root              |
| `packages/cli`    | CLI entry point (placeholder)                                        |

Data lives in `~/.vana/` — decrypted files in `data/`, local file index at `index.db`, config in `server.json`.

## Setup

```bash
node -v  # >= 20
npm install
cp .env.example .env   # dev/test master key — see file for details
npm run build
```

## Run

```bash
npm start             # build + start server
npm run dev           # run from source (no build step)
```

The server starts on the port defined in `~/.vana/server.json` (default: 8080). Health check at `GET /health`.

## Configuration

The server reads `~/.vana/server.json` on startup (created with defaults if missing).

```json
{
  "server": {
    "port": 8080
  },
  "logging": {
    "level": "info",
    "pretty": false
  },
  "storage": {
    "backend": "local"
  }
}
```

Set `"pretty": true` for human-readable logs during development.

## Test

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:e2e      # end-to-end tests (limited mocking)
```

Tests are co-located with source (`foo.ts` → `foo.test.ts`).

## API

All authenticated endpoints use `Authorization: Web3Signed <base64url(json)>.<signature>` — no sessions, no cookies.

| Endpoint                    | Method | Auth            | Purpose                |
| --------------------------- | ------ | --------------- | ---------------------- |
| `/health`                   | GET    | None            | Health check           |
| `/v1/data/{scope}`          | POST   | Owner           | Ingest data            |
| `/v1/data`                  | GET    | Builder         | List scopes            |
| `/v1/data/{scope}`          | GET    | Builder + Grant | Read data              |
| `/v1/data/{scope}/versions` | GET    | Builder         | List versions          |
| `/v1/data/{scope}`          | DELETE | Owner           | Delete data            |
| `/v1/grants`                | GET    | Owner           | List grants            |
| `/v1/grants/verify`         | POST   | None            | Verify grant signature |
| `/v1/access-logs`           | GET    | Owner           | Access history         |
| `/v1/sync/trigger`          | POST   | Owner           | Force sync             |
| `/v1/sync/status`           | GET    | Owner           | Sync status            |
| `/v1/sync/file/{fileId}`    | POST   | Owner           | Sync specific file     |

## Docs

- [DPv1 Protocol Spec](docs/260121-data-portability-protocol-spec.md) — canonical protocol behavior
- [Architecture](docs/260127-personal-server-scaffold.md) — design decisions and repo structure
