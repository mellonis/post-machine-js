# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — TypeScript project-references build (`tsc --build tsconfig.build.json`) followed by `scripts/build-node-entries.mjs`, which uses Rollup to repackage `dist/index.js` into `index.mjs` (ESM) and `index.cjs` (CJS). The Rollup step marks `@turing-machine-js/machine` as `external`, so the upstream Turing-machine engine stays as a runtime dependency.
- `npm test` — Vitest one-shot run (`vitest run`). Single root `vitest.config.ts`; tests are `test/**/*.spec.ts` (root README/example tests) plus `packages/*/test/**/*.spec.ts` (per-package). Vitest uses esbuild for TypeScript — no babel toolchain.
- `npm run test:watch` — Vitest in watch mode (`vitest`).
- `npm run test:coverage` — `vitest run --coverage` using `@vitest/coverage-v8`. CI runs this and uploads `coverage/lcov.info` to Coveralls. Hard floors enforced in `vitest.config.ts`: 95 / 90 / 95 / 95 (~5pt below current 100%).
- `npm run lint` — ESLint (flat config, `typescript-eslint` recommended). `dist/` is ignored.
- Run a single test: `npx vitest run packages/machine/test/machine.spec.ts -t "name"`.

`npm` ≥ 7 is required (workspaces). Node 24 is what CI uses.

## Architecture

This is an npm-workspaces + Lerna monorepo with **one published package** so far:

- **`@post-machine-js/machine`** — a Post machine (a Turing-machine variant with a 2-symbol alphabet `{blank, mark}` and an instruction-numbered program model) implemented on top of `@turing-machine-js/machine`. The Turing engine is a **peer dependency** (see [Relationship to `@turing-machine-js/machine` v6.0.x](#relationship-to-turing-machine-jsmachine-v60x) below for the full version-relationship writeup). PostMachine pulls `State`, `TapeBlock`, `TuringMachine`, `Tape`, and several runtime singletons (`haltState`, `ifOtherSymbol`, the `movements` constants) from the engine.

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
- `packages/machine/src/lockdown.ts` — `installStateLockdown(state, onUserWrite)` + `installHaltLockdown(haltState)` + `withLockdownEscape(fn)`. Installs `Object.defineProperty` accessors on State and haltState that delegate to the engine's prototype `debug` getter/setter inside the escape (used by PostMachine's `#refreshStateDebug` / `#refreshHaltDebug`) and route user writes to a redirect handler or throw (haltState).
- `packages/machine/src/validators.ts` — input validators for instruction indices and subroutine names.

### Subtleties worth knowing

1. **Module-level singletons**: `originalTapeBlock` and `alphabet` in `consts.ts` are global; `PostMachine` clones the tape block per instance to avoid cross-instance contamination. The custom-alphabet path (constructor `options.blankSymbol` / `options.markSymbol`) skips the clone and builds a fresh `TapeBlock.fromAlphabets([new Alphabet([blank, mark])])` instead — the per-instance `#blankSymbol`/`#markSymbol` fields are then threaded into `CommandContext` so `mark`/`erase`/`check` read the chosen glyphs at build time. If you add new built-in commands that need their own per-instance tape state, follow the same clone-per-instance pattern; if they need to reference the alphabet symbols, read them from the context, not from the module-level constants.

2. **Command identity check via `WeakSet`**: `commandsSet` registers every legitimate command-producing function. PostMachine validates user-supplied instructions by checking membership in this set — it's how the runtime distinguishes "user passed a command-producer" from "user passed a random function." Adding new commands requires registering them.

3. **`defaultNextInstructionIndex` sentinel**: a unique `Symbol(...)` used by command producers to mean "no explicit next-instruction was passed; use the runtime-computed default" (i.e. fall through to the next numbered instruction). Don't replace with `null`/`undefined` — they're distinguishable from "user passed null."

4. **Forward references**: PostMachine uses `Reference` (from the upstream library) so an instruction at index 10 can target index 20 even if 20's state isn't built yet. References are bound after the full instruction list is processed.

5. **Group commands**: some producers throw if called from inside a "group" (`calledFromGroup` flag in `CommandContext`). This relates to PostMachine's grouping feature where multiple commands can be bundled into one logical instruction. Two distinct rules: `check`/`call`/`stop` reject group context unconditionally (regardless of form); the unary commands (`mark`/`erase`/`left`/`right`/`noop`) only reject the *indexed* form (`mark(20)` etc.) inside a group, because the explicit jump conflicts with the group's sequential fall-through semantics.

6. **Per-State debug lockdown (v6.1.0+)**: at the end of construction, `PostMachine` iterates `#stateToCandidatePaths.keys()` and calls `installStateLockdown(state, onUserWrite)` on every non-halt State. The installer replaces the engine's prototype `debug` accessor with an instance-level `Object.defineProperty`. Internal writes (from `#refreshStateDebug` / `#refreshHaltDebug`) run inside `withLockdownEscape` and delegate to the engine's prototype setter (which preserves the engine's `DebugConfig` wrapping + validation + shared-debugRef propagation across `withOverrodeHaltState` wrappers). User writes outside the escape go through the redirect handler: un-shared State → `setBreakpoint`/`clearBreakpoint`; shared State → throw with candidate-path list. `haltState` is locked module-globally in `src/index.ts` at module load — direct `haltState.debug = X` throws, no PostMachine context for a redirect. `state.isHalt` checks at the install site skip the engine's halt singleton (it has its own module-global lockdown). The lockdown does **not** use `Proxy` — that was tried during the v6.1.0 design phase and abandoned because engine utilities like `State.toGraph(arg, …)` read TS-downleveled private fields directly off the argument via `__classPrivateFieldGet`, which fails on a Proxy.

## Doc examples must be tested

Every executable code example in any `README.md` of this repo has a matching test in an `examples.spec.ts` co-located with that README:

- Root `README.md` → `test/examples.spec.ts`
- `packages/<name>/README.md` → `packages/<name>/test/examples.spec.ts`

(One `examples.spec.ts` per README. The repo will have N of them where N is the README count.)

The test mirrors the example verbatim — same imports, same construction, same `replaceTapeWith` + `run()` + values — with the example's `// console.log(...)` output lines kept as comments and replaced with `expect(...).toBe(...)` assertions. Group by source file with `describe('README.md', ...)` / `describe('packages/machine/README.md', ...)`, then by section name with nested `describe`s.

When adding or editing a README example, update the matching test in the same change. Tests fail loud when the README drifts from the actual behavior; without them, prose examples silently rot. *Structural* snippets that don't call `run()` (i.e. shape-illustrating only) are exempt — but prefer to make examples executable when reasonable, so they can be tested.

Non-README tests (sentinel-identity checks, internal plumbing) live in separately-named spec files (e.g. `v3.spec.ts`, `machine.spec.ts`), keeping the `examples.spec.ts` files purely doc-driven.

## Relationship to `@turing-machine-js/machine` v6.0.x

`@turing-machine-js/machine` is declared as a **peer dependency** (and a devDependency for the in-repo build). Importantly, it must be a peer because the upstream library exposes two kinds of identity-sensitive surface that duplicate copies would break:

- **Sentinel singletons** keyed by `Symbol(...)` — `haltState`, `ifOtherSymbol`, the members of `movements`, the members of `symbolCommands`. Equality checks (`=== haltState`, etc.) require the same physical object.
- **Classes** — `Reference`, `State`, `TapeBlock`, `TuringMachine`, `Tape`, `Alphabet`. `instanceof` checks require shared constructor identity.

The current peer range is `^6.0.0`. **v4 and v5 are no longer supported** — a consumer still on those engine majors cannot install this package and must upgrade in lockstep. (post-machine-js skipped a v5 of its own — v6.0.0 is the first post release that crosses to engine v5/v6.)

The upstream v5/v6 changes that drove this release:

- **`pm.run()` stays async.** Engine v4 introduced `Promise<void>` return; v5/v6 didn't change that. Callers must still `await` it.
- **`runStepByStep` stays unchanged.** Still a synchronous `Generator<MachineState>` (engine v6 narrowed the parent's generator return type back to `Generator<MachineState>`, matching post's existing override).
- **`onPause` on `pm.run()`** (stable as of v6.1.0; was experimental `__onPause` in v6.0.0). Accepts `onPause?: (s: MachineState) => void | Promise<void>` and forwards as the upstream `onPause` hook. The wrapper applies arrival-aware registry filtering: pauses fire only when `m.arrivalPath` (or a halt-arrival) matches a registered breakpoint.
- **Debugger primitives ARE wrapped (v6.1.0+).** `state.debug` and `haltState.debug` go through the per-State / module-global lockdown (see Subtlety 6 above). Construction-time writes funnel through `pm.setBreakpoint(target, filter)` / `pm.clearBreakpoint(target)` / `pm.clearBreakpoints()`; direct `state.debug = X` on an un-shared State auto-redirects to `setBreakpoint`. The engine-level concepts (filter shapes, `before → step → after` lifecycle, `haltState.debug.after` rejection) still apply — the lockdown is a thin layer in front, not a reimplementation.
- **`run({ debug: boolean })` master switch (engine v5/#106).** Reachable via the upstream API; not wrapped at the PostMachine level. Useful in tests to suppress all `onPause` dispatches without unsetting `state.debug` assignments.
- **v3 utility additions persist.** `State.toGraph`, `State.fromGraph`, `State.inspect`, `toMermaid`/`fromMermaid`, `summarize`/`summarizeGraph`, `equivalentOn`, and the `MachineState` type are all still re-exported from `@post-machine-js/machine`. v5/v6 added/refined debugger primitives without removing any v3 utilities.
- **Post-aware wrappers persist unchanged.** `summarizePostMachine(machine)` and `equivalentPostMachines(reference, candidate, cases, options?)` remain the recommended path for typical usage. The bare upstream functions stay re-exported for advanced cases (e.g., comparing a PostMachine against a hand-rolled TuringMachine via `equivalentOn`).
- **`machine.initialState` getter persists.** It is still the entry point for the upstream graph utilities to act on a PostMachine instance — pass it to `summarize`, `toMermaid`, `equivalentOn`, or directly to the v4 debugger primitives.

### Imports: bare specifiers everywhere

Source and specs always import the bare package names — `from '@post-machine-js/machine'` and `from '@turing-machine-js/machine'`. Two distinct resolution stories sit behind those specifiers:

- **`@post-machine-js/machine`** (our own package). Vitest's `resolve.alias` in the single root `vitest.config.ts` intercepts the bare specifier and routes it to TypeScript source (`packages/machine/src`), so a change in source is picked up by tests with no rebuild step. After publishing, Node resolves the same specifier to `dist/index.{mjs,cjs}` via the package's `exports` field.
- **`@turing-machine-js/machine`** (the peer dep). No alias — vitest resolves the package's `exports` field correctly out of the installed `node_modules` copy. The upstream package ships only its bundled `dist/{index.mjs,index.cjs}`, so no `@turing-machine-js/machine/src/...` deep-import is possible (an old in-monorepo dev shim that pointed at the upstream's source has been retired). The previous Jest setup hand-mapped this specifier to `dist/index.cjs` because Jest's resolver was older; that hack was dropped during the v6 vitest migration.
