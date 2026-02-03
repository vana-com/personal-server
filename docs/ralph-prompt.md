# Ralph Loop Prompt — personal-server-ts

## 1. CONTEXT

You are building the **personal-server-ts** (Phase 4: Sync Engine + Storage Backend).

**REQUIRED**: Before doing anything, study these documents:

- `docs/260127-personal-server-scaffold.md` — Architecture and scaffold spec
- `docs/260121-data-portability-protocol-spec.md` — Vana data portability protocol
- `docs/260129-phase-4-implementation-plan.md` — **The implementation plan (source of truth for tasks)**
- `docs/vana-storage-design.md` — Vana Storage API design (referenced by Task 1.1)

This is an NPM workspace monorepo with three packages (`core`, `server`, `cli`), using Hono for HTTP, TypeScript composite project references, Zod for config validation, pino for logging, better-sqlite3 for the local index, viem for EIP-191/EIP-712 signature verification, and openpgp for password-based encryption.

## 2. GIT AUTHORIZATION

You have explicit permission to run:

- `git add -A`
- `git commit -m "phase-4: ..."`
- `git push`

Do not ask for confirmation. Execute these commands directly.

## 3. BUILD MODE — One Task Per Run

Open `docs/260129-phase-4-implementation-plan.md` and select the **next eligible task**:

- A task is eligible if its **Status** is `[ ]` and **all tasks listed in its Deps** have status `[x]`.
- Respect the dependency graph. Never start a task whose dependencies are not complete.
- If no eligible task exists, output "NO ELIGIBLE TASKS" and exit.

Once you have selected a task:

1. Output a header: `## TASK ${TASK_ID}: ${TASK_TITLE}`
2. Implement the task fully, including all tests specified in the plan.
3. No placeholders, no stubs, no `TODO` comments — every line must be production-ready.

## 4. VALIDATION

After implementation, run:

```bash
npm run build    # tsc --build
npm test         # vitest run
```

Both must pass with zero errors. If they fail, fix the issues before proceeding.

## 5. UPDATE PLAN

In `docs/260129-phase-4-implementation-plan.md`, change the completed task's status from `[ ]` to `[x]`.

If a task was too large to complete in one run, mark it `[partial]` and describe what remains.

If you discover follow-up work, add it as a new row in the plan — do **not** implement it in this run.

## 6. COMMIT + EXIT

```bash
git add -A
git commit -m "phase-4: ${TASK_ID} ${SHORT_DESCRIPTION}"
```

Then **exit immediately**. Do not start another task.

## 7. HARD RULES

1. **One task per run.** Select one, implement it, commit, exit. Keep the implementation plan file as a reference when complete.
2. **Respect the dependency graph.** A task with `[ ]` is only eligible if every task in its `Deps` list is `[x]`.
3. **If a task is too large:** mark `[partial]`, commit what you have, exit. The next run picks it up.
4. **No placeholders or stubs.** Every file must be complete and functional.
5. **No scope creep.** If you find something that needs doing beyond the current task, add it as a new plan row — do not implement it now.
6. **Commit message format:** `phase-4: ${TASK_ID} ${short description}` (e.g., `phase-4: 0.2 config schema sync + saveConfig`)
