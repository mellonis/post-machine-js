# Instruction Debugger — Design

**Coordinated design for [#59](https://github.com/mellonis/post-machine-js/issues/59), [#63](https://github.com/mellonis/post-machine-js/issues/63), and [#70](https://github.com/mellonis/post-machine-js/issues/70).**

## Overview

PostMachine v6.1.0 ([#67](https://github.com/mellonis/post-machine-js/issues/67)) gave every state an instruction-derived name. This design uses that foundation to expose a coherent debugger surface for instruction-level interaction: address states by path, look them up at construction time, register breakpoints by path, and surface runtime arrival context to consumers.

The three issues split into two layers:

- **Primitive (foundation):** `MachineState` carries `arrivalPath` (the just-traversed reference's instruction path) and `candidatePaths` (informational list of all paths pointing at the current State). This is #70.
- **APIs on top:** path-based breakpoints (#59) filter against `arrivalPath` to preserve per-instruction semantics even when the underlying State is shared via the hash-cache dedup. Static path-to-State resolver (#63) is independent — pure construction-time lookup.

## Goals

- Address every addressable runtime element of a PostMachine program — top-level instructions, instructions inside subroutines (including nested), commands inside groups, groups inside subroutines — through a single uniform notation.
- Reuse the names users already see in Mermaid output, `MachineState.name`, and error messages. No new vocabulary.
- Preserve per-instruction breakpoint semantics in the presence of state sharing (the hash-cache dedup from #67's "State sharing" subsection).
- Make the runtime callback shape rich enough that debugger UIs and tracepoints don't need to reach for `references[]` internals.

## Non-goals

- Engine v7 peer-dep bump and the `withOverrodeHaltState` → `withOverriddenHaltState` rename. Separate post-machine-js v7.0.0 work.
- Step-in / step-out / step-over (turing-machine-js#102). Adjacent but distinct concern, lives at the engine layer.
- Conditional breakpoints with arbitrary predicates (e.g., "pause when tape symbol N is mark"). This design's metadata layer supports such extensions as future work; not in scope here.
- Defeating the hash-cache dedup. State sharing is an intentional optimization; this design accommodates it via the metadata layer rather than removing it.

## Path: the address space

### Type

```ts
type Path = {
  scope?: string | string[];   // 'outer::inner' or ['outer', 'inner'] — both forms accepted
  instructionIndex: number;
  groupInstructionIndex?: number;
};
```

The union-typed `scope` field expresses the same scope chain two ways. Internal logic normalizes via:

```ts
function normalizeScope(scope: string | string[] | undefined): string[] {
  if (!scope) return [];
  return typeof scope === 'string' ? scope.split('::') : scope;
}
```

`undefined`, `''`, and `[]` all normalize to "top-level" (no scope). There is no special prefix for top-level — the path string `'10'` and the object `{ instructionIndex: 10 }` both mean "top-level instruction 10".

### Resolver

```ts
function parsePath(s: string): Path;          // canonicalizes to scope-as-array
function formatPath(p: Path): string;          // accepts either scope form, emits path string
```

`parsePath` canonicalizes scope to the array form (most structured for programmatic iteration). `formatPath` accepts either form for symmetry with how users construct Path literals.

### Path examples

| Path string                          | Object form                                                                            | Meaning                                                |
|--------------------------------------|----------------------------------------------------------------------------------------|--------------------------------------------------------|
| `'10'`                               | `{ instructionIndex: 10 }`                                                             | Top-level instruction 10                               |
| `'10.2'`                             | `{ instructionIndex: 10, groupInstructionIndex: 2 }`                                   | Second command of group at top-level instruction 10   |
| `'foo::1'`                           | `{ scope: 'foo', instructionIndex: 1 }`                                                | Instruction 1 inside subroutine `foo`                  |
| `'foo::10.2'`                        | `{ scope: 'foo', instructionIndex: 10, groupInstructionIndex: 2 }`                     | Group inner inside subroutine                          |
| `'outer::inner::1'`                  | `{ scope: ['outer', 'inner'], instructionIndex: 1 }`                                   | Nested-subroutine instruction                          |
| `'outer::inner::10.2'`               | `{ scope: ['outer', 'inner'], instructionIndex: 10, groupInstructionIndex: 2 }`        | Group inner inside nested subroutine                   |

### Validation

`parsePath` rejects:

- Wrapper composites: `'foo>10~30'`, `'50.1>50~60'` (contain `>`).
- Continuation states: `'10~30'`, `'foo::10~halt'` (contain `~`).
- The `'halt'` literal (singleton, not addressable).
- Leading `::` prefixes: `'::10'`, `'::foo::1'`.
- Malformed scope segments: empty levels (`'foo::::1'`) or non-identifier segments.
- Malformed group index: non-numeric `.<X>` suffixes or `.0` (group inners are 1-indexed).

These are runtime artifacts of the naming convention, not user-addressable instructions. The debugger surface deals in instructions; runtime forwarders are tracked separately via the State graph if needed.

Object-form Path validation at API entry points (e.g., `pm.stateAt`, `pm.setBreakpoint`):

- `instructionIndex` must be a positive integer.
- `groupInstructionIndex`, if present, must be a positive integer.
- `scope` segments, if present, must each pass the existing `subroutineNameValidator` (the `/^[A-Z$_][A-Z0-9$_]*$/i` regex already used by PostMachine internals).

Malformed objects/strings throw at the API entry. Well-formed paths that don't resolve in the current machine (e.g., `pm.stateAt({ instructionIndex: 999 })` when no such instruction exists) return `undefined`.

## #70: WrappedMachineState (primitive)

PostMachine's `run`/`runStepByStep` wrap the upstream `MachineState` to add instruction-level context.

### Type

```ts
type WrappedMachineState = MachineState & {
  arrivalPath: Path;       // canonical: the just-traversed reference's instruction path
  candidatePaths: Path[];  // informational: all paths whose reference points at this State
};
```

- **`arrivalPath`** disambiguates state sharing at runtime. When two instructions share a State via hash dedup, the engine's State is the same object — but the *reference* the engine just followed identifies which instruction the user logically arrived at. `arrivalPath` is built from that reference's instruction index.
  - **First-step convention.** No transition has happened before the first step, so there's no "followed reference". For the first step, `arrivalPath` is the path of the entry instruction — the one whose reference is bound to `initialState` (e.g., for a program starting with instruction 10, `arrivalPath = parsePath('10')` on the first step).
- **`candidatePaths`** is the static fanout: the set of all paths whose references resolve to the current State. Useful for debug-UI visualization ("this state corresponds to instructions 10, 20, and 30 of subroutine foo"). For un-shared states this list has exactly one entry; for shared states it has 2+.
  - **Ordering.** The list is sorted deterministically: scope (lexicographic on the dotted form, with empty/top-level first), then `instructionIndex` (numeric ascending), then `groupInstructionIndex` (numeric ascending, with `undefined` before any number). This makes test assertions and Mermaid output stable across runs.

### Implementation

PostMachine maintains a `state → Path[]` reverse map built at construction time (inverse of `references[]`). The map is finalized after `#buildInitialState` returns.

At runtime, PostMachine wraps the engine's callbacks:

- `onStep(upstreamMachineState)` is intercepted. PostMachine tracks the previous State (the one whose outgoing edge brought control here). The reference that was followed determines `arrivalPath`. The reverse-map lookup yields `candidatePaths`. The wrapper constructs `WrappedMachineState` and forwards to the user's callback.
- `onPause` likewise wrapped.

**Tracking the previous State:** PostMachine's wrapper keeps a single mutable reference (the "last seen State") between callback invocations. The engine guarantees `onStep` is called once per applied transition; the wrapper records the State at each fire, so at fire N+1 it knows the State at fire N. The "edge followed" is derived from the predecessor's `#symbolToDataMap` lookup of the symbol that matched (already available in the engine's internal step). For the *first* step, `arrivalPath` is the initial state's canonical path (the first entry of its `candidatePaths`).

### Runtime API change

`pm.run()` and `pm.runStepByStep()` callback signatures change to receive `WrappedMachineState` instead of bare `MachineState`. This is a breaking change to the experimental `__onPause` and to `onStep` shape, but the additional fields are non-removing — existing consumers reading `state`, `tape`, etc. are unaffected.

## #59: Per-instruction breakpoints

PostMachine registers breakpoints by Path with metadata. At runtime, the engine pauses on the shared underlying State; PostMachine's wrapper consults the registry and decides whether to surface the pause to the user's `onPause` callback.

The callback is named `onPause`, not `onBreakpoint` — per the lesson from [Three Majors, Two Mistakes](https://mellonis.ru/articles/three-majors-two-mistakes) (the post-mortem of engine v4→v5), naming a pause-hook for the debugger use case ("break") leaks that framing into every consumer (replay UIs, animation tweens, step-through visualizers — all are "pausing", not "debugging"). The same hook serves all of them.

### API

```ts
type BreakpointFilter = {
  before?: boolean | string | string[];   // pause before iteration; symbol filter optional
  after?: boolean | string | string[];    // pause after iteration; symbol filter optional
};

type Breakpoint = {
  path: Path;
  filter: BreakpointFilter;
};

pm.setBreakpoint(path: Path | string, filter: BreakpointFilter): void;
pm.clearBreakpoint(path: Path | string): void;
pm.clearBreakpoints(): void;
pm.listBreakpoints(): Breakpoint[];

pm.run({
  onStep?: (machineState: WrappedMachineState) => void;
  onPause?: (machineState: WrappedMachineState) => void | Promise<void>;
  stepsLimit?: number;
});
```

Two callbacks, two concepts:

- `onStep` — fires every step (existing behavior).
- `onPause(machineState)` — fires when the engine pauses. PostMachine's wrapper applies registry-aware filtering before dispatching (see "Pause-wrapper semantics" below).

### Filter aggregation on the engine

Multiple breakpoints can target the same underlying State (e.g., user sets breakpoints on instructions 10 and 20, which share a State via hash dedup). PostMachine maintains a per-State refcount of registered breakpoints. When the count goes from 0 to 1, `state.debug` is enabled with the *union* of all registered filters on that State. Subsequent additions extend the union; removals shrink it. When the count drops back to 0, `state.debug = null` is reset.

The filter on the State is over-broad — it's the union of all registered breakpoints touching that State. Arrival-aware narrowing happens in the pause-wrapper.

### Filter shape

The `BreakpointFilter` shape mirrors the upstream `DebugConfig`:

- `before: true` — pause before each iteration at this state.
- `before: '*'` or `before: ['*', ' ']` — pause only when the read symbol is in the set.
- `after`: same shape, for post-iteration pauses.
- Both can be set together: `{ before: true, after: '*' }`.

If neither `before` nor `after` is set, the breakpoint is a no-op; PostMachine throws to surface the user error.

### Pause-wrapper semantics

PostMachine tracks `registeredStates: Set<State>` — the States that currently have at least one registered breakpoint. When the engine fires a pause at state S:

| Case                                                                  | PostMachine wrapper behavior              |
|-----------------------------------------------------------------------|-------------------------------------------|
| `S ∈ registeredStates` AND a registered breakpoint matches `arrivalPath` (and the filter accepts the current symbol/phase) | Fire `onPause(wrappedMachineState)`        |
| `S ∈ registeredStates` AND no registered breakpoint matches arrival   | Silent resume — engine paused due to a sibling instruction's breakpoint sharing this state; this arrival isn't the one the user asked for |
| `S ∉ registeredStates` (raw `state.debug` set manually via `stateAt`) | Fire `onPause` (raw passthrough — PostMachine's filter is per-state and doesn't apply outside the registry) |

This preserves two contracts simultaneously:

- **Structured contract:** `setBreakpoint(path)` means "pause on arrival at this path" — even when the underlying state is shared. State-sharing is hidden behind the registry's arrival-aware filter.
- **Raw contract:** the engine's `state.debug = ...` mutation still works. Consumers who reach for `pm.stateAt(path).debug = ...` directly get every pause forwarded; PostMachine's per-state filter doesn't apply outside the registry.

The same `onPause` callback serves both contracts. From the consumer's perspective, the callback fires when the engine pauses and reports the arrival via `WrappedMachineState`; how they got there is composable in user code (`if (registeredBreakpoints.match(m.arrivalPath)) { ... } else { /* raw pause */ }`).

`onPause` is awaited; PostMachine's wrapper awaits the user callback before returning control to the engine.

### Interaction with manual `state.debug`

If a user gets a State via `pm.stateAt(path)` and sets `state.debug` directly, they bypass PostMachine's breakpoint registry. The State isn't in `registeredStates`, so the wrapper forwards pauses unchanged. `arrivalPath` is still populated correctly. This is the "raw passthrough" row in the table above.

If a user mixes both modes (some breakpoints via `setBreakpoint`, some manual `state.debug` on different states), each state's behavior is determined independently by whether it's in `registeredStates`. The states with registry entries get arrival-aware filtering; the manual ones don't. No mode flag, no global toggle — per-state.

## #63: Static path resolver

Pure construction-time path-to-State lookup. Independent of runtime behavior.

### API

```ts
pm.stateAt(path: Path | string): State;            // throws if path is invalid OR doesn't resolve
pm.hasState(path: Path | string): boolean;          // existence probe, never throws
pm.candidatesFor(path: Path | string): Path[];      // throws if path is invalid OR doesn't resolve
```

- **`stateAt('10')`** returns the `State` object that `references[10]` is bound to (which may be shared with other instructions). Throws for malformed paths AND for well-formed-but-unresolved paths (e.g., `'999'` when no such instruction). Matches PostMachine's idiom: the engine itself throws `'invalid next instruction index'`, `'undefined subroutine'`, etc., on construction-time misuse — `stateAt` follows the same pattern for query-time misuse.
- **`hasState('10')`** is the existence probe. Returns `true` if the path resolves; `false` for everything else (malformed paths, well-formed-but-unresolved paths, anything that would make `stateAt` throw). Implementation is a trivial try/catch wrapper on `stateAt`. Use this when validating user input in a debugger UI without exception handling.
- **`candidatesFor('10')`** returns all paths whose references resolve to the same State. For un-shared states: `['10']` (single-element). For shared states: e.g., `['10', '20', '30']`. Same shape as `WrappedMachineState.candidatePaths` but computed statically from a Path input. Throws on invalid/unresolved paths (same as `stateAt`).

### Edge cases

- `pm.stateAt({ scope: 'foo', instructionIndex: 10 })` when `foo` isn't a subroutine in this machine → throws (`unknown subroutine 'foo'`).
- `pm.stateAt({ instructionIndex: 999 })` when no such top-level instruction exists → throws (`unknown instruction 999`).
- `pm.stateAt({ instructionIndex: 0 })` → throws (invalid index — must be a positive integer per `instructionIndexValidator`).
- `pm.stateAt('halt')` → throws (`'halt'` is not an instruction path).
- `pm.stateAt('foo>10~30')` → throws (wrapper composite, not an instruction path).
- `pm.hasState({ instructionIndex: 999 })` → returns `false` (the existence probe never throws).
- `pm.candidatesFor` on an unresolved path → throws (same semantics as `stateAt`). For unconditional probing, check `hasState` first.

## State-sharing behavior summary

| Scenario                                                   | Engine layer (raw)                                      | PostMachine wrapper layer                                                         |
|------------------------------------------------------------|---------------------------------------------------------|-----------------------------------------------------------------------------------|
| `setBreakpoint('20')` on State shared with 10              | `state.debug` enabled on shared State; engine pauses on every visit | `onPause` fires only when `arrivalPath = '20'`; silent resume for arrival 10 |
| `setBreakpoint('10')` AND `setBreakpoint('20')` both       | Same as above (filter union; no new `state.debug` toggle) | `onPause` fires on both arrivals; consumer reads `m.arrivalPath` to discriminate |
| Manual `pm.stateAt('20').debug = { before: true }`         | Engine pauses on every visit                            | State not in registry → raw passthrough; `onPause` fires for every visit         |
| `pm.stateAt('10') === pm.stateAt('20')`                    | `true` (same physical State)                            | (irrelevant — `stateAt` is the State-graph escape hatch)                          |
| `WrappedMachineState.arrivalPath`                          | (engine doesn't track this)                             | Always the just-followed reference's path                                         |
| `WrappedMachineState.candidatePaths`                       | (engine doesn't track this)                             | `['10', '20']` for shared, `['30']` for un-shared                                 |

## Public API summary

New exports from `@post-machine-js/machine`:

- Type `Path`.
- Type `WrappedMachineState`.
- Type `BreakpointFilter`.
- Type `Breakpoint`.
- Function `parsePath(s: string): Path`.
- Function `formatPath(p: Path): string`.

New methods on `PostMachine`:

- `setBreakpoint(path, filter)`.
- `clearBreakpoint(path)`.
- `clearBreakpoints()`.
- `listBreakpoints()`.
- `stateAt(path)`.
- `hasState(path)`.
- `candidatesFor(path)`.

Modified methods on `PostMachine`:

- `run(opts)` — callback signatures receive `WrappedMachineState`; rename `__onPause` → `onPause` (drop experimental prefix). Semantics extend the existing `__onPause` with registry-aware filtering: pauses on registered States are filtered by arrival match; pauses on non-registered States (raw `state.debug`) pass through unchanged. Existing `__onPause` consumers see no behavior change after the rename — their states aren't in any registry.
- `runStepByStep(opts)` — yields `WrappedMachineState`.

## Release shape

Land in dependency order:

1. **#70 first** — primitive layer. Smaller change. Enables #59 and (informationally) #63's `candidatesFor`.
   - Breaking: callback signatures yield `WrappedMachineState`. Existing readers of `state`/`tape` unaffected; only the field-added shape changes.
   - Rename `__onPause` → `onPause` (drop experimental prefix). Migration: simple find/replace.
   - Suggested version: **v6.2.0** (minor — additive on a runtime-visible callback shape).

2. **#59 + #63 in parallel** — both built on #70's primitive.
   - #59: new breakpoint registry + filter aggregation + arrival-match logic inside the existing `onPause` callback wrapper. No new callback added — `onPause` gains registry-aware semantics on top of the rename from `__onPause`.
   - #63: new `stateAt`, `hasState`, `candidatesFor` methods.
   - These don't conflict structurally and can land as separate PRs.
   - Suggested version: **v6.3.0** (single bundle) or **v6.3.0 + v6.4.0** (two separate releases — easier to revert if needed).

3. **README "Naming convention" section** updated to reference the new API: the "State sharing" subsection's last sentence ("use the engine's Reference resolution") gets replaced with concrete references to `candidatesFor` and `arrivalPath`.

4. **CHANGELOG entries** for each release with cross-references to the issues closed.

## Out of scope

- Conditional breakpoints with predicates (e.g., `setBreakpoint('10', { when: (machineState) => ... })`). The arrival-match design supports this trivially as future work — add a `when` field to `BreakpointFilter`.
- Step-into / step-over / step-out (turing-machine-js#102). Adjacent design space; the `arrivalPath` primitive here is useful infrastructure for that work, but the step-debugger surface itself is an engine concern, not a PostMachine concern.
- Engine v7 peer-bump (post-machine-js v7.0.0 territory; `withOverrodeHaltState` rename, paren-composite wrapper names).
- Tracepoints (log without pausing). The `onPause` callback can implement tracepoints in user code today (log and return immediately); no API change needed.

## Validation against the issues

- **#59** acceptance — `pm.setBreakpoint(20, { before: true })`, `pm.setBreakpoint('rightToBlank', 2, { after: '*' })`, `pm.clearBreakpoints()`: Covered. `setBreakpoint('20', { before: true })` for top-level instructions; `setBreakpoint('rightToBlank::2', { after: '*' })` for subroutine instructions; `clearBreakpoints()` for batch clear.
- **#63** acceptance — path-based `machine.stateAt({ ... })`: Covered. Both string and object forms accepted via the union-typed Path.
- **#70** acceptance — `MachineState` carries instruction context: Covered via `WrappedMachineState.arrivalPath` (canonical) + `candidatePaths` (informational). The `candidateInstructions: number[]` sketch in #70's body is generalized to `candidatePaths: Path[]` to handle subroutines and groups uniformly.
