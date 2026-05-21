# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.0-alpha.3] - 2026-05-21

Third v7 pre-release. Drops the v6.x subroutine "hopper" State for the common case where it's not needed for forward-declaration ([#85](https://github.com/mellonis/post-machine-js/issues/85)). Engine peer-dep unchanged (`^7.0.0-alpha.2`). Published to npm under the `next` dist-tag: `npm install @post-machine-js/machine@next`.

**Pre-release — the API surface may still shift before stable v7.0.0.** Pin to a specific alpha for reproducibility: `@post-machine-js/machine@7.0.0-alpha.3`.

### Changed

- **Subroutine hopper dropped for acyclic subroutines with plain first instruction** ([#85](https://github.com/mellonis/post-machine-js/issues/85)). PostMachine used to create a "hopper" State per subroutine — a stub State that wrapped a `Reference` to the subroutine's first instruction, providing a forward-declaration anchor for `withOverriddenHaltState`. For the common case, the hopper is now dropped: `call('foo')` wraps `foo::1` directly, saving one State per call site.

  The hopper is **retained** in three cases where dropping it would break the runtime:
  - **Cyclic subroutines** (self-recursion or mutual recursion). Static call-graph analysis (Tarjan's SCC) identifies subroutines participating in cycles; the hopper provides the forward-declaration needed for `call('foo')` to wrap something at the moment of construction. Mutual recursion `foo → bar → foo` continues to work.
  - **Degenerate body `{ 1: stop }`**. The first-instruction "State" would be `haltState` itself; wrapping `haltState` produces an empty `symbolToDataMap` and the engine throws at runtime. Hopper provides a meaningful intermediate.
  - **Leading group `[…]` or leading `call(...)`**. The first-instruction State is itself a wrapper; engine's nested-wohs collapse (#176) would unwrap the inner wrapping when the outer wrapper applies, losing the group's or inner call's continuation. Hopper preserves the chain.

  Subroutines satisfying NONE of these — by far the common case — drop the hopper.

  Observable changes:
  - **Composite wrapper name**: `foo(continuation)` → `foo::1(continuation)` for hopper-dropped subs. Accurately reflects the bare's identity.
  - **`summarizePostMachine().stateCount`**: −1 per hopper-dropped subroutine. The "Structural summary" README example shifts from `7 1 1` (alpha.2) to `6 1 1`.
  - **`toMermaid` subgraph label**: `"callable subtree of foo"` → `"callable subtree of foo::1"` for hopper-dropped subs.
  - **`onStep` callbacks per subroutine entry**: −1 iteration (the hopper used to fire its own `[*] → body₁` transition as a separate step; under #85, the wrapper-of-body₁ executes body₁'s transitions directly).

### Migration from alpha.2

**1. Wrapper composite name parser** — code that does `state.name.match(/^(\w+)\(/)` to extract the bare's name now sees `foo::1` for hopper-dropped subs (and still `foo` for hopper-retained ones). Use `state.bareStateId` (engine #174's GraphNode field) to identify the bare without parsing the name.

**2. Test fixtures asserting `pm.initialState.name === 'foo(...)'`** — update to `'foo::1(...)'` for the hopper-dropped case. Or use a non-trivial body (multiple instructions) and assert on body-state names directly.

**3. Test fixtures asserting exact `stateCount` or onStep call counts** — recompute under the new hopper-drop rules.

**4. `pm.stateAt({ scope: ['foo'] })` or similar path lookups by subroutine name only** — under #85 there's no longer a graph node for the bare name in the hopper-dropped case. Lookups still resolve via the registry; behavior unchanged from a runtime perspective.

### Out of v7-alpha.3 (still pending for stable v7.0.0)

- **[#72](https://github.com/mellonis/post-machine-js/issues/72)** — extend `defineProperty` lockdown to intermediate engine-graph states.
- **[#86](https://github.com/mellonis/post-machine-js/issues/86)** — user-supplied tags/labels on states (Mermaid + debugger surfaces).
- **[#87](https://github.com/mellonis/post-machine-js/issues/87)** — README diagrams for `noop` and trailing-stop behaviors.

### Compatibility

- Engine peer dep unchanged: `^7.0.0-alpha.2`.

## [7.0.0-alpha.2] - 2026-05-21

First post-machine-js v7 pre-release — adopts engine `@turing-machine-js/machine@7.0.0-alpha.2`. **post-machine-js skips its own v7 alpha.1**: engine alpha.1 was superseded by alpha.2 (which refined the `toMermaid` emit before any post-side adoption shipped), so post-machine-js's first v7 prerelease goes straight to alpha.2 matching the engine's current alpha. Published to npm under the `next` dist-tag: `npm install @post-machine-js/machine@next`.

**Pre-release — the API surface may still shift before stable v7.0.0.** Pin to a specific alpha for reproducibility: `@post-machine-js/machine@7.0.0-alpha.2`.

### Changed

- **Engine `withOverrodeHaltState` → `withOverriddenHaltState` adoption** ([#82](https://github.com/mellonis/post-machine-js/issues/82) — engine [#149](https://github.com/mellonis/turing-machine-js/issues/149)). Consumer-side references in `src/commands.ts`, `src/classes/PostMachine.ts`, README narrative, and root CLAUDE.md all switched to the renamed identifier. Hard cutover — no deprecated alias.

- **Wrapper composite name format `>` → `(…)` adoption** ([#83](https://github.com/mellonis/post-machine-js/issues/83) — engine [#148](https://github.com/mellonis/turing-machine-js/issues/148)). Engine v7 changed wrapper composite shape from `A>B` to `A(B)`. PostMachine's `Path` separators (`::`, `.`, `~`) survive unchanged. `parsePath` now rejects `(`/`)` in user-provided state names (previously rejected `>`). Test assertions on `initialState.name` and graph node-name checks updated; README naming-convention table + "Reading a wrapper composite" section + "Reading the engine output" guide rewritten.

- **`toMermaid` callable-subtree emit adoption** (engine [#174](https://github.com/mellonis/turing-machine-js/issues/174); no separate post-side issue — engine alpha.2 forced this). The wrapper composite is now a `[[bare(continuation)]]` call site OUTSIDE the subgraph; the callable subtree (`subgraph w_N["callable subtree of NAME"]`) contains the bare hopper + body states + a frame-local halt marker. Bold `==> "call"` arrow from wrapper to bare; dotted `-. "return" .->` from subgraph back to wrapper. The retired alpha.1 `-. onHalt .->` keyword no longer appears — wrapper-to-override is just a solid `-->` arrow. README's engine-emit Mermaid block regenerated. Test expectations updated.

  As a knock-on effect of separating wrapper/bare nodes, `summarizePostMachine` reports +1 `stateCount` per subroutine call site vs alpha.1. The example in the "Structural summary" section reports `7 1 1` (was `6 1 1` under alpha.1's collapsed-bare emit).

### Compatibility

- Peer dep `@turing-machine-js/machine` widened `^6.4.0` → `^7.0.0-alpha.2`. v4/v5/v6 engine majors are no longer supported on the v7 line — consumers must upgrade in lockstep.

### Out of v7-alpha.2 (still pending for stable v7.0.0)

- **[#72](https://github.com/mellonis/post-machine-js/issues/72)** — extend `defineProperty` lockdown to intermediate engine-graph states (continuations, hoppers, group wrappers). Construction-time tightening; doesn't affect runtime semantics for existing programs.

### Migration

For consumers updating from v6.x:

**1. Engine identifier rename** — if you import `withOverrodeHaltState` directly from `@turing-machine-js/machine` (rare; PostMachine wraps it internally), rename to `withOverriddenHaltState`.

**2. Wrapper composite shape in `state.name`** — `"foo>10~40"` is now `"foo(10~40)"`. Code that parses wrapper names by `>`-splitting needs to switch to paren-parsing.

**3. State names with `(`/`)` rejected** — `new PostMachine({ "foo(bar)": { 1: stop } })` now throws. The collision is structural: paren is the new wrapper-composition delimiter.

**4. `toMermaid` output format** — the wrapper now sits OUTSIDE the subgraph as a separate `[[…]]` node; the bare hopper is INSIDE the `callable subtree` subgraph as a regular `[…]` node. Body's halt-bound transitions land on the frame's halt marker `cN`, not on the real `s0` halt. If you render or pattern-match Mermaid output, the shape changed completely — see the README's "Reading the engine output" section.

**5. `summarizePostMachine().stateCount` may shift** — each call site (`call(...)`) now contributes ONE more state to the count (the separate wrapper node). Existing assertions on exact stateCount need adjusting.

## [6.4.0] - 2026-05-19

Adopts the engine's new [`onIter`](https://github.com/mellonis/turing-machine-js/pull/164) hook to fix a pre-existing `arrivalPath` ordering bug. **Version skips 6.2.0 and 6.3.0** — both were prepared but neither was published (see history note below).

### Fixed

- **`arrivalPath` ordering bug in `onPause(after, K)`** ([turing-machine-js#163](https://github.com/mellonis/turing-machine-js/issues/163) on the engine side; regression test in [`test/breakpoints.spec.ts`](packages/machine/test/breakpoints.spec.ts)). Since v6.1.0, the internal `onStep` wrapper advanced `prev` mid-iter, which raced engine v6.0.0+'s per-iter `before → step → after` dispatch order. By the time `onPause(after, K)` fired on the same yield, `prev` had already advanced to iter K's own state — so `m.arrivalPath` resolved to iter K+1's instruction instead of K's. Worse: the registry-aware `#shouldFireOnPause` filter then saw the wrong path and **silently dropped** user-registered `{ after: true }` breakpoints rather than firing them with a wrong field.

  Fixed by moving `advanceTracking` from the internal `onStep` wrapper to a new internal `onIter` wrapper. `onIter` fires at end-of-iter — after both `onPause` dispatches on the same yield have already read their iter-correct `prev` — so the advance no longer races them. Required engine v6.4.0 (the new `onIter` hook itself).

### Added

- **`onIter` parameter** on `pm.run()`: `onIter?: (m: MachineState) => void | Promise<void>`. Forwards to the engine's `onIter` hook with PostMachine's wrapped `MachineState` (so `m.arrivalPath` and `m.candidatePaths` are populated). Use for per-iter coordination — throttle, animation, yield-to-other-work — across the same arrival-aware filtering you get on `onPause`. Awaited inline.

### Changed

- **Engine peer dep**: `^6.0.0` → `^6.4.0`. Required because v6.4.0 added the `onIter` hook the fix above depends on. Consumers on engine v6.0.x — v6.3.x get a peer-dep warning and cannot install this version of `@post-machine-js/machine`.
- Internal `onStep` wrapper is now conditional (registered only when the user provides `onStep`), since it no longer carries the always-on `advanceTracking` side-effect. Engine zero-cost when consumer provides no callbacks at all.

### History note — v6.2.0 / v6.3.0 not published

Both versions were prepared but neither shipped to npm:

- **v6.2.0** ([PR #77](https://github.com/mellonis/post-machine-js/pull/77), closed unmerged) — bumped engine peer-dep to `^6.2.0` to ride the engine's brief `await onStep` widening. Closed after engine v6.2.0 was identified as a mistake and reverted in engine v6.3.0.
- **v6.3.0** ([PR #78](https://github.com/mellonis/post-machine-js/pull/78), merged without version bump) — reverted PostMachine's matching `async` wrapper to sync, but didn't ship a new release on its own. Merged into master as a deferred-release fix; this v6.4.0 PR is the first release shipping that change.

### Compatibility

- **From v6.1.0** — engine peer-dep widened from `^6.0.0` to `^6.4.0`. Consumers on engine v6.0.x – v6.3.x must upgrade the engine alongside this package. No source-level API breaks; the `onIter` parameter is purely additive.

## [6.1.0] - 2026-05-18

The v6 debugger surface lands, plus the naming foundation it builds on. Bundles three threads of work that landed on master between v6.0.0 and this release: instruction-derived state names ([#67](https://github.com/mellonis/post-machine-js/issues/67)), runtime-callback instruction context ([#70](https://github.com/mellonis/post-machine-js/issues/70)), and per-instruction breakpoints + path-based State resolver + per-State lockdown ([#59](https://github.com/mellonis/post-machine-js/issues/59), [#63](https://github.com/mellonis/post-machine-js/issues/63)).

### Added

#### State naming (#67)

- All states constructed inside `PostMachine#buildInitialState` now carry an instruction-derived `name`. Previously every state was labeled `id:N` (engine-default auto-counter); now top-level instructions are labeled `"N"`, subroutine body instructions `"<sub>::N"`, group inners `"<outer>.<inner>"`, continuation states `"<caller>~<target>"`, and `withOverrodeHaltState` wrappers compose to e.g. `"foo>10~30"`.
- This makes `toMermaid` output, `summarize` output, and `MachineState.name` readable without an external translation step. See the README's "[Naming convention](#naming-convention)" section for the full reference.

#### Path type and runtime-callback context (#70)

- New exports: type `Path`, function `parsePath(s: string): Path`, function `formatPath(p: Path): string`. The path-string format mirrors the naming convention above — `'10'`, `'foo::1'`, `'50.2'`, `'outer::inner::10.2'`, etc.
- `MachineState` (re-exported from `@post-machine-js/machine`) now resolves to the engine's `MachineState` extended with two PostMachine-flavored fields: `arrivalPath: Path` and `candidatePaths: Path[]`. The `onStep` and `onPause` callbacks for `pm.run()` and `pm.runStepByStep()` receive the extended shape.
- `arrivalPath` disambiguates the state-sharing UX gap noted in the "State sharing across structurally-identical instructions" subsection. When two instructions share a State, `arrivalPath` reports the specific instruction the engine just transitioned through (not the canonical first-named one).
- `candidatePaths` exposes the full set of paths sharing the current State, sorted deterministically (scope lex, then instruction index, then group inner index).

#### Path-based State resolver (#63)

- `pm.stateAt(path)`, `pm.hasState(path)`, `pm.candidatesFor(path)`. Accepts both path strings (`'foo::10.2'`) and object form (`{ scope, instructionIndex, groupInstructionIndex }`). Both `string` and `string[]` scope forms work for the object variant.

#### Per-instruction breakpoint registry + lockdown (#59)

- `pm.setBreakpoint(target, filter)`, `pm.clearBreakpoint(target)`, `pm.clearBreakpoints()`, `pm.listBreakpoints()`. `target` is `Path | string | State` (the State form is accepted only for `haltState`). Filters mirror the engine's `DebugConfig` shape.
- **Construction-time lockdown:** `state.debug = X` on a State returned by `pm.stateAt(...)` or `pm.initialState` is intercepted. For un-shared States (one candidate path), the write transparently redirects to `pm.setBreakpoint(thatPath, X)` (or `pm.clearBreakpoint` when X is `null`). For shared States (multiple candidate paths), the write throws with the candidate-path list, since the assignment is ambiguous.
- **`haltState` lockdown:** direct `haltState.debug = X` throws — `pm.setBreakpoint(haltState, ...)` is the only channel. The lockdown is installed at module load on the engine's `haltState` singleton.
- New types exported: `Breakpoint`, `BreakpointFilter`, `BreakpointTarget`.
- `haltState` is now an explicit named export from `@post-machine-js/machine` (re-exported from the engine).

### Changed

- **BREAKING (experimental → stable)** — `__onPause` callback on `pm.run()` renamed to `onPause`. The `__` prefix was the contract that this surface might restructure without warning; the breakpoint API doesn't restructure `onPause`'s shape, so the prefix is dropped.
- **Single-channel debug model.** Every `state.debug = X` write — construction-time *or* inside `onStep`/`onPause` callbacks — routes through the registry. `pm.listBreakpoints()` is the sole source of truth for what will fire `onPause`.
- **Arrival-aware `onPause` filtering.** When two instructions share an underlying State (hash dedup), the engine pauses on every visit; PostMachine's wrapper only surfaces the pause when `m.arrivalPath` matches a registered breakpoint. Sibling-instruction visits silently resume.
- **`pm.run()` internal `onStep` is always registered with the engine.** The arrival-tracking state advances every iteration regardless of whether the user provided `onStep`. (Fixes a stale-arrival bug for runs with only `onPause`.)
- Doc-tests in `packages/machine/test/examples.spec.ts` previously used regex shape-pinning (`s\d+\("id:\d+"\)`) because state IDs were a global counter and shifted between test runs. Now that names are deterministic, those assertions pin literal labels (`"rightToBlank>1~2"`, `"10"`, `"20"`, etc.).
- README's two `<details>` Mermaid blocks (Quick Start example and Subroutine example) updated to show the new instruction-derived labels instead of `id:N` placeholders.

### Notes

- No engine peer-dep bump — this release ships against `@turing-machine-js/machine ^6.0.0` (unchanged).
- The lockdown uses `Object.defineProperty` on each constructed State (and on `haltState` once at module load), not a `Proxy`. Proxy was tried during implementation and abandoned because engine utilities like `State.toGraph(state, ...)` read TS-downleveled private fields directly off their argument via `__classPrivateFieldGet`, which fails on a Proxy. The defineProperty approach leaves States bare so engine utilities continue to work.
- Each State knows its PostMachine context via the redirect closure; multiple PostMachine instances each install their own lockdown on their States. `haltState` is shared across instances and is locked module-globally.
- The `Path` type uses a `scope?: string | string[]` union so consumers can write either `{ scope: 'foo::bar', ... }` (dotted-string form) or `{ scope: ['foo', 'bar'], ... }` (array form). `parsePath` returns the array form (canonical); both are accepted by every API that takes a Path.
- For state-sharing: the canonical `candidatePaths[0]` is the canonical Path (first by scope, then instruction index); `arrivalPath` may differ when the engine arrived via a non-canonical reference.
- The `id:N` → instruction-derived naming changes Mermaid output string shapes. Consumers parsing names literally (e.g., `state.name === "some>composite"`) need to update their expectations.
- Forward-compatibility with engine v7: PostMachine's chosen separators (`::`, `.`, `~`) survive engine v7's planned paren-based wrapper composite ([turing-machine-js#148](https://github.com/mellonis/turing-machine-js/issues/148)) and the likely ban on `(`, `)`, `>` in user-provided names. When the v7 peer-dep bump lands, only the engine-emitted wrapper composite changes shape (`"foo>10~40"` → `"foo(10~40)"`); PostMachine's internally-constructed names stay the same.
- Round-trip name accumulation through `State.fromGraph` (upstream [turing-machine-js#138](https://github.com/mellonis/turing-machine-js/issues/138) / [#139](https://github.com/mellonis/turing-machine-js/issues/139)) is more visible now because composite names are user-meaningful (`"foo>10~20"` accumulating into `"foo>10~20>20"` after a graph round-trip reads as a real bug rather than `id:N` noise). The upstream fix lands in engine v7.
- The graph-walk escape (`pm.stateAt('10').getNextStateForSymbol(...)` reaches an un-locked intermediate State — continuation, hopper, or group wrapper) remains, tracked in [#72](https://github.com/mellonis/post-machine-js/issues/72) (v7 territory alongside the engine peer-bump).

### Migration

```diff
- await pm.run({ __onPause: handler });
+ await pm.run({ onPause: handler });
```

- Direct `machine.initialState.debug = { before: true }` now redirects to `pm.setBreakpoint(<entry-path>, { before: true })` automatically. Existing code keeps working; the registry just becomes visible to `pm.listBreakpoints()`.
- For shared-State direct writes, switch to `pm.setBreakpoint(<specific-path>, ...)` — the redirect throws with the candidate-path list to surface the ambiguity.
- `haltState.debug = X` no longer works as a direct setter; use `pm.setBreakpoint(haltState, X)`.
- State-name parsers that pinned the old `id:N` literal need to update for the new instruction-derived shapes — see the README's "[Naming convention](#naming-convention)" section.

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
