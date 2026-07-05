# abort command Implementation Plan (#112)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Executed against the LOCAL engine branch `feat/239-abort-state` via `npm link @turing-machine-js/machine` (engine 7.1.0 features are unpublished).

**Goal:** `abort` command — machine-wide abnormal termination adopting the engine's `abortState` — plus the run/session surface (`RunResult` passthrough, `PostDebugSession` `'abort'` event) and docs.

**Decisions (settled on #112):** abort is legal in groups (no continuation → no ambiguity); `abort(anything)` throws (mirror of `stop`'s guard); breakpoints/lockdown mirror haltState (direct `abortState.debug = boolean` passes through; `pm.setBreakpoint(abortState, …)` works).

## Global Constraints

- Branch `feat/112-abort-command` off updated master; PR targets master (branch-protected, PR flow, 2 required checks).
- Coverage floor **100/100/100/100** (`npm run test:coverage`).
- **CI will be RED on the PR until `@turing-machine-js/machine` 7.1.0 publishes** — CI installs engine 7.0.0 from the registry, which lacks `abortState`. All gates must pass LOCALLY against the linked engine; the PR body declares the block. Dep ranges stay `^7.0.0` for now; widening to `^7.1.0` (peer + dev) is a follow-up commit on this branch once the engine publishes, which is also what turns CI green.
- Engine-side friction found during implementation is REPORTED (engine PR #241 is intentionally unmerged so the design can still change) — do not work around silently.
- No Claude/AI attribution anywhere.

## Task A: `abort` command + run/session surface

**Files:** `packages/machine/src/commands.ts` (mirror `stop` at ~lines 237-242 producer / ~337-356 factory+registration; grep every `=== stop` / `wrappedFn === stop` site and extend the union with `abort` where semantically "terminal command"), `packages/machine/src/index.ts` (export `abort`), `packages/machine/src/classes/PostMachine.ts` (`run()` ~line 113: return `super.run(...)` — type `RunResult` re-exported from the engine; JSDoc: returns the call-scoped outcome), `packages/machine/src/classes/PostDebugSession.ts` (event union ~line 14 gains `'abort'`; listener map + constructor wiring ~line 141: `#engineSession.on('abort', (result) => …)` fires post 'abort' listeners with the engine `RunResult`; halt listeners keep firing only on halt), tests colocated (`commands.spec.ts`, `PostMachine.spec.ts`, `PostMachine.debugger.spec.ts`).

**Design (settled on #112, supersedes earlier function shapes): `stop` and `abort` are NON-CALLABLE tokens.**

```ts
export const stop: unique symbol = Symbol('stop');
export const abort: unique symbol = Symbol('abort');
```

- Rule: commands with no parameterized form are tokens; parameterized commands (`mark`, `erase`, `left`, `right`, `noop`, `call`, `check`) remain functions.
- Internal producers stay as functions: `stopCommandStateProducer` keeps its calledFromGroup throw (stop stays illegal in groups); `abortCommandStateProducer` returns `abortState` and is group-legal (decision 1).
- Dispatch: every site that recognized bare `stop` (the `isBareConstructor` union ~line 415, commandsSet membership checks, all `=== stop` hits) switches to token recognition — a `tokenProducers: Map<symbol, producer>` maps tokens directly to producers. Instruction-value typing widens to accept the two symbols. The `defaultNextInstructionIndex` handshake for stop is deleted.
- Legal-form compatibility is the invariant: every existing bare-`stop` test passes UNCHANGED (any needed edit to a bare-form test is a red flag). Call-form tests update: calling a symbol throws native `TypeError`.
- Test matrix additions: bare `abort` at an instruction slot works; `typeof stop === 'symbol'`; `$tag(stop)` / `$tag(abort)` accept tokens.

**Test matrix (TDD, all against the linked engine):**
- top-level `abort` → `pm.run()` returns `{outcome: 'aborted'}`; tape untouched beyond prior steps.
- `abort` inside a **subroutine** → whole machine aborts; `result.stack` non-empty (the punched-through frames); contrast case: `stop`-analog (subroutine `stop` is illegal — use natural subroutine return) still ends `'halted'`.
- `abort` inside a **group** → works (decision 1); `stop` in a group still throws (existing behavior untouched).
- `abort(1)` / `abort(Symbol())` → throws "inappropriate 'abort' command usage".
- state naming: the abort instruction's state carries the instruction-derived name (e.g. `"20"`), and `result.state.name` surfaces it.
- `pm.run()` returns RunResult; `run()` on a halting program → `{outcome: 'halted', stack: []}`.
- debugRun: `'abort'` event fires with the RunResult payload, `'halt'` listeners stay silent on aborting runs (and vice versa); `abortState.debug = true` pauses (side 'after', cause 'breakpoint') before the abort event, through the post session's pause wrapping (arrivalPath present on the pause).
- breakpoints/lockdown: direct `abortState.debug = boolean` passes through (no throw); `pm.setBreakpoint(abortState, …)` + `listBreakpoints` round-trip; lockdown untouched for post-created states.

## Task B: docs + gates + PR

**Files:** `packages/machine/README.md` (Author's extensions table row for `abort` — direct form only, no indexed form; prose: `stop` = classical halt, *inside a subroutine it means return*; `abort` = extension ending the whole run from any depth, allowed in groups and why; `run()` return value section; `PostDebugSession` abort event; breakpoints note), repo `CLAUDE.md` (instruction → state-producer note for `abort`, run/debug surface), CHANGELOG deferred to the release PR per repo convention.

Gates: `npm run lint`, `npm run typecheck` (script or tsc --build), `npm test`, `npm run test:coverage` = 100/100/100/100 — all locally against the link. Then push + `gh pr create` with the CI-red-until-engine-publishes note. No attribution footer.
