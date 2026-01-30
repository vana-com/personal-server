# Contributing to Personal Server

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js >= 20
- npm (ships with Node)
- Git

### Setup

```bash
git clone https://github.com/vana-com/personal-server-ts.git
cd personal-server-ts
npm install
npm run build
```

### Project Structure

This is an npm workspaces monorepo:

| Package           | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `packages/core`   | Protocol logic — auth, grants, scopes, storage     |
| `packages/server` | Hono HTTP server — routes, middleware, composition |
| `packages/cli`    | CLI entry point                                    |

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feat/my-feature   # or fix/my-fix, docs/my-docs
```

### 2. Make Changes

- Write tests alongside your code (`foo.ts` -> `foo.test.ts`)
- Follow existing patterns in the codebase
- Keep changes focused and minimal

### 3. Validate

```bash
npm run validate   # runs lint, format check, and tests
```

Or individually:

```bash
npm run lint          # TypeScript type checking
npm run lint:eslint   # ESLint
npm run format:check  # Prettier
npm test              # Vitest
```

### 4. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new scope type for photos
fix: correct grant expiry check
docs: update API endpoint table
chore: bump vitest to v4
refactor: extract auth middleware
test: add coverage for sync retry
ci: add CodeQL workflow
```

Commits are validated by commitlint via a Git hook.

### 5. Open a Pull Request

- Fill out the PR template
- Ensure CI passes (lint, format, tests on Node 20 + 22)
- Keep PRs small — one logical change per PR

## Testing

```bash
npm test              # all unit tests
npm run test:watch    # watch mode
npm run test:e2e      # end-to-end tests
```

Tests are co-located with source files. Use the existing test utilities in `packages/core/src/test-utils/`.

## Code Style

- **Formatter**: Prettier (2-space indent, double quotes, semicolons, trailing commas)
- **Linter**: ESLint with typescript-eslint
- **Types**: TypeScript strict mode — no `any` without justification

Both are enforced via pre-commit hooks (husky + lint-staged).

## Security

If you discover a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
