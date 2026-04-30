# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
