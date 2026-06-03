# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — TypeScript project-references build (`tsc --build tsconfig.build.json`) followed by `scripts/build-node-entries.mjs`, which uses Rollup to repackage `dist/index.js` into `index.mjs` (ESM) and `index.cjs` (CJS). The Rollup step marks `@turing-machine-js/machine` as `external`, so the upstream Turing-machine engine stays as a runtime dependency.
- `npm test` — Vitest one-shot run (`vitest run`). Single root `vitest.config.ts`; tests are co-located with source at `packages/*/src/**/*.spec.ts` (per-file unit + integration tests next to the module under test, matching the upstream engine's convention) plus `test/**/*.spec.ts` (root cross-package tests like README examples). Vitest uses esbuild for TypeScript — no babel toolchain.
- `npm run test:watch` — Vitest in watch mode (`vitest`).
- `npm run test:coverage` — `vitest run --coverage` using `@vitest/coverage-v8`. CI runs this and uploads `coverage/lcov.info` to Coveralls. Hard floors enforced in `vitest.config.ts`: **100 / 100 / 100 / 100** (statements / branches / functions / lines) — pinned to current actuals as of v6.4.0. Any new code paths must be exercised by tests; if a real regression makes 100 untenable, relax intentionally rather than letting drift slip through silently.
- `npm run lint` — ESLint (flat config, `typescript-eslint` recommended). `dist/` is ignored.
- Run a single test: `npx vitest run packages/machine/src/classes/PostMachine.spec.ts -t "name"`.

`npm` ≥ 7 is required (workspaces). Node 24 is what CI uses.

## Architecture

This is an npm-workspaces + Lerna monorepo with **one published package** so far:

- **`@post-machine-js/machine`** — a Post machine (a Turing-machine variant with a 2-symbol alphabet `{blank, mark}` and an instruction-numbered program model) implemented on top of `@turing-machine-js/machine`. The Turing engine is a **peer dependency** (see [Relationship to `@turing-machine-js/machine` v7.0.0-alpha.x](#relationship-to-turing-machine-jsmachine-v700-alphax) below for the full version-relationship writeup). PostMachine pulls `State`, `TapeBlock`, `TuringMachine`, `Tape`, and several runtime singletons (`haltState`, `ifOtherSymbol`, the `movements` constants) from the engine.

### How `PostMachine` maps to the Turing engine

A Post machine program is a numbered instruction list:

```ts
new PostMachine({
  10: erase,
  20: right,
  30: check(20, 40),
  40: mark,
  ...
});
```

`PostMachine extends TuringMachine`. Each instruction (`erase`, `right`, `check`, `mark`, etc.) is a *state-producer function* — a function that, given a `CommandContext` (instruction index, references map, states cache, tapeBlock, …), returns a `State` instance from the Turing engine. The PostMachine constructor walks the instruction list, calls each producer, builds the state graph using `Reference`s for forward instruction targets, and then runs the assembled `TuringMachine` graph.

Key files:

- `packages/machine/src/consts.ts` — the 2-symbol alphabet (`' '` blank, `'*'` mark) and the module-level `originalTapeBlock`. Module-level state means the alphabet/tapeBlock pair is shared across all PostMachine instances unless cloned.
- `packages/machine/src/commands.ts` — the eight built-in commands (`call`, `check`, `erase`, `left`, `mark`, `noop`, `right`, `stop`). Each is a higher-order function: invoking `mark(20)` returns a *bound state-producer* which the PostMachine constructor invokes to materialize a `State`. Producers cache states in a `states` map keyed by a `:hash:` so the same logical transition isn't built twice.
- `packages/machine/src/classes/PostMachine.ts` — the runtime; orchestrates the producers, manages references and subroutine support (`subroutineInitialStates`, `subroutineNameValidator`), owns the breakpoint registry (`#breakpoints`, `setBreakpoint`/`clearBreakpoint`/`clearBreakpoints`/`listBreakpoints`), and installs the per-State debug-config lockdown at the end of construction.
- `packages/machine/src/path.ts` — `Path` type, `parsePath`/`formatPath`/`comparePathsCanonically`, the path-string validator. The canonical path string is the lookup key in `PostMachine.#pathToState` and the registry's path comparisons.
- `packages/machine/src/breakpoints.ts` — `BreakpointFilter` / `BreakpointTarget` / `Breakpoint` types, `mergeBreakpointFilters` (filter union for shared States), `validateBreakpointFilter`.
- `packages/machine/src/lockdown.ts` — `installStateLockdown(state, onUserWrite)` + `withLockdownEscape(fn)`. Installs `Object.defineProperty` accessors on per-PostMachine States that delegate to the engine's prototype `debug` getter/setter inside the escape (used by PostMachine's `#refreshStateDebug`) and route user writes to a redirect handler. The prior `installHaltLockdown(haltState)` + module-load install in `src/index.ts` were dropped alongside engine [#207](https://github.com/mellonis/turing-machine-js/issues/207): `haltState.debug` collapsed to a boolean, the per-side `DebugConfig` shape the lockdown was funneling no longer exists, and the "per-PostMachine routing" benefit was syntactic only (haltState is a process-global singleton). Direct `haltState.debug = boolean` writes now go straight to the engine setter; `pm.setBreakpoint(haltState, …)` still works for registry-aware halt pauses.
- `packages/machine/src/validators.ts` — input validators for instruction indices and subroutine names.

### Subtleties worth knowing

1. **Module-level singletons**: `originalTapeBlock` and `alphabet` in `consts.ts` are global; `PostMachine` clones the tape block per instance to avoid cross-instance contamination. The custom-alphabet path (constructor `options.blankSymbol` / `options.markSymbol`) skips the clone and builds a fresh `TapeBlock.fromAlphabets([new Alphabet([blank, mark])])` instead — the per-instance `#blankSymbol`/`#markSymbol` fields are then threaded into `CommandContext` so `mark`/`erase`/`check` read the chosen glyphs at build time. If you add new built-in commands that need their own per-instance tape state, follow the same clone-per-instance pattern; if they need to reference the alphabet symbols, read them from the context, not from the module-level constants.

2. **Command identity check via `WeakSet`**: `commandsSet` registers every legitimate command-producing function. PostMachine validates user-supplied instructions by checking membership in this set — it's how the runtime distinguishes "user passed a command-producer" from "user passed a random function." Adding new commands requires registering them.

3. **`defaultNextInstructionIndex` sentinel**: a unique `Symbol(...)` used by command producers to mean "no explicit next-instruction was passed; use the runtime-computed default" (i.e. fall through to the next numbered instruction). Don't replace with `null`/`undefined` — they're distinguishable from "user passed null."

4. **Forward references**: PostMachine uses `Reference` (from the upstream library) so an instruction at index 10 can target index 20 even if 20's state isn't built yet. References are bound after the full instruction list is processed.

5. **Group commands**: some producers throw if called from inside a "group" (`calledFromGroup` flag in `CommandContext`). This relates to PostMachine's grouping feature where multiple commands can be bundled into one logical instruction. Two distinct rules: `check`/`call`/`stop` reject group context unconditionally (regardless of form); the unary commands (`mark`/`erase`/`left`/`right`/`noop`) only reject the *indexed* form (`mark(20)` etc.) inside a group, because the explicit jump conflicts with the group's sequential fall-through semantics.

6. **Per-State debug lockdown**: at the end of construction, `PostMachine` iterates `#stateToCandidatePaths.keys()` and calls `installStateLockdown(state, onUserWrite)` on every non-halt State. The installer replaces the engine's prototype `debug` accessor with an instance-level `Object.defineProperty`. Internal writes (from `#refreshStateDebug`) run inside `withLockdownEscape` and delegate to the engine's prototype setter (which preserves the engine's `DebugConfig` wrapping + validation + shared-debugRef propagation across `withOverriddenHaltState` wrappers). User writes outside the escape go through the redirect handler: un-shared State → `setBreakpoint`/`clearBreakpoint`; shared State → throw with candidate-path list. **haltState is NO LONGER locked** (dropped alongside engine [#207](https://github.com/mellonis/turing-machine-js/issues/207)) — direct `haltState.debug = boolean` writes from any context go straight to the engine setter. `#refreshHaltDebug` writes the boolean directly (no escape needed). `state.isHalt` checks at the install site still skip haltState (it's a singleton, not a per-PostMachine State). The lockdown does **not** use `Proxy` — that was tried during the v6.1.0 design phase and abandoned because engine utilities like `State.toGraph(arg, …)` read TS-downleveled private fields directly off the argument via `__classPrivateFieldGet`, which fails on a Proxy.

## Doc examples must be tested

Every executable code example in any `README.md` of this repo has a matching test in an `examples.spec.ts` co-located with that README:

- Root `README.md` → `test/examples.spec.ts`
- `packages/<name>/README.md` → `packages/<name>/src/classes/<ClassName>.examples.spec.ts` (or another co-located location near the README's primary subject)

(One `examples.spec.ts` per README. The repo will have N of them where N is the README count.)

The test mirrors the example verbatim — same imports, same construction, same `replaceTapeWith` + `run()` + values — with the example's `// console.log(...)` output lines kept as comments and replaced with `expect(...).toBe(...)` assertions. Group by source file with `describe('README.md', ...)` / `describe('packages/machine/README.md', ...)`, then by section name with nested `describe`s.

When adding or editing a README example, update the matching test in the same change. Tests fail loud when the README drifts from the actual behavior; without them, prose examples silently rot. *Structural* snippets that don't call `run()` (i.e. shape-illustrating only) are exempt — but prefer to make examples executable when reasonable, so they can be tested.

Non-README tests (sentinel-identity checks, internal plumbing) live in separately-named spec files (e.g. `v3.spec.ts`, `machine.spec.ts`), keeping the `examples.spec.ts` files purely doc-driven.

## Relationship to `@turing-machine-js/machine` v7.0.0-alpha.x

`@turing-machine-js/machine` is declared as a **peer dependency** (and a devDependency for the in-repo build). Importantly, it must be a peer because the upstream library exposes two kinds of identity-sensitive surface that duplicate copies would break:

- **Sentinel singletons** keyed by `Symbol(...)` — `haltState`, `ifOtherSymbol`, the members of `movements`, the members of `symbolCommands`. Equality checks (`=== haltState`, etc.) require the same physical object.
- **Classes** — `Reference`, `State`, `TapeBlock`, `TuringMachine`, `Tape`, `Alphabet`. `instanceof` checks require shared constructor identity.

The latest peer range is `^7.0.0-alpha.8` (set in `@post-machine-js/machine@7.0.0-alpha.7`). **v4 / v5 / v6 are no longer supported on the v7 line** — a consumer still on those engine majors cannot install this package and must upgrade in lockstep. (post-machine-js skipped its own v5 and skipped its own v7-alpha.1; v7-alpha.2 is the first post prerelease that crosses to engine v7.)

Engine v7 alpha changes adopted in post v7 alphas (chronological):

**post alpha.2 (engine alpha.2):**
- **`withOverrodeHaltState` → `withOverriddenHaltState`** (engine [#149](https://github.com/mellonis/turing-machine-js/issues/149)). Consumer-side rename in `src/commands.ts`, `src/classes/PostMachine.ts`, and tests.
- **Wrapper composite shape `A>B` → `A(B)`** (engine [#148](https://github.com/mellonis/turing-machine-js/issues/148)). `parsePath` now rejects `(`/`)` in user-provided state names. The Post `Path` separators (`::`, `.`, `~`) survive unchanged.
- **`toMermaid` callable-subtree emit** (engine [#174](https://github.com/mellonis/turing-machine-js/issues/174)). The wrapper composite is now a `[[bare(continuation)]]` call site OUTSIDE the subgraph; the bare hopper + body live INSIDE `subgraph w_N["callable subtree of NAME"]`. Bold `==> "call"` arrow from wrapper to bare; dotted `-. "return" .->` from subgraph back to wrapper; retired `-. onHalt .->` (wrapper-to-override is now solid `-->`). Body's halt-bound transitions retarget to the frame's halt marker `cN`, not the real `s0`. Consequence: `summarizePostMachine().stateCount` is +1 per call site vs v6.x.

**post alpha.3 (engine alpha.3, no functional engine adopt — internal):**
- Hopper drop ([#85](https://github.com/mellonis/post-machine-js/issues/85)) — acyclic subroutines with plain leading instructions no longer get a hopper State; Tarjan SCC on local call graph identifies cyclic subs (hopper retained). Common case wraps `foo::1` directly, saving one State per call site. Composite wrapper name shifts `foo(continuation)` → `foo::1(continuation)`.

**post alpha.4 (engine alpha.3 still; #186 state-tags adopted):**
- **Path-based `pm.tag(...)` registry + inline `$tag(...)` decorator + auto-tag policy** ([#86](https://github.com/mellonis/post-machine-js/issues/86)) on top of engine [#186](https://github.com/mellonis/turing-machine-js/issues/186)'s state-tags surface. Note: post alpha.4 (state tags) shipped 2026-05-21 while engine alpha.4 (collectStates + bug fixes) shipped 2026-05-23 — same alpha-number, **NOT** lockstep. Post and engine alpha cycles are independent even when the numbers happen to coincide.

**post alpha.5 (engine alpha.5; #207 haltState.debug → boolean):**
- **Dropped the module-load `haltState` lockdown** ([#94](https://github.com/mellonis/post-machine-js/pull/94)) now that engine [#207](https://github.com/mellonis/turing-machine-js/issues/207) collapsed `haltState.debug` to a boolean. The per-side `DebugConfig` the lockdown funneled no longer exists; direct `haltState.debug = boolean` goes straight to the engine setter. `pm.setBreakpoint(haltState, …)` still works for registry-aware halt pauses.

**post alpha.6 (engine alpha.6; #102 DebugSession reshape + #213 CallFrame):**
- **Adopted the engine's debug-surface reshape**: `pm.run()` is now sync + callback-free; a new `pm.debugRun()` returns a `PostDebugSession` (wraps the engine `DebugSession`, re-adds `arrivalPath`/`candidatePaths`, applies the breakpoint registry as a pause filter, reads the one-sided `m.pause: {side, cause}` that replaced the per-yield `m.debugBreak`).
- `#wrapMachineState` switched from spread to in-place mutation so the engine's `MACHINE_STATE_INTERNAL` accessor survives the wrap (detection needs it).
- Engine [#213](https://github.com/mellonis/turing-machine-js/issues/213) (`CallFrame extends State`) is API-compatible — `instanceof State` preserved — and required no post-side change.

**post alpha.7 (post-only; #101 stepInstruction):**
- **Added `PostDebugSession.stepInstruction()`** ([#101](https://github.com/mellonis/post-machine-js/issues/101)) — the Post-level program-counter step. Advances to the next numbered Post instruction in the *current* scope; sub-step transitions inside groups (`50.1 → 50.2`) and descents into called scopes (`call('foo') → foo::1`) stay silent because those aren't numbered instructions in the current scope. Two rules: (1) advance until click-time `(scope, instructionIndex)` pair changes; (2) if no next numbered exists in current scope (hit `stop` or fall through end), the natural engine continuation fires — caller's continuation if inside a call/group, halt at top level. Position-independent: same behavior at atomic instructions, call entries, group entries, mid-group, or inside callees. Implementation: drives engine via repeated `stepIn`, filters step-cause pauses by `(scope, instructionIndex)` comparison against the click-time anchor (`#stillInClickTimeInstruction` in `PostDebugSession.ts`). The filter classifies by scope-length relative to click — deeper (longer) keeps stepping, shallower (shorter) surfaces, equal length checks scope-content + index — using Post's call-stack discipline (returns always go through ancestor scopes) to handle nested calls correctly. Breakpoints / external `pause()` mid-advance interrupt normally. Peer dep `^7.0.0-alpha.6 → ^7.0.0-alpha.8` widening (semver-prerelease caret already accepted alpha.7+; explicit widening jumps to the latest engine alpha at ship time per workspace convention).

Previous v5/v6 engine changes still apply unchanged on v7:

- **`pm.run()` stays async.** Engine v4 introduced `Promise<void>` return; v5/v6 didn't change that. Callers must still `await` it.
- **`runStepByStep` stays unchanged.** Still a synchronous `Generator<MachineState>` (engine v6 narrowed the parent's generator return type back to `Generator<MachineState>`, matching post's existing override).
- **`onPause` on `pm.run()`** (stable as of v6.1.0; was experimental `__onPause` in v6.0.0). Accepts `onPause?: (s: MachineState) => void | Promise<void>` and forwards as the upstream `onPause` hook. The wrapper applies arrival-aware registry filtering: pauses fire only when `m.arrivalPath` (or a halt-arrival) matches a registered breakpoint.
- **Debugger primitives ARE wrapped for non-halt States.** `state.debug` on per-PostMachine States goes through the per-State lockdown (see Subtlety 6 above). Construction-time writes funnel through `pm.setBreakpoint(target, filter)` / `pm.clearBreakpoint(target)` / `pm.clearBreakpoints()`; direct `state.debug = X` on an un-shared State auto-redirects to `setBreakpoint`. The engine-level concepts (filter shapes, `before → step → after` lifecycle) still apply — the lockdown is a thin layer in front, not a reimplementation. **`haltState.debug` is no longer wrapped** (engine [#207](https://github.com/mellonis/turing-machine-js/issues/207) collapsed it to a boolean and post-machine-js dropped the module-load halt-lockdown). Direct `haltState.debug = boolean` writes work; `pm.setBreakpoint(haltState, …)` still works for registry-aware halt pauses. Halt-imminent pause fires on the AFTER side of the iter whose transition leads to halt (per #207).
- **`run({ debug: boolean })` master switch (engine v5/#106).** Reachable via the upstream API; not wrapped at the PostMachine level. Useful in tests to suppress all `onPause` dispatches without unsetting `state.debug` assignments.
- **v3 utility additions persist.** `State.toGraph`, `State.fromGraph`, `State.inspect`, `toMermaid`/`fromMermaid`, `summarize`/`summarizeGraph`, `equivalentOn`, and the `MachineState` type are all still re-exported from `@post-machine-js/machine`. v5/v6 added/refined debugger primitives without removing any v3 utilities.
- **Post-aware wrappers persist unchanged.** `summarizePostMachine(machine)` and `equivalentPostMachines(reference, candidate, cases, options?)` remain the recommended path for typical usage. The bare upstream functions stay re-exported for advanced cases (e.g., comparing a PostMachine against a hand-rolled TuringMachine via `equivalentOn`).
- **`machine.initialState` getter persists.** It is still the entry point for the upstream graph utilities to act on a PostMachine instance — pass it to `summarize`, `toMermaid`, `equivalentOn`, or directly to the v4 debugger primitives.

### Imports: bare specifiers everywhere

Source and specs always import the bare package names — `from '@post-machine-js/machine'` and `from '@turing-machine-js/machine'`. Two distinct resolution stories sit behind those specifiers:

- **`@post-machine-js/machine`** (our own package). Vitest's `resolve.alias` in the single root `vitest.config.ts` intercepts the bare specifier and routes it to TypeScript source (`packages/machine/src`), so a change in source is picked up by tests with no rebuild step. After publishing, Node resolves the same specifier to `dist/index.{mjs,cjs}` via the package's `exports` field.
- **`@turing-machine-js/machine`** (the peer dep). No alias — vitest resolves the package's `exports` field correctly out of the installed `node_modules` copy. The upstream package ships only its bundled `dist/{index.mjs,index.cjs}`, so no `@turing-machine-js/machine/src/...` deep-import is possible (an old in-monorepo dev shim that pointed at the upstream's source has been retired). The previous Jest setup hand-mapped this specifier to `dist/index.cjs` because Jest's resolver was older; that hack was dropped during the v6 vitest migration.
