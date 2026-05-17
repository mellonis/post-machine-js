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

Malformed objects/strings throw at the API entry. Well-formed paths that don't resolve in the current machine (e.g., `pm.stateAt({ instructionIndex: 999 })` when no such instruction exists) also throw — see the `#63` section's edge-case table for the full list. For exception-free probing, use the paired `hasState(path)` query.

## #70: MachineState extension (primitive)

The `MachineState` type re-exported from `@post-machine-js/machine` is extended with two PostMachine-flavored fields. The engine's `MachineState` continues to be re-exported under the same name, but with the extension applied. Consumers importing `MachineState` from `@post-machine-js/machine` get the extended shape; those importing from `@turing-machine-js/machine` directly get the bare engine shape.

### Type

```ts
// In packages/machine/src/index.ts
import type { MachineState as EngineMachineState } from '@turing-machine-js/machine';

export type MachineState = EngineMachineState & {
  arrivalPath: Path;       // canonical: the just-traversed reference's instruction path
  candidatePaths: Path[];  // informational: all paths whose reference points at this State
};
```

Consumer usage:

```ts
// Get the extended type via the post-machine-js re-export:
import { MachineState, PostMachine, parsePath } from '@post-machine-js/machine';

const m: MachineState = /* from onStep/onPause */;
m.arrivalPath;       // available
m.candidatePaths;    // available
m.state;             // also available (inherited from EngineMachineState)

// If a consumer also needs the bare engine type alongside, they alias one of the imports:
import type { MachineState as EngineMachineState } from '@turing-machine-js/machine';
```

- **`arrivalPath`** disambiguates state sharing at runtime. When two instructions share a State via hash dedup, the engine's State is the same object — but the *reference* the engine just followed identifies which instruction the user logically arrived at. `arrivalPath` is built from that reference's instruction index.
  - **First-step convention.** No transition has happened before the first step, so there's no "followed reference". For the first step, `arrivalPath` is the path of the entry instruction — the one whose reference is bound to `initialState` (e.g., for a program starting with instruction 10, `arrivalPath = parsePath('10')` on the first step).
- **`candidatePaths`** is the static fanout: the set of all paths whose references resolve to the current State. Useful for debug-UI visualization ("this state corresponds to instructions 10, 20, and 30 of subroutine foo"). For un-shared states this list has exactly one entry; for shared states it has 2+.
  - **Ordering.** The list is sorted deterministically: scope (lexicographic on the dotted form, with empty/top-level first), then `instructionIndex` (numeric ascending), then `groupInstructionIndex` (numeric ascending, with `undefined` before any number). This makes test assertions and Mermaid output stable across runs.

### Implementation

PostMachine maintains a `state → Path[]` reverse map built at construction time (inverse of `references[]`). The map is finalized after `#buildInitialState` returns.

At runtime, PostMachine wraps the engine's callbacks:

- `onStep(upstreamMachineState)` is intercepted. PostMachine tracks the previous State (the one whose outgoing edge brought control here). The reference that was followed determines `arrivalPath`. The reverse-map lookup yields `candidatePaths`. The wrapper constructs `MachineState` and forwards to the user's callback.
- `onPause` likewise wrapped.

**Tracking the previous State:** PostMachine's wrapper keeps a single mutable reference (the "last seen State") between callback invocations. The engine guarantees `onStep` is called once per applied transition; the wrapper records the State at each fire, so at fire N+1 it knows the State at fire N. The "edge followed" is derived from the predecessor's `#symbolToDataMap` lookup of the symbol that matched (already available in the engine's internal step). For the *first* step, `arrivalPath` follows the first-step convention defined above (the path of the entry instruction whose reference is bound to `initialState`).

### Runtime API change

`pm.run()` and `pm.runStepByStep()` callback signatures continue to advertise `MachineState`, but the type now resolves to the extended shape (because PostMachine's re-export overrides the engine's). Existing consumers reading `state`, `tape`, etc. are unaffected — the new fields are additive. Consumers who explicitly imported `MachineState` from `@turing-machine-js/machine` will now see a type mismatch at the boundary and should switch to the `@post-machine-js/machine` re-export (or alias the engine import).

## #59: Per-instruction breakpoints

PostMachine registers breakpoints by Path with metadata. At runtime, the engine pauses on the shared underlying State; PostMachine's wrapper consults the registry and decides whether to surface the pause to the user's `onPause` callback.

The callback is named `onPause`, not `onBreakpoint` — per the lesson from [Three Majors, Two Mistakes](https://mellonis.ru/articles/three-majors-two-mistakes) (the post-mortem of engine v4→v5), naming a pause-hook for the debugger use case ("break") leaks that framing into every consumer (replay UIs, animation tweens, step-through visualizers — all are "pausing", not "debugging"). The same hook serves all of them.

### API

```ts
type BreakpointFilter = {
  before?: boolean | string | string[];   // pause before iteration; symbol filter optional
  after?: boolean | string | string[];    // pause after iteration; symbol filter optional
};

type BreakpointTarget = Path | string | State;   // State accepted only for haltState

type Breakpoint =
  | { kind: 'instruction'; path: Path; filter: BreakpointFilter }
  | { kind: 'halt'; filter: BreakpointFilter };

pm.setBreakpoint(target: BreakpointTarget, filter: BreakpointFilter): void;
pm.clearBreakpoint(target: BreakpointTarget): void;
pm.clearBreakpoints(): void;
pm.listBreakpoints(): Breakpoint[];

pm.run({
  onStep?: (machineState: MachineState) => void;
  onPause?: (machineState: MachineState) => void | Promise<void>;
  stepsLimit?: number;
});
```

Two callbacks, two concepts:

- `onStep` — fires every step (existing behavior).
- `onPause(machineState)` — fires when the engine pauses. PostMachine's wrapper applies registry-aware filtering before dispatching (see "Pause-wrapper semantics" below).

### Breakpoint targets — paths and haltState

`setBreakpoint` accepts three forms of target:

- **Path string** (e.g., `'foo::10.2'`) — parsed via `parsePath` to an instruction path.
- **Path object** (e.g., `{ scope: 'foo', instructionIndex: 10, groupInstructionIndex: 2 }`) — validated as an instruction path.
- **`haltState` singleton** — either the wrapped re-export from `@post-machine-js/machine` or the bare engine singleton from `@turing-machine-js/machine`. Either form resolves to the same underlying engine haltState; PostMachine sets `haltState.debug` on the engine's singleton.

For the haltState case, `listBreakpoints` returns entries with `kind: 'halt'`. For instruction targets, entries have `kind: 'instruction'` plus the canonical `Path`. The `arrivalPath` field of `MachineState` is the instruction path that just transitioned; for a halt-pause it's the path of the instruction whose transition led to halt (the last user-meaningful path before the engine's halt entry).

`setBreakpoint(haltState, filter)` is the structured channel for the `haltState.debug.before = true` pattern. Direct `haltState.debug` mutation on the wrapped re-export throws with an instructional error pointing at `setBreakpoint`; direct mutation on the bare engine singleton (imported from `@turing-machine-js/machine`) is a documented escape — see "Lockdown scope and residual escape hatches" below.

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
| `S ∈ registeredStates` AND a registered breakpoint matches `arrivalPath` (and the filter accepts the current symbol/phase) | Fire `onPause(machineState)`               |
| `S ∈ registeredStates` AND no registered breakpoint matches arrival   | Silent resume — engine paused due to a sibling instruction's breakpoint sharing this state; this arrival isn't the one the user asked for |
| `S ∉ registeredStates` (runtime channel: user mutated `state.debug` via `machineState.state` inside `onStep`/`onPause`) | Fire `onPause` (raw passthrough — runtime mutation is an intentional escape hatch, not blocked by the registry) |

`pm.stateAt` is **not** a source of `state.debug` mutation — it returns a Proxy that blocks the setter (see "Channeling debug config through `setBreakpoint`" below). Only the runtime channel (`machineState.state` inside callbacks) exposes the raw setter; reaching for it is an explicit opt-out of the registry-aware path, intentionally available for advanced runtime introspection.

The contract is single-channeled for **construction-time** management (`setBreakpoint` only) and dual-channeled for **runtime** dispatch:

- **Construction-time contract:** `setBreakpoint(path)` is the only way to enable `state.debug` for a given State. Returns from `pm.stateAt(path)` are read-only with respect to `debug`. State-sharing is hidden behind the registry's arrival-aware filter.
- **Runtime contract:** code inside `onStep`/`onPause` can mutate `machineState.state.debug` directly (e.g., "after I see the third mark, enable break"). Pauses on such runtime-enabled States fire `onPause` unfiltered, because no registry entry exists for them.

The same `onPause` callback serves both contracts. From the consumer's perspective, the callback fires when the engine pauses and reports the arrival via `MachineState`; how they got there is composable in user code (`if (registeredBreakpoints.match(m.arrivalPath)) { ... } else { /* runtime-enabled pause */ }`).

`onPause` is awaited; PostMachine's wrapper awaits the user callback before returning control to the engine.

### Channeling debug config through `setBreakpoint`

Every State PostMachine exposes through its public surface is wrapped in a `Proxy<State>` that blocks `debug`-related mutations. This funnels all construction-time debug-config requests through `setBreakpoint`, which keeps the registry as the authoritative source of state-sharing-aware filtering.

Surfaces that return wrapped States:

- `pm.stateAt(path)`.
- `pm.initialState` getter.
- The `haltState` re-export from `@post-machine-js/machine` (wrapped at module load).

Two-layer Proxy mechanism:

1. **State Proxy.** The outer Proxy wraps the engine's `State` object. All reads forward to the underlying State via `Reflect.get`. The `set` trap throws on the `debug` key with an instructional message:

    ```ts
    set(target, prop, value) {
      if (prop === 'debug') {
        throw new Error(
          'Use pm.setBreakpoint(target, filter) to enable breakpoints. '
          + 'Direct state.debug assignment is disabled on objects returned by PostMachine.'
        );
      }
      return Reflect.set(target, prop, value);
    }
    ```

2. **DebugConfig Proxy.** The State Proxy's `get` trap intercepts reads of the `debug` key. Instead of returning the engine's raw `DebugConfig` instance, it returns a `Proxy<DebugConfig>` whose `set` trap throws on `before`/`after`/any field assignment with the same instructional message. Reads forward to the underlying DebugConfig (so consumers can introspect "what filter is set?"). This catches the chained `state.debug.before = true` pattern.

Cache: **per-PostMachine-instance**, not module-level — with one exception (haltState). Each `PostMachine` maintains its own `Map<State, Proxy<State>>` (and an inner `Map<DebugConfig, Proxy<DebugConfig>>` lazily). Cache key is the underlying engine object, so identity holds within an instance. GC follows the PostMachine lifecycle. Rationale: each PostMachine constructs its own state graph; scoping the cache to that instance matches lifetime expectations and avoids unbounded module-level growth across many machines.

**Exception — the `haltState` re-export wrap is module-level.** `haltState` is the engine's singleton (shared across all PostMachine instances by definition); the wrapped Proxy is created once at module load (`packages/machine/src/index.ts`) and reused everywhere. `pm.setBreakpoint(haltState, ...)` accepts either the module-level wrap or the bare upstream singleton — PostMachine resolves both to the engine's bare haltState before recording in its per-instance registry, and sets `debug` on the bare singleton.

```ts
pm.stateAt('10') === pm.stateAt('20')   // true when 10 and 20 share a State (cache returns same Proxy)
pm.stateAt('10') instanceof State        // true (Proxy preserves prototype chain)
State.toGraph(pm.stateAt('10'), pm.tapeBlock)  // works (engine sees a State-shaped object)
pm.initialState === pm.stateAt(<entry-instruction-path>)  // true (both routes hit the cache)
```

The `haltState` re-export from `@post-machine-js/machine` is its own special-case wrap built at module load:

```ts
// In packages/machine/src/index.ts
import { haltState as engineHaltState } from '@turing-machine-js/machine';
export const haltState = wrapStateForLockdown(engineHaltState);   // Proxy<State>
```

The wrapped `haltState` has the same protections; `pm.setBreakpoint` accepts either the wrapped or the bare engine singleton (both resolve to `engineHaltState` internally — see "Breakpoint targets" section).

### Lockdown scope and residual escape hatches

The Proxy wrapping covers PostMachine's *managed* surface for construction-time debug-config. Three escape hatches remain documented and accessible:

| Hatch                                                                  | What it does                                          | Why it's not locked                                                            |
|------------------------------------------------------------------------|-------------------------------------------------------|--------------------------------------------------------------------------------|
| `machineState.state.debug = ...` inside `onStep`/`onPause` callbacks   | Runtime mutation of debug-config on a live state      | Intentional runtime channel — advanced use cases (conditional enable mid-run) need it; locking would over-reach. |
| `import { haltState } from '@turing-machine-js/machine'` (bare upstream) | Bypass the wrapped post-machine-js re-export        | We can't lock another package's export. Documented; structurally identical to the wrapped one for identity-sensitive checks (`State.isHalt` uses ID, not identity). |
| Graph-walking via `someState.getNextStateForSymbol(...)`, `someState.symbolToDataMap` introspection | Reach transition-target States that aren't Proxied | Recursive Proxy wrapping (every method that returns a State returns another Proxy) is achievable but adds runtime overhead and edge-case complexity. Deferred to a follow-up — tracked in [#72](https://github.com/mellonis/post-machine-js/issues/72). v6.2/v6.3 documents this as an explicit raw channel; closing it is v8-era work alongside the `when`-predicate reshape. |

**Identity break for `haltState`.** Because the wrapped re-export is a Proxy, `haltState` (from `@post-machine-js/machine`) is **not** `===` to `haltState` (from `@turing-machine-js/machine`). Identity-sensitive code that imports from both packages and expects them to be the same singleton will break. Mitigations:

- Most identity checks in user code should use `State.isHalt` (which reads `.id === 0`) — works through the Proxy because reads pass through to the underlying.
- `pm.setBreakpoint(haltState, ...)` accepts *either* the wrapped or the bare singleton — PostMachine resolves both to the underlying engine haltState internally before setting `.debug`.
- Documentation note: "prefer importing `haltState` from `@post-machine-js/machine` when using PostMachine; the wrapped re-export is the supported singleton".

## #63: Static path resolver

Pure construction-time path-to-State lookup. Independent of runtime behavior.

### API

```ts
pm.stateAt(path: Path | string): State;            // throws if path is invalid OR doesn't resolve; returned object is a Proxy<State>
pm.hasState(path: Path | string): boolean;          // existence probe, never throws
pm.candidatesFor(path: Path | string): Path[];      // throws if path is invalid OR doesn't resolve
```

- **`stateAt('10')`** returns a `Proxy<State>` wrapping the underlying engine State (which may be shared with other instructions via the hash dedup). The Proxy delegates all reads but blocks `debug`-related writes — see the "Channeling debug config through `setBreakpoint`" section in #59 for the two-layer Proxy mechanism. From the consumer's perspective the returned object satisfies `instanceof State` and is usable with `State.toGraph` and other engine utilities; only the `state.debug = ...` (and `state.debug.before = ...`) write paths are blocked, with an error pointing at `pm.setBreakpoint`. Throws for malformed paths AND for well-formed-but-unresolved paths (e.g., `'999'` when no such instruction). Matches PostMachine's idiom: the engine itself throws `'invalid next instruction index'`, `'undefined subroutine'`, etc., on construction-time misuse — `stateAt` follows the same pattern for query-time misuse.
- **`hasState('10')`** is the existence probe. Returns `true` if the path resolves; `false` for everything else (malformed paths, well-formed-but-unresolved paths, anything that would make `stateAt` throw). Implementation is a trivial try/catch wrapper on `stateAt`. Use this when validating user input in a debugger UI without exception handling.
- **`candidatesFor('10')`** returns all paths whose references resolve to the same State. For un-shared states: `['10']` (single-element). For shared states: e.g., `['10', '20', '30']`. Same shape as `MachineState.candidatePaths` but computed statically from a Path input. Throws on invalid/unresolved paths (same as `stateAt`).

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
| `pm.stateAt('20').debug = { before: true }` (caller error) | (never reaches engine — blocked at Proxy)               | Throws with instructional error pointing at `pm.setBreakpoint`                    |
| `pm.stateAt('20').debug.before = true` (caller error)      | (never reaches engine — blocked at DebugConfig Proxy)   | Throws with instructional error pointing at `pm.setBreakpoint`                    |
| `pm.initialState.debug = { before: true }` (caller error)  | (never reaches engine — blocked at Proxy)               | Throws with instructional error pointing at `pm.setBreakpoint`                    |
| `haltState.debug = { before: true }` where `haltState` is from `@post-machine-js/machine` | (never reaches engine — blocked at Proxy)               | Throws with instructional error pointing at `pm.setBreakpoint(haltState, ...)`    |
| `pm.setBreakpoint(haltState, { before: true })` (either wrapped or bare singleton) | `haltState.debug.before = true` set on the engine singleton | Registered halt breakpoint; `onPause` fires on engine's halt entry              |
| Inside `onPause`: `machineState.state.debug = { before: true }` (runtime channel) | Engine pauses on every subsequent visit | State not in registry → raw passthrough; `onPause` fires unfiltered for those visits |
| `pm.stateAt('10') === pm.stateAt('20')`                    | `true` (same physical State)                            | (Proxy cache returns the same wrapped object)                                     |
| `MachineState.arrivalPath`                          | (engine doesn't track this)                             | Always the just-followed reference's path                                         |
| `MachineState.candidatePaths`                       | (engine doesn't track this)                             | `['10', '20']` for shared, `['30']` for un-shared                                 |

## Public API summary

New / modified exports from `@post-machine-js/machine`:

- Type `Path` (new).
- Type `MachineState` (modified — re-export now resolves to the engine's `MachineState` extended with `arrivalPath` + `candidatePaths`).
- Type `BreakpointFilter` (new).
- Type `BreakpointTarget` (new — `Path | string | State` where `State` is accepted only for the haltState singleton).
- Type `Breakpoint` (new — discriminated union: `{ kind: 'instruction'; path; filter }` or `{ kind: 'halt'; filter }`).
- Function `parsePath(s: string): Path` (new).
- Function `formatPath(p: Path): string` (new).
- `haltState` (modified — re-export now resolves to a `Proxy<State>` that blocks `debug`-related mutations; identity-breaks from the bare upstream import — see "Lockdown scope" section).

New methods on `PostMachine`:

- `setBreakpoint(target, filter)` — `target` is `Path | string | State` (the State form accepted only for `haltState`).
- `clearBreakpoint(target)`.
- `clearBreakpoints()`.
- `listBreakpoints()`.
- `stateAt(path)`.
- `hasState(path)`.
- `candidatesFor(path)`.

Modified methods on `PostMachine`:

- `run(opts)` — callback signatures receive `MachineState`; rename `__onPause` → `onPause` (drop experimental prefix). Semantics extend the existing `__onPause` with registry-aware filtering: pauses on registered States are filtered by arrival match; pauses on non-registered States (raw `state.debug`) pass through unchanged. Existing `__onPause` consumers see no behavior change after the rename — their states aren't in any registry.
- `runStepByStep(opts)` — yields `MachineState`.
- `initialState` getter (modified — now returns a `Proxy<State>` from the lockdown cache; `pm.initialState === pm.stateAt(<entry-instruction-path>)` after this change).

## Release shape

Land in dependency order:

1. **#70 first** — primitive layer. Smaller change. Enables #59 and (informationally) #63's `candidatesFor`.
   - Breaking: callback signatures yield `MachineState`. Existing readers of `state`/`tape` unaffected; only the field-added shape changes.
   - Rename `__onPause` → `onPause` (drop experimental prefix). Migration: simple find/replace.
   - Suggested version: **v6.2.0** (minor — additive on a runtime-visible callback shape).

2. **#59 + #63 in parallel** — both built on #70's primitive.
   - #59: new breakpoint registry + filter aggregation + arrival-match logic inside the existing `onPause` callback wrapper. No new callback added — `onPause` gains registry-aware semantics on top of the rename from `__onPause`.
   - #63: new `stateAt`, `hasState`, `candidatesFor` methods.
   - These don't conflict structurally and can land as separate PRs.
   - Bundled as a single **v6.3.0** release. Rationale: the Proxy mechanism's error message points at `setBreakpoint`, so the two issues need to ship together for the lockdown story to be coherent. Splitting them would mean touching `index.ts`, `PostMachine.ts`, and the shared helper module twice for no consumer benefit.

3. **README "Naming convention" section** updated to reference the new API: the "State sharing" subsection's last sentence ("use the engine's Reference resolution") gets replaced with concrete references to `candidatesFor` and `arrivalPath`.

4. **CHANGELOG entries** for each release with cross-references to the issues closed.

## Out of scope

- Conditional breakpoints with predicates. The arrival-match design supports this as a future extension. Concrete v8 shape sketch:
  - Simplify `before`/`after` from `boolean | string | string[]` to just `boolean` (drop the symbol-filter union).
  - Add a general `when: (machineState: MachineState) => boolean` predicate that subsumes symbol filtering and adds arbitrary conditions (tape position, iteration count, head value, anything else `machineState` exposes).
  - PostMachine's `BreakpointFilter` shape can diverge from the engine's `DebugConfig` shape at that point — the engine still needs `before`/`after` as `boolean | string | string[]` for its low-level interface, but PostMachine wraps it. The pause-wrapper layer evaluates `when` against the wrapped state; the engine layer keeps its current shape.
  - This is a v8 (post-machine-js) breaking change. v6.2/v6.3 ships the mirrored shape as-is for compatibility; v8 reshapes the predicate API once PostMachine's surface has earned independence from the engine's.
- Step-into / step-over / step-out (turing-machine-js#102). Adjacent design space; the `arrivalPath` primitive here is useful infrastructure for that work, but the step-debugger surface itself is an engine concern, not a PostMachine concern.
- Engine v7 peer-bump (post-machine-js v7.0.0 territory; `withOverrodeHaltState` rename, paren-composite wrapper names).
- Tracepoints (log without pausing). The `onPause` callback can implement tracepoints in user code today (log and return immediately); no API change needed.

## Validation against the issues

- **#59** acceptance — `pm.setBreakpoint(20, { before: true })`, `pm.setBreakpoint('rightToBlank', 2, { after: '*' })`, `pm.clearBreakpoints()`: Covered. `setBreakpoint('20', { before: true })` for top-level instructions; `setBreakpoint('rightToBlank::2', { after: '*' })` for subroutine instructions; `clearBreakpoints()` for batch clear.
- **#63** acceptance — path-based `machine.stateAt({ ... })`: Covered. Both string and object forms accepted via the union-typed Path.
- **#70** acceptance — `MachineState` carries instruction context: Covered via `MachineState.arrivalPath` (canonical) + `candidatePaths` (informational). The `candidateInstructions: number[]` sketch in #70's body is generalized to `candidatePaths: Path[]` to handle subroutines and groups uniformly.
