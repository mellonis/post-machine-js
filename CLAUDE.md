# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — TypeScript project-references build (`tsc --build tsconfig.build.json`) followed by `scripts/build-node-entries.mjs`, which uses Rollup to repackage `dist/index.js` into `index.mjs` (ESM) and `index.cjs` (CJS). The Rollup step marks `@turing-machine-js/machine` as `external`, so the upstream Turing-machine engine stays as a runtime dependency.
- `npm test` — Jest across the root project + each package (configured via `projects` in `jest.config.mjs`). Tests are `*.spec.ts` colocated with sources or in `test/` directories.
- `npm run test:coverage` — same, with coverage.
- `npm run lint` — ESLint (flat config, `typescript-eslint` recommended). `dist/` and per-package `babel.config.js` are ignored.
- Run a single test: `npx jest packages/machine/test/machine.spec.ts -t "name"`.

`npm` ≥ 7 is required (workspaces).

## Architecture

This is an npm-workspaces + Lerna monorepo with **one published package** so far:

- **`@post-machine-js/machine`** — a Post machine (a Turing-machine variant with a 2-symbol alphabet `{blank, mark}` and an instruction-numbered program model) implemented on top of `@turing-machine-js/machine`. It depends on the Turing engine for `State`, `TapeBlock`, `TuringMachine`, `Tape`, and the supporting helpers (`haltState`, `ifOtherSymbol`, `Reference`, `movements`).

### Relationship to `@turing-machine-js/machine`

`@turing-machine-js/machine` is declared as a **peer dependency** (and a devDependency for the in-repo build). Importantly, it must be a peer because the upstream library has runtime singletons (`haltState` / `ifOtherSymbol` / `Symbol(...)` constants for `movements` and `symbolCommands`) — duplicate copies would fail `instanceof` checks and break sentinel identity.

All imports use the bare specifier `'@turing-machine-js/machine'`. There is no `/src` deep-import; that pattern was an in-monorepo dev-time shim of the upstream library that has since been retired.

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
- `packages/machine/src/classes/PostMachine.ts` — the runtime; orchestrates the producers, manages references and subroutine support (`subroutineInitialStates`, `subroutineNameValidator`).
- `packages/machine/src/validators.ts` — input validators for instruction indices and subroutine names.

### Subtleties worth knowing

1. **Module-level singletons**: `originalTapeBlock` and `alphabet` in `consts.ts` are global; `PostMachine` clones the tape block per instance to avoid cross-instance contamination. The custom-alphabet path (constructor `options.blankSymbol` / `options.markSymbol`) skips the clone and builds a fresh `TapeBlock.fromAlphabets([new Alphabet([blank, mark])])` instead — the per-instance `#blankSymbol`/`#markSymbol` fields are then threaded into `CommandContext` so `mark`/`erase`/`check` read the chosen glyphs at build time. If you add new built-in commands that need their own per-instance tape state, follow the same clone-per-instance pattern; if they need to reference the alphabet symbols, read them from the context, not from the module-level constants.

2. **Command identity check via `WeakSet`**: `commandsSet` registers every legitimate command-producing function. PostMachine validates user-supplied instructions by checking membership in this set — it's how the runtime distinguishes "user passed a command-producer" from "user passed a random function." Adding new commands requires registering them.

3. **`defaultNextInstructionIndex` sentinel**: a unique `Symbol(...)` used by command producers to mean "no explicit next-instruction was passed; use the runtime-computed default" (i.e. fall through to the next numbered instruction). Don't replace with `null`/`undefined` — they're distinguishable from "user passed null."

4. **Forward references**: PostMachine uses `Reference` (from the upstream library) so an instruction at index 10 can target index 20 even if 20's state isn't built yet. References are bound after the full instruction list is processed.

5. **Group commands**: some producers throw if called from inside a "group" (`calledFromGroup` flag in `CommandContext`). This relates to PostMachine's grouping feature where multiple commands can be bundled into one logical instruction — see how `check`/`call`/`stop` reject group context.

## Doc examples must be tested

Every executable code example in any `README.md` of this repo has a matching test in an `examples.spec.ts` co-located with that README:

- Root `README.md` → `test/examples.spec.ts`
- `packages/<name>/README.md` → `packages/<name>/test/examples.spec.ts`

(One `examples.spec.ts` per README. The repo will have N of them where N is the README count.)

The test mirrors the example verbatim — same imports, same construction, same `replaceTapeWith` + `run()` + values — with the example's `// console.log(...)` output lines kept as comments and replaced with `expect(...).toBe(...)` assertions. Group by source file with `describe('README.md', ...)` / `describe('packages/machine/README.md', ...)`, then by section name with nested `describe`s.

When adding or editing a README example, update the matching test in the same change. Tests fail loud when the README drifts from the actual behavior; without them, prose examples silently rot. *Structural* snippets that don't call `run()` (i.e. shape-illustrating only) are exempt — but prefer to make examples executable when reasonable, so they can be tested.

Non-README tests (sentinel-identity checks, internal plumbing) live in separately-named spec files (e.g. `v3.spec.ts`, `machine.spec.ts`), keeping the `examples.spec.ts` files purely doc-driven.

## Relationship to `@turing-machine-js/machine` v6.0.x

The peer dependency is `^6.0.0`. **v4 and v5 are no longer supported** — a consumer still on those engine majors cannot install this package and must upgrade in lockstep. (post-machine-js skipped a v5 of its own — v6.0.0 is the first post release that crosses to engine v5/v6.)

The upstream v5/v6 changes that drove this release:

- **`pm.run()` stays async.** Engine v4 introduced `Promise<void>` return; v5/v6 didn't change that. Callers must still `await` it.
- **`runStepByStep` stays unchanged.** Still a synchronous `Generator<MachineState>` (engine v6 narrowed the parent's generator return type back to `Generator<MachineState>`, matching post's existing override).
- **Experimental `__onPause` on `pm.run()`** (renamed from `__onDebugBreak` in this release). The `run()` override accepts `__onPause?: (s: MachineState) => void | Promise<void>` and forwards it as the upstream `onPause` hook (renamed from `onDebugBreak` in engine v5). The `__` prefix continues to mark the surface as unstable; the planned per-instruction breakpoint API ([#59](https://github.com/mellonis/post-machine-js/issues/59)) may restructure it. Migration: any consumer using `__onDebugBreak` must rename to `__onPause`.
- **Debugger primitives reachable via peer-dep, not wrapped here.** `state.debug` (per-state runtime-mutable breakpoints, with v5/v6 lifecycle `before → step → after` on the same yield) and `haltState.debug.before` (halt-pause) are available by introspecting `pm.initialState` and operating against the upstream API directly. **Note:** `haltState.debug.after = …` is rejected at write-time in engine v5+ — don't set it. PostMachine deliberately does not wrap any of this — the planned breakpoint API (#59) will provide a higher-level surface once the design settles.
- **`run({ debug: boolean })` master switch (engine v5/#106).** Reachable via the upstream API; not wrapped at the PostMachine level. Useful in tests to suppress all `onPause` dispatches without unsetting `state.debug` assignments.
- **v3 utility additions persist.** `State.toGraph`, `State.fromGraph`, `State.inspect`, `toMermaid`/`fromMermaid`, `summarize`/`summarizeGraph`, `equivalentOn`, and the `MachineState` type are all still re-exported from `@post-machine-js/machine`. v5/v6 added/refined debugger primitives without removing any v3 utilities.
- **Post-aware wrappers persist unchanged.** `summarizePostMachine(machine)` and `equivalentPostMachines(reference, candidate, cases, options?)` remain the recommended path for typical usage. The bare upstream functions stay re-exported for advanced cases (e.g., comparing a PostMachine against a hand-rolled TuringMachine via `equivalentOn`).
- **`machine.initialState` getter persists.** It is still the entry point for the upstream graph utilities to act on a PostMachine instance — pass it to `summarize`, `toMermaid`, `equivalentOn`, or directly to the v4 debugger primitives.

### Jest moduleNameMapper points at `dist/index.cjs`, not `dist/index.js`

`@turing-machine-js/machine` v4 ships only the bundled `.cjs`/`.mjs` builds — the unbundled tsc output (`dist/**/*.js`) is not included in the tarball. The Jest `moduleNameMapper` in both `jest.config.mjs` files therefore resolves `@turing-machine-js/machine` to the bundled `dist/index.cjs` so tests resolve through the bundle. Don't switch back to `dist/index.js`.
