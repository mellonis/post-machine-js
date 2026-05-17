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

PostMachine registers breakpoints by Path with metadata. At runtime, the engine pauses on the shared underlying State; PostMachine's wrapper consults the registry and decides whether to surface the pause to the user's callback.

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
  onBreakpoint?: (breakpoint: Breakpoint, machineState: WrappedMachineState) => void | Promise<void>;
  onPause?: (machineState: WrappedMachineState) => void | Promise<void>;   // raw mode
  stepsLimit?: number;
});
```

Three callbacks, three concepts:

- `onStep` — fires every step (existing behavior).
- `onBreakpoint(breakpoint, machineState)` — fires when a registered breakpoint's path matches `machineState.arrivalPath` AND its filter accepts the current step's read symbol. This is the structured API.
- `onPause(machineState)` — fires on every engine pause (i.e., whenever `state.debug` matched), regardless of breakpoint registration. This is the raw-mode escape hatch — the existing `__onPause` renamed; the experimental prefix is dropped because the new structured `onBreakpoint` API supersedes the need for "this surface might change". `onPause` becomes the stable raw channel.

### Filter aggregation

Multiple breakpoints can target the same underlying State (e.g., user sets breakpoints on instructions 10 and 20, which share a State). PostMachine maintains a per-State count of registered breakpoints. When the count goes from 0 to 1, `state.debug` is enabled with the *union* of all registered filters on that State. Subsequent additions extend the union; removals shrink it. When the count drops to 0, `state.debug = null` is reset.

The filter on the State is over-broad (union of all registered breakpoints' filters). The arrival-match filtering in PostMachine's wrapper narrows the engine's raw pauses back down to per-instruction granularity.

### Filter shape

The `BreakpointFilter` shape mirrors the upstream `DebugConfig`:

- `before: true` — pause before each iteration at this state.
- `before: '*'` or `before: ['*', ' ']` — pause only when the read symbol is in the set.
- `after`: same shape, for post-iteration pauses.
- Both can be set together: `{ before: true, after: '*' }`.

If neither `before` nor `after` is set, the breakpoint is a no-op; PostMachine throws to surface the user error.

### Silent-resume semantics

When the engine fires a pause and the wrapper checks the registry:

1. Look up the State in the reverse map → get the candidate paths.
2. For each candidate path, look up registered breakpoints in the registry.
3. Filter to those whose path matches the current `arrivalPath` AND whose filter accepts the current symbol/lifecycle phase.
4. If any breakpoint matches: invoke `onBreakpoint(matchedBreakpoint, wrappedMachineState)` and `onPause(wrappedMachineState)`.
5. If none matches but `onPause` is registered: still invoke `onPause` (raw mode).
6. If no match and no `onPause`: silent-resume (engine pauses, PostMachine's wrapper takes no user-visible action).

The engine's `onPause` is awaited; PostMachine's wrapper awaits all user callbacks before returning to the engine.

### Interaction with manual `state.debug`

If a user gets a State via `pm.stateAt(path)` and sets `state.debug` directly, they bypass PostMachine's breakpoint registry. The wrapper sees the pause, finds no registered breakpoint matches, and:

- If `onPause` is registered, forwards as raw pause.
- Otherwise silent-resumes.

This is intentional — `stateAt` is the State-graph escape hatch; users who reach for it accept State-level semantics including state sharing. The structured breakpoint API is the supported path for instruction-level debugging.

## #63: Static path resolver

Pure construction-time path-to-State lookup. Independent of runtime behavior.

### API

```ts
pm.stateAt(path: Path | string): State | undefined;
pm.candidatesFor(path: Path | string): Path[];
```

- `stateAt('10')` returns the State object that `references[10]` is bound to (which may be shared with other instructions). Returns `undefined` if the path doesn't resolve in this machine. Throws if the path is malformed.
- `candidatesFor('10')` returns all paths whose references resolve to the same State. For un-shared states: `['10']` (single-element). For shared states: e.g., `['10', '20', '30']`. Identical to `WrappedMachineState.candidatePaths` but computed statically from a Path input.

### Edge cases

- `pm.stateAt({ subroutine: 'foo', instructionIndex: 10 })` when `foo` doesn't exist → `undefined` (not throw — the path is well-formed, just doesn't resolve here).
- `pm.stateAt({ instructionIndex: 0 })` → throws (invalid instruction index — must be a positive integer per `instructionIndexValidator`).
- `pm.stateAt('halt')` → throws (`'halt'` is not an instruction path).
- `pm.candidatesFor` on a path that doesn't resolve → returns `[]` (empty list).

## State-sharing behavior summary

| Scenario                                                   | Engine layer (raw)              | Wrapper layer (structured)                       |
|------------------------------------------------------------|---------------------------------|--------------------------------------------------|
| `setBreakpoint('20')` on State shared with 10              | `state.debug` enabled on shared State; engine pauses on every visit | `onBreakpoint` fires only when `arrivalPath = '20'`; silent resume for arrival 10 |
| `setBreakpoint('10')` AND `setBreakpoint('20')` (both)     | Same as above (no new state.debug change)               | `onBreakpoint` fires on both arrivals, with matching `Breakpoint` arg     |
| Manual `pm.stateAt('20').debug = { before: true }`         | Engine pauses on every visit                             | No registered breakpoint matches; falls through to `onPause` if present, else silent resume |
| `pm.stateAt('10') === pm.stateAt('20')`                    | `true` (same physical State)                             | (irrelevant)                                     |
| `WrappedMachineState.arrivalPath`                          | (engine doesn't track this)                              | Always the just-followed reference's path        |
| `WrappedMachineState.candidatePaths`                       | (engine doesn't track this)                              | `['10', '20']` for shared, `['30']` for un-shared|

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
- `candidatesFor(path)`.

Modified methods on `PostMachine`:

- `run(opts)` — callback signatures receive `WrappedMachineState`; new `onBreakpoint` opt; rename `__onPause` → `onPause` (drop experimental prefix; semantics unchanged, but now part of a documented three-callback API).
- `runStepByStep(opts)` — yields `WrappedMachineState`.

## Release shape

Land in dependency order:

1. **#70 first** — primitive layer. Smaller change. Enables #59 and (informationally) #63's `candidatesFor`.
   - Breaking: callback signatures yield `WrappedMachineState`. Existing readers of `state`/`tape` unaffected; only the field-added shape changes.
   - Rename `__onPause` → `onPause` (drop experimental prefix). Migration: simple find/replace.
   - Suggested version: **v6.2.0** (minor — additive on a runtime-visible callback shape).

2. **#59 + #63 in parallel** — both built on #70's primitive.
   - #59: new breakpoint registry + filter aggregation + arrival-match wrapper. New `onBreakpoint` callback.
   - #63: new `stateAt` + `candidatesFor` methods.
   - These don't conflict structurally and can land as separate PRs.
   - Suggested version: **v6.3.0** (single bundle) or **v6.3.0 + v6.4.0** (two separate releases — easier to revert if needed).

3. **README "Naming convention" section** updated to reference the new API: the "State sharing" subsection's last sentence ("use the engine's Reference resolution") gets replaced with concrete references to `candidatesFor` and `arrivalPath`.

4. **CHANGELOG entries** for each release with cross-references to the issues closed.

## Out of scope

- Conditional breakpoints with predicates (e.g., `setBreakpoint('10', { when: (machineState) => ... })`). The arrival-match design supports this trivially as future work — add a `when` field to `BreakpointFilter`.
- Step-into / step-over / step-out (turing-machine-js#102). Adjacent design space; the `arrivalPath` primitive here is useful infrastructure for that work, but the step-debugger surface itself is an engine concern, not a PostMachine concern.
- Engine v7 peer-bump (post-machine-js v7.0.0 territory; `withOverrodeHaltState` rename, paren-composite wrapper names).
- Tracepoints (log without pausing). The `onBreakpoint` callback can implement tracepoints in user code today (log and return immediately); no API change needed.

## Validation against the issues

- **#59** acceptance — `pm.setBreakpoint(20, { before: true })`, `pm.setBreakpoint('rightToBlank', 2, { after: '*' })`, `pm.clearBreakpoints()`: Covered. `setBreakpoint('20', { before: true })` for top-level instructions; `setBreakpoint('rightToBlank::2', { after: '*' })` for subroutine instructions; `clearBreakpoints()` for batch clear.
- **#63** acceptance — path-based `machine.stateAt({ ... })`: Covered. Both string and object forms accepted via the union-typed Path.
- **#70** acceptance — `MachineState` carries instruction context: Covered via `WrappedMachineState.arrivalPath` (canonical) + `candidatePaths` (informational). The `candidateInstructions: number[]` sketch in #70's body is generalized to `candidatePaths: Path[]` to handle subroutines and groups uniformly.
