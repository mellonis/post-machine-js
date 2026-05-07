# Widen `@turing-machine-js/machine` peer dep to v4 (#58) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `@post-machine-js/machine` to 4.0.0 with peer dep `@turing-machine-js/machine` `^4.0.0`, align `PostMachine.run()` with v4's async `run()`, and expose `__onDebugBreak` as an experimental pass-through. Per-instruction breakpoints filed as a separate issue (out of scope here).

**Architecture:** Single-package change. The override of `TuringMachine.run()` becomes `async`, awaits the parent, and forwards a `__onDebugBreak` callback (double-underscore = experimental, may rename when the breakpoint API lands). All existing tests and README examples migrate from `pm.run()` to `await pm.run()`. `MachineState` is re-exported so consumers can type their callbacks without depending on the upstream package directly.

**Tech Stack:** TypeScript (project references), Jest (with `moduleNameMapper` to `dist/index.cjs`), Lerna + npm workspaces, ESLint (flat config, `typescript-eslint` recommended). Runs against the published `@turing-machine-js/machine@4.0.0` from npm.

**Spec:** `docs/superpowers/specs/2026-05-07-issue-58-turing-v4-peer-dep-design.md`

---

## Task 1: Branch from updated master and file the breakpoint follow-up issue

**Files:** none (workspace + GitHub state only).

- [ ] **Step 1: Sync master**

```sh
git checkout master
git fetch origin master
git rebase origin/master
```

Expected: branch up to date with `origin/master`. (Per the user's git workflow, all branches must start from an updated default branch.)

- [ ] **Step 2: Create the work branch**

```sh
git checkout -b v4-0-0
```

Branch name follows the prior release-prep convention (`v3-0-0`, `v3-0-1`, `v3-1-0`).

- [ ] **Step 3: File the per-instruction breakpoint follow-up issue**

```sh
gh issue create --repo mellonis/post-machine-js \
  --title "Per-instruction breakpoint API for PostMachine.run()" \
  --body "$(cat <<'EOF'
Follow-up to #58. With turing v4, `state.debug` per-state breakpoints are runtime-mutable on each `State`. PostMachine consumers can already reach this surface by introspecting `pm.initialState`, but the ergonomic ask is a PostMachine-level API that addresses breakpoints by instruction index (and possibly subroutine path).

Sketch (subject to design):

```ts
pm.setBreakpoint(20, { before: true });
pm.setBreakpoint('rightToBlank', 2, { after: '*' });
pm.clearBreakpoints();
```

Open design questions:

- Naming: `setBreakpoint` / `breakpoint(index)` / something else?
- Scope: per-instance vs per-state-graph (clones inherit?).
- Subroutines: addressed by `(name, localIndex)` tuple or by flat global ID?
- Filter syntax: should it accept the same `state.debug.before/.after` shape as upstream, or simplify?
- How does it interact with the experimental `__onDebugBreak` parameter currently exposed on `pm.run()` (#58)?

The `__onDebugBreak` `__` prefix is the contract that lets this future API restructure the surface without another major bump.
EOF
)"
```

Capture the issue number from the output for the CLAUDE.md update in Task 9.

- [ ] **Step 4: Commit the spec + plan**

```sh
git add docs/superpowers/specs/2026-05-07-issue-58-turing-v4-peer-dep-design.md \
        docs/superpowers/plans/2026-05-07-issue-58-turing-v4-peer-dep.md
git commit -m "$(cat <<'EOF'
docs: spec and plan for #58 (turing v4 peer dep)

Captures the decision to drop v3 support, bump @post-machine-js/machine
to 4.0.0, expose v4's onDebugBreak as __onDebugBreak (experimental),
and defer the per-instruction breakpoint API to a follow-up issue.
EOF
)"
```

---

## Task 2: Install turing v4 and observe the build break

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/machine/package.json`
- Modify: `package-lock.json` (regenerated)

- [ ] **Step 1: Bump root + package manifests to v4**

In `package.json` (root), update `dependencies`:

```json
"dependencies": {
  "@turing-machine-js/machine": "^4.0.0"
}
```

In `packages/machine/package.json`, update both `peerDependencies` and `devDependencies`:

```json
"peerDependencies": {
  "@turing-machine-js/machine": "^4.0.0"
},
"devDependencies": {
  "@turing-machine-js/machine": "^4.0.0"
}
```

Do NOT yet bump the package's own `"version"` — that comes in Task 9, gated behind a clean build + tests, so the version label and the actual passing state move together.

- [ ] **Step 2: Reinstall**

```sh
npm install
```

Expected: `package-lock.json` updates, `node_modules/@turing-machine-js/machine/package.json` shows `"version": "4.0.0"`. Verify:

```sh
node -p "require('@turing-machine-js/machine/package.json').version"
```

Expected output: `4.0.0`.

- [ ] **Step 3: Run the build to confirm the override is now broken**

```sh
npm run build
```

Expected: TypeScript compile error from `packages/machine/src/classes/PostMachine.ts` around the `run` override — the parent now returns `Promise<void>`, the override declares `void`, and/or the parent's parameter shape (`onDebugBreak`) is no longer matched. (Exact TS diagnostic depends on the v4 method shape — record it for Task 3's red-state evidence.)

- [ ] **Step 4: Commit the dep bump as a checkpoint**

```sh
git add package.json package-lock.json packages/machine/package.json
git commit -m "$(cat <<'EOF'
chore(deps): widen @turing-machine-js/machine to ^4.0.0

Build is intentionally broken at this commit — the PostMachine.run
override still has the v3 sync signature. Fixed in the next commit.
EOF
)"
```

---

## Task 3: Make `PostMachine.run()` async (red → green via the build)

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts:73-75`

- [ ] **Step 1: Rewrite the `run` override**

Open `packages/machine/src/classes/PostMachine.ts`. Replace lines 73-75 (the existing `run` override) with:

```ts
override async run({
  stepsLimit = 1e5,
  onStep,
  __onDebugBreak,
}: {
  stepsLimit?: number;
  onStep?: (machineState: MachineState) => void;
  __onDebugBreak?: (machineState: MachineState) => void | Promise<void>;
} = {}): Promise<void> {
  await super.run({
    initialState: this.#initialState,
    stepsLimit,
    onStep,
    onDebugBreak: __onDebugBreak,
  });
}
```

Leave the `runStepByStep` override at lines 77-79 untouched — v4 keeps `runStepByStep` synchronous.

- [ ] **Step 2: Re-run the build**

```sh
npm run build
```

Expected: PASS. The override now matches the parent's `Promise<void>` return type and forwards `onDebugBreak`.

- [ ] **Step 3: Run the existing tests to observe the second-order break**

```sh
npm test 2>&1 | tail -40
```

Expected: many failures across `packages/machine/test/*.spec.ts` and `test/examples.spec.ts`. The pattern: `expect(machine.tape.symbols.join('').trim()).toBe('***')` runs *before* the now-async `pm.run()` resolves, so the tape is still untouched. These will be fixed in Task 5.

- [ ] **Step 4: Commit the override change**

```sh
git add packages/machine/src/classes/PostMachine.ts
git commit -m "$(cat <<'EOF'
feat!: PostMachine.run is now async, matches turing v4

BREAKING CHANGE: pm.run() now returns Promise<void>. Callers must
await it. Adds an experimental __onDebugBreak callback that forwards
to turing v4's onDebugBreak parameter; the __ prefix marks it unstable
pending the per-instruction breakpoint API design.
EOF
)"
```

---

## Task 4: Add the v4-specific tests (TDD for the new behavior)

**Files:**
- Create: `packages/machine/test/v4.spec.ts`

The existing `v3.spec.ts` covers re-export sentinel identity and v3-utility behavior. `v4.spec.ts` is the parallel file for the v4 surface — async `run()` semantics and `__onDebugBreak` forwarding.

- [ ] **Step 1: Write the failing tests**

Create `packages/machine/test/v4.spec.ts`:

```ts
// v4-specific tests — async run() semantics and the experimental
// __onDebugBreak forwarding. Mirrors v3.spec.ts structure; both files
// stay non-README (README-driven tests live in examples.spec.ts).

import {
  PostMachine,
  Tape,
  type MachineState,
  check, mark, right, stop,
} from '../src/index';

describe('PostMachine v4 — async run', () => {
  function buildWalkAndMark(): PostMachine {
    return new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });
  }

  test('run() returns a Promise', () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    const result = machine.run();
    expect(result).toBeInstanceOf(Promise);
    return result; // ensure jest waits for halt
  });

  test('run() resolves only after the machine halts', async () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    // Before run resolves, the tape should be the input.
    expect(machine.tape.symbols.join('').trim()).toBe('**');

    await machine.run();

    expect(machine.tape.symbols.join('').trim()).toBe('***');
  });

  test('onStep still observes every step', async () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    const seen: number[] = [];
    await machine.run({
      onStep: (s: MachineState) => { seen.push(s.step); },
    });

    expect(seen.length).toBeGreaterThan(0);
    // Steps are 1-indexed and monotonically increasing.
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(seen.length);
  });
});

describe('PostMachine v4 — __onDebugBreak forwarding', () => {
  test('__onDebugBreak fires when state.debug is set on a reachable state', async () => {
    const machine = new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    // Attach a `before` breakpoint on the initial state. Per turing v4,
    // setting `state.debug` is runtime-mutable; the upstream run() loop
    // checks it on each iteration boundary.
    machine.initialState.debug = { before: true };

    const seen: MachineState[] = [];
    await machine.run({
      __onDebugBreak: (s) => { seen.push(s); },
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].debugBreak).toEqual({ before: true });
  });

  test('run() awaits an async __onDebugBreak before resolving', async () => {
    const machine = new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    machine.initialState.debug = { before: true };

    let asyncCallbackResolved = false;
    await machine.run({
      __onDebugBreak: async () => {
        await new Promise((r) => setTimeout(r, 10));
        asyncCallbackResolved = true;
      },
    });

    // If run() resolved before the async callback finished, this would be false.
    expect(asyncCallbackResolved).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new tests in isolation**

```sh
npx jest packages/machine/test/v4.spec.ts
```

Expected: all 5 tests PASS. (The implementation in Task 3 already supports them — this file is the green confirmation that the override does the right thing for the new surface, and the regression suite for future changes to it.)

If any test fails, do NOT skip ahead — diagnose and fix the override before moving on. Likely failure modes: forgetting to forward `onDebugBreak`, forgetting `await`, or mismatched parameter name.

- [ ] **Step 3: Commit**

```sh
git add packages/machine/test/v4.spec.ts
git commit -m "test: cover async run() and __onDebugBreak forwarding"
```

---

## Task 5: Migrate existing test call sites to `await`

**Files:**
- Modify: `packages/machine/test/custom-alphabet.spec.ts` (8 sites)
- Modify: `packages/machine/test/examples.spec.ts` (3 sites)
- Modify: `packages/machine/test/machine.spec.ts` (~17 sites)
- Modify: `test/examples.spec.ts` (3 sites)

Mechanical migration: every `machine.run(...)` (or `<name>.run(...)`) call site becomes `await machine.run(...)`, and the enclosing `it`/`test` callback becomes `async` if it isn't already.

- [ ] **Step 1: Find every call site**

```sh
grep -rn '\.run(' packages/machine/test test 2>/dev/null
```

Expected: ~31 lines across the four files listed above. Cross-reference with the spec's "Files changed" section. (Note: `super.run(...)` inside `PostMachine.ts` is not a test site — leave it alone.)

- [ ] **Step 2: Migrate `packages/machine/test/examples.spec.ts`**

For each `test('...', () => { ... machine.run(); ... })`:
- Change the callback to `async () => { ... await machine.run(); ... }`.

Concretely, the three sites are at lines 26, 52, 109. Each is inside a synchronous `test(...)` callback. Convert callback to `async`, prefix the `.run()` call with `await`. Leave the surrounding assertions in place — they already follow the run.

- [ ] **Step 3: Migrate `test/examples.spec.ts` (root)**

Same pattern as Step 2 for the three sites at lines 34, 80, 95.

- [ ] **Step 4: Migrate `packages/machine/test/custom-alphabet.spec.ts`**

Same pattern for the eight sites at lines 85, 101, 124, 144, 170, 190, 228, 247.

- [ ] **Step 5: Migrate `packages/machine/test/machine.spec.ts`**

This one has more sites and some are inside multi-statement `it` blocks. Walk through each line returned by Step 1, prefix `await`, and ensure the enclosing callback is `async`. Watch for `forEach` loops over machines that internally call `.run()` — those need `for ... of` + `await`, not `forEach + await`.

A safe scan strategy: re-run

```sh
grep -n '\.run(' packages/machine/test/machine.spec.ts
```

after each pass and confirm each non-comment hit has `await` immediately to the left.

- [ ] **Step 6: Run the full suite**

```sh
npm test 2>&1 | tail -20
```

Expected: all tests PASS, including v4.spec.ts from Task 4. If anything still fails, re-run Step 1's grep against the failing file and fix any missed call site.

- [ ] **Step 7: Commit**

```sh
git add packages/machine/test test/examples.spec.ts
git commit -m "test: await machine.run() across the migrated test suite"
```

---

## Task 6: Re-export `MachineState` for callback typing

**Files:**
- Modify: `packages/machine/src/index.ts`

- [ ] **Step 1: Add the type re-export**

Open `packages/machine/src/index.ts`. Find the existing `export type { ... } from '@turing-machine-js/machine';` block (currently lines 10-20). Add `MachineState` to it:

```ts
export type {
  Graph,
  GraphNode,
  GraphTransition,
  GraphCommand,
  GraphSummary,
  Runnable,
  EquivalenceCase,
  EquivalenceResult,
  EquivalenceReport,
  MachineState,
} from '@turing-machine-js/machine';
```

Keep the value-export block (`Tape`, `State`, `toMermaid`, …) above it untouched.

- [ ] **Step 2: Verify v4.spec.ts already imports through the re-export**

The test file from Task 4 already uses `import { ..., type MachineState } from '../src/index';`. Confirm:

```sh
grep -n 'MachineState' packages/machine/test/v4.spec.ts
```

Expected: one hit, importing from `'../src/index'` — proves the re-export works in practice.

- [ ] **Step 3: Build and test**

```sh
npm run build && npm test
```

Expected: clean build, all tests pass.

- [ ] **Step 4: Commit**

```sh
git add packages/machine/src/index.ts
git commit -m "feat: re-export MachineState type for run() callback typing"
```

---

## Task 7: Update README examples to async IIFEs

**Files:**
- Modify: `README.md` (3 sites: lines 54, 104, 117)
- Modify: `packages/machine/README.md` (3 sites: lines 35, 79, 129)

The current examples are top-level scripts that call `machine.run();` synchronously. Wrap each runnable example in an async IIFE so `await machine.run();` is syntactically legal. Keep the `console.log(...) // ***` comments — they're documentation about expected output that examples.spec.ts asserts against verbatim.

- [ ] **Step 1: Pick the IIFE pattern**

The convention to apply across all six sites:

```javascript
import { PostMachine, /* … */ } from '@post-machine-js/machine';

const machine = new PostMachine({ /* … */ });

machine.replaceTapeWith(new Tape({ /* … */ }));

await machine.run();

console.log(machine.tape.symbols.join('').trim()); // ***
```

This is *top-level await*, valid in ES modules. The README already shows ESM-style imports, so this is consistent. Do NOT introduce `(async () => { ... })()` wrappers — they uglify the example.

- [ ] **Step 2: Migrate the root `README.md`**

For lines 54, 104, 117: change `machine.run();` (or `extend.run();` style) to `await machine.run();`. Add nothing else — no `async` IIFE, no extra imports.

- [ ] **Step 3: Migrate `packages/machine/README.md`**

Same pattern for lines 35, 79, 129. The line 129 case is inside the Subroutines section's `extend` example — `extend.run();` becomes `await extend.run();`.

- [ ] **Step 4: Update the corresponding examples.spec.ts assertions if needed**

The mechanical `await` change in the README does not change *what is logged*, so `expect(...).toBe(...)` assertions stay byte-identical to Task 5's migrated state. Confirm:

```sh
npm test
```

Expected: all tests still pass, including the README-driven ones.

- [ ] **Step 5: Commit**

```sh
git add README.md packages/machine/README.md
git commit -m "docs: README examples await the now-async machine.run()"
```

---

## Task 8: Update `CLAUDE.md` v3 section to v4

**Files:**
- Modify: `CLAUDE.md`

The "Relationship to `@turing-machine-js/machine` v3.0.x" section in the project root `CLAUDE.md` documents the v3 peer-dep relationship. With this PR, the package targets v4 — that section needs to be rewritten to match.

- [ ] **Step 1: Read the existing section**

```sh
grep -n "Relationship to" CLAUDE.md
```

Then read the full section (typically ~30 lines). Capture: which sub-points are still true under v4, which need rewording, and which (if any) become irrelevant.

- [ ] **Step 2: Rewrite the section**

Replace it with a v4 equivalent. Key facts to capture:

- Peer is `^4.0.0`. v3 is no longer supported.
- v4 made `TuringMachine.run()` async; `PostMachine.run()` is therefore async too. The override forwards an experimental `__onDebugBreak` callback (the `__` prefix marks it unstable; per-instruction breakpoint API tracked in **issue #N** — substitute the issue number from Task 1 Step 3).
- v4 additive features (`state.debug` runtime-mutable breakpoints, `haltState.debug` halt-pause) are reachable via the peer-dep contract through `pm.initialState`. PostMachine doesn't wrap them.
- `MachineState` is re-exported here so callbacks can be typed without depending on the upstream package directly.
- `runStepByStep` is unchanged — still a sync `Generator<MachineState>` in v4.
- The Jest `moduleNameMapper` paragraph (`points at dist/index.cjs, not dist/index.js`) is still accurate under v4 — keep it as-is, just under the new section heading.
- The "future v3 turing release will trim `dist/**/*.js`" note can stay or be reworded ("v4 already ships only the bundled `dist/index.cjs` / `index.mjs` / `index.d.ts`" — confirm by listing v4's `dist/` before writing this).

- [ ] **Step 3: Verify by inspection**

Re-read the updated section. Make sure it stands alone — a future engineer reading only this section should understand the peer-dep contract, what v4 changed, and where to look for the breakpoint API when it lands.

- [ ] **Step 4: Commit**

```sh
git add CLAUDE.md
git commit -m "docs(claude): document v4 peer-dep relationship"
```

---

## Task 9: Bump `@post-machine-js/machine` to 4.0.0

**Files:**
- Modify: `packages/machine/package.json`

- [ ] **Step 1: Bump the version field**

In `packages/machine/package.json`, change:

```json
"version": "3.1.0",
```

to:

```json
"version": "4.0.0",
```

Do NOT touch the root `package.json` version — root is private and stays at the placeholder `0.0.1-alpha.0`.

- [ ] **Step 2: Run the full pre-publish gate**

```sh
npm run lint && npm run build && npm test
```

Expected: all three pass, clean.

- [ ] **Step 3: Commit**

```sh
git add packages/machine/package.json
git commit -m "$(cat <<'EOF'
chore(release): @post-machine-js/machine 4.0.0

Major release. BREAKING CHANGES:
- @turing-machine-js/machine peer dep widened to ^4.0.0; v3 dropped.
- PostMachine.run() is now async (returns Promise<void>) — match v4.

Adds:
- Experimental __onDebugBreak callback on PostMachine.run().
- MachineState type re-export for callback typing.
EOF
)"
```

---

## Task 10: Push the branch and open the PR

**Files:** none (GitHub state).

- [ ] **Step 1: Push the branch**

```sh
git push -u origin v4-0-0
```

- [ ] **Step 2: Open the PR**

```sh
gh pr create --base master --head v4-0-0 \
  --title "v4.0.0: widen @turing-machine-js/machine peer dep to v4 (#58)" \
  --body "$(cat <<'EOF'
## Summary

- Bumps `@post-machine-js/machine` to **4.0.0**.
- Widens the `@turing-machine-js/machine` peer dep to `^4.0.0` (drops v3).
- `PostMachine.run()` is now `async` and returns `Promise<void>` — matches v4's async `TuringMachine.run()`.
- Adds an experimental `__onDebugBreak` callback parameter to `PostMachine.run()`. The `__` prefix marks it unstable pending the per-instruction breakpoint API design (tracked in #N — substitute the follow-up issue number from Task 1).
- Re-exports `MachineState` (type) so consumers can annotate `onStep` / `__onDebugBreak` callbacks without depending on the upstream package directly.

Closes #58.

## Breaking changes

- `pm.run()` now returns `Promise<void>` instead of `void`. Callers must `await` it (or chain `.then`).
- The peer-dep range no longer admits `@turing-machine-js/machine` v3. Consumers must upgrade in lockstep.

## Test plan

- [ ] CI green (lint, build, full Jest suite including new `v4.spec.ts`).
- [ ] Local sanity-check: `import { PostMachine } from '@post-machine-js/machine'; const m = new PostMachine({1: stop}); await m.run();` returns a resolved promise; tape mutates as expected.
- [ ] `MachineState` import path: `import type { MachineState } from '@post-machine-js/machine';` resolves without adding `@turing-machine-js/machine` as a direct dep.
- [ ] `__onDebugBreak` fires when `state.debug` is set on a state reachable from `pm.initialState`.
EOF
)"
```

Expected: PR URL in the output. Capture it for the user.

---

## Self-review

**Spec coverage:** every Files-changed entry in the spec maps to a task — manifests (Task 2), `PostMachine.run` (Task 3), `index.ts` re-export (Task 6), test migration (Task 5), `v4.spec.ts` (Task 4), READMEs (Task 7), CLAUDE.md (Task 8), version bump (Task 9). Verification checklist items map to Task 9 Step 2 (`lint && build && test`) and Task 4 (the new `v4.spec.ts` cases). Out-of-scope follow-up issue is created in Task 1 Step 3.

**Placeholder scan:** the only deferred reference is "issue #N" in Tasks 8 and 10 — that is the number returned by Task 1 Step 3 and the executor substitutes it. No "TBD" or "TODO" survives.

**Type/name consistency:** `__onDebugBreak` is used uniformly as the public override parameter name. The forwarded upstream parameter is `onDebugBreak` (no underscore) per turing v4. `MachineState` is the imported type in both PostMachine.ts and v4.spec.ts. `runStepByStep` is explicitly called out as untouched in Task 3 and confirmed unchanged in Task 8's CLAUDE.md rewrite.

**Ordering:** branch → install (build red) → fix override (build green, tests red) → add new tests (green for new behavior) → migrate old tests (green across the board) → re-export → docs → version bump → push/PR. Each task ends with a clean commit so the history is bisectable.
