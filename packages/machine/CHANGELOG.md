# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.1.0] - 2026-MM-DD

Instruction-derived state names for everything PostMachine constructs. Foundation for #59 (per-instruction breakpoint API) and #63 (state-by-instruction-label lookup) — both unblocked by this change.

### Added

- All states constructed inside `PostMachine#buildInitialState` now carry an instruction-derived `name`. Previously every state was labeled `id:N` (engine-default auto-counter); now top-level instructions are labeled `"N"`, subroutine body instructions `"<sub>::N"`, group inners `"<outer>.<inner>"`, continuation states `"<caller>~<target>"`, and `withOverrodeHaltState` wrappers compose to e.g. `"foo>10~30"`. (#67)
- This makes `toMermaid` output, `summarize` output, and `MachineState.name` readable without an external translation step. See the README's "[Naming convention](#naming-convention)" section for the full reference.

### Changed

- Doc-tests in `packages/machine/test/examples.spec.ts` previously used regex shape-pinning (`s\d+\("id:\d+"\)`) because state IDs were a global counter and shifted between test runs. Now that names are deterministic, those assertions pin literal labels (`"rightToBlank>1~2"`, `"10"`, `"20"`, etc.).
- README's two `<details>` Mermaid blocks (Quick Start example and Subroutine example) updated to show the new instruction-derived labels instead of `id:N` placeholders. Reading-guide bullets updated accordingly.

### Notes

- No engine peer-dep bump — this release ships against `@turing-machine-js/machine ^6.0.0` (unchanged).
- The `id:N` → instruction-derived naming changes Mermaid output string shapes. Consumers parsing names literally (e.g., `state.name === "some>composite"`) need to update their expectations.
- Forward-compatibility with engine v7: PostMachine's chosen separators (`::`, `.`, `~`) survive engine v7's planned paren-based wrapper composite ([turing-machine-js#148](https://github.com/mellonis/turing-machine-js/issues/148)) and the likely ban on `(`, `)`, `>` in user-provided names. When the v7 peer-dep bump lands, only the engine-emitted wrapper composite changes shape (`"foo>10~40"` → `"foo(10~40)"`); PostMachine's internally-constructed names stay the same.
- Round-trip name accumulation through `State.fromGraph` (upstream [turing-machine-js#138](https://github.com/mellonis/turing-machine-js/issues/138) / [#139](https://github.com/mellonis/turing-machine-js/issues/139)) is more visible now because composite names are user-meaningful (`"foo>10~20"` accumulating into `"foo>10~20>20"` after a graph round-trip reads as a real bug rather than `id:N` noise). The upstream fix lands in engine v7.

### Migration

No call-site changes required. State names are labels, not load-bearing for execution. Consumers parsing names literally need to update their expectations to the new shapes — see the README's "[Naming convention](#naming-convention)" section.

## [6.0.0] - 2026-05-10

Lockstep release with `@turing-machine-js/machine` v6 (post-machine-js skipped v5 of its own — this is the first release that crosses to engine v5/v6).

### Changed

- **BREAKING** — `peerDependencies['@turing-machine-js/machine']` raised from `^4.0.0` to `^6.0.0`. Engine v4 and v5 are no longer supported; consumers must upgrade in lockstep.
- **BREAKING** — Experimental `__onDebugBreak` callback on `pm.run()` renamed to `__onPause`, mirroring engine v5's `onDebugBreak` → `onPause` rename (turing-machine-js#109/#110). The `__` prefix was the explicit contract that this surface might rename without warning. Behavior is unchanged (still forwards the callback to the upstream debugger; still `(machineState: MachineState) => void | Promise<void>`).

### Engine v5/v6 surface relevant when consumers reach past PostMachine

- The engine's `state.debug` per-iter lifecycle is now `before → step → after` on the same yield (engine v6/#119) — was v4's "after fires on iter K+1's yield" via a `prevYield` substitution dance. Tests that observed cross-hook ordering at the lifecycle level need a v6-aware shape; PostMachine's own tests don't observe ordering and pass unchanged.
- `haltState.debug.after = …` is rejected at write-time in engine v5+ (turing-machine-js#108 part 2) — halt is terminal, no iteration-after-halt to anchor on. Use `haltState.debug.before = true` instead.
- `run({ debug: boolean })` master switch on the engine (turing-machine-js#106) suppresses all `onPause` dispatches without editing `state.debug` assignments. Reachable via the upstream API; not wrapped at the PostMachine level.

### Migration

```sh
npm install @turing-machine-js/machine@^6.0.0 @post-machine-js/machine@^6.0.0
```

```diff
- await pm.run({ __onDebugBreak: handler });
+ await pm.run({ __onPause: handler });
```

No call-site changes for consumers using only `pm.run()` / `pm.runStepByStep()` / the `onStep` hook.

### Internal (consumer-invisible — does not affect the published tarball's runtime)

- **Test runner migrated Jest → Vitest.** Single root `vitest.config.ts` with `resolve.alias` for source-vs-built imports, replaces the per-package `jest.config.mjs` plus root `jest.config.mjs`. The babel toolchain (`@babel/core`, `@babel/preset-env`, `@babel/preset-typescript`, `babel-jest`) is dropped — vitest uses esbuild for TypeScript, no babel needed. `jest.fn()` calls renamed to `vi.fn()`. Coverage thresholds set in config (95 / 90 / 95 / 95).
- **CI:** Node 22.x → 24, dropped single-value matrix (required check name `build (22.x)` → `build`), removed vestigial `next` from triggers, normalized `actions/add-to-project@v1.0.2` → `@v2`. Mirrors turing-machine-js#142.
- **Deps refreshed to latest** (`eslint`, `rollup`, `typescript-eslint`, etc.) before the vitest migration so each step started from a clean baseline.
- **README:** dual-layer Mermaid pattern added for the Quick Start example — hand-drawn diagram with friendly instruction labels (`10:` / `20:` / `30:`) plus a `<details>` block showing the engine-emitted source via `toMermaid(State.toGraph(...))`. Doc-test added pinning the engine output's structural shape (regex on node syntax, exact edge labels) so the README and engine output stay aligned.
- **Author email** in `package.json` updated `mellonis14@gmain.com` → `mellonis@yandex.ru`.

## [4.0.0] - 2026-05-07

### Changed

- **BREAKING** — `peerDependencies['@turing-machine-js/machine']` raised from `^3.0.1` to `^4.0.0`. v3 is no longer supported; consumers must upgrade in lockstep. ([#58](https://github.com/mellonis/post-machine-js/issues/58))
- **BREAKING** — `PostMachine.prototype.run` is now `async` and returns `Promise<void>`. Mirrors turing v4's async `TuringMachine.run`. Callers must `await` it (or chain `.then`); previously-synchronous callers will silently drop work otherwise.

### Added

- **Experimental `__onDebugBreak` callback** on `PostMachine.prototype.run` — `(machineState: MachineState) => void | Promise<void>`. Forwarded to turing v4's `onDebugBreak` hook and fires when a state with `state.debug` set is reached. The `__` prefix marks the surface unstable: a higher-level per-instruction breakpoint API is being designed and may rename or restructure this parameter without another major bump. ([#59](https://github.com/mellonis/post-machine-js/issues/59))
- **`MachineState`** type re-exported from the package entry so consumers can annotate `onStep` / `__onDebugBreak` callbacks without taking a direct dependency on `@turing-machine-js/machine`.

### Migration

```sh
npm install @turing-machine-js/machine@^4.0.0 @post-machine-js/machine@^4.0.0
```

```diff
- machine.run();
+ await machine.run();
```

`runStepByStep` is unchanged (still a synchronous `Generator<MachineState>` — only `run()` went async).

## [3.1.0] - 2026-05-05

### Added

- **`PostMachine` constructor accepts an optional second argument** `{ blankSymbol?: string; markSymbol?: string }` that selects the two glyphs used by the per-instance alphabet. Defaults to `' '` / `'*'` so existing callers are unaffected. Each must be a single character and distinct from the other; `null` / `undefined` fall back to the default. ([#55](https://github.com/mellonis/post-machine-js/issues/55))
- **`PostMachineOptions`** type re-exported from the package entry for callers that want to factor out the options bag.

### Changed (internal)

- `CommandContext` gains `blankSymbol` and `markSymbol`; `mark` / `erase` / `check` read them from the context at build time instead of closing over the module-level constants. `left` / `right` / `noop` are unaffected (no symbol writes). When the constructor receives a non-default symbol, a fresh `TapeBlock.fromAlphabets([new Alphabet([blank, mark])])` is built per instance; the default path still clones `originalTapeBlock` to preserve existing behavior bit-for-bit.

## [3.0.1] - 2026-04-30

### Added

- **`summarizePostMachine(machine)`** — Post-aware free-function wrapper for `summarize(machine.initialState, machine.tapeBlock)`. Saves the caller from passing the two args.
- **`equivalentPostMachines(reference, candidate, cases, options?)`** — Post-aware wrapper for `equivalentOn` against two `PostMachine` instances. Hides the `getTapeBlock`-must-clone footgun (PostMachine state-graph symbols are interned per-block, so a fresh `TapeBlock.fromAlphabets([alphabet])` doesn't work — the wrapper passes `() => machine.tapeBlock.clone()` factories internally). Pass-through `options` arg is forwarded to upstream `equivalentOn`.

### Changed (internal)

- **`MachineState`** is now imported directly from `@turing-machine-js/machine` (re-exported from its `index.ts` in turing 3.0.1) instead of being extracted via `Generator<infer T>` from `runStepByStep`'s return signature. No observable change; cleaner code.
- **`peerDependencies['@turing-machine-js/machine']`** raised from `^3.0.0` to `^3.0.1`. Required because the new direct `MachineState` import only typechecks against turing 3.0.1+. Runtime is unchanged (turing 3.0.1 is a patch — no breaking changes from 3.0.0).

## [3.0.0] - 2026-04-30

### Added

- **`PostMachine.prototype.initialState`** — getter exposing the precomputed start state. Lets the upstream graph utilities (`State.toGraph`, `summarize`, `equivalentOn`) be invoked against a `PostMachine` directly: `State.toGraph(machine.initialState, machine.tapeBlock)`. The only new instance member; all v3 utilities are called as bare functions, not methods, to keep a single way to do each thing.
- Re-exports of upstream v3 utilities so consumers don't need to import `@turing-machine-js/machine` separately: `State`, `toMermaid`, `fromMermaid`, `summarize`, `summarizeGraph`, `equivalentOn`.
- Re-exports of upstream v3 types: `Graph`, `GraphNode`, `GraphTransition`, `GraphCommand`, `GraphSummary`, `Runnable`, `EquivalenceCase`, `EquivalenceResult`, `EquivalenceReport`.
- Public types `Instructions`, `CommandStateProducer`, `CommandConstructor`, `CommandContext` for stronger consumer-side type-checking. `Instructions` is now a recursive discriminated shape (commands / groups / subroutine records) instead of `Record<string | number, unknown>`, so a typo or wrong-shape value is caught at compile time before the runtime validators see it.

### Fixed

- `subroutineNameValidator` now correctly rejects names like `'1abc'`, `'foo bar'`, or `'$$ x'`. The regex was missing `^...$` anchors, so any input *containing* a valid identifier substring passed. ([`validators.ts`](src/validators.ts))

### Changed

- **BREAKING** — `peerDependencies['@turing-machine-js/machine']` raised from `^2.0.2` to `^3.0.0`. Consumers must upgrade the upstream peer in lockstep.
- TypeScript `target` and `module` raised from `ES6` to `ES2020` (consumers see compiled `dist/` only — no observable difference at runtime).
- Toolchain modernized: Jest 30, ESLint 10, Lerna 9, TypeScript 6, `@tsconfig/recommended` 1.0.13.
- Internal: the five "unary" command state-producers (`erase`, `left`, `mark`, `noop`, `right`) were refactored through a single `makeUnaryCommandProducer(hashPrefix, command)` factory. `commands.ts` shrank from 522 to 310 lines with no behavior change. `call` and `check` keep their bespoke producers (their semantics differ enough not to share the factory).
- Internal: `PostMachine#buildInitialState` converted from arrow class field to private method. Same `this` semantics; one method on the prototype instead of one per instance.

### Migration

```sh
npm install @turing-machine-js/machine@^3.0.0 @post-machine-js/machine@^3.0.0
```

If you imported via the now-removed `@turing-machine-js/machine/src` subpath, switch to the bare specifier:

```diff
- import { ... } from '@turing-machine-js/machine/src';
+ import { ... } from '@turing-machine-js/machine';
```

`@post-machine-js/machine` itself never used the `/src` subpath, so no change is needed inside this package.

## [2.0.2] - earlier

Initial public 2.x release on top of `@turing-machine-js/machine` ^2.0.2.
