# Instruction Debugger Lockdown — v6.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add construction-time path-to-state resolution ([#63](https://github.com/mellonis/post-machine-js/issues/63)) and per-instruction breakpoints ([#59](https://github.com/mellonis/post-machine-js/issues/59)) to `PostMachine`, wired through a two-layer Proxy lockdown that funnels every construction-time `state.debug` change through `pm.setBreakpoint`. Builds atop the v6.2.0 primitives merged in [PR #73](https://github.com/mellonis/post-machine-js/pull/73).

**Architecture:** A new `lockdown.ts` module owns the two-layer `Proxy<State>` + per-instance cache used by `pm.stateAt`, `pm.initialState`, and the module-level `haltState` re-export. A new `breakpoints.ts` module owns the `Breakpoint*` types plus filter-aggregation and target-normalization helpers. `PostMachine` gains a path→state forward map (the inverse of the existing `#stateToCandidatePaths`), the resolver trio (`stateAt` / `hasState` / `candidatesFor`), the registry quartet (`setBreakpoint` / `clearBreakpoint` / `clearBreakpoints` / `listBreakpoints`), and a registry-aware filter on top of the existing `onPause` wrapper. `index.ts` wraps the engine's `haltState` once at module load and exports the new types.

**Tech Stack:** TypeScript strict, Vitest, `@turing-machine-js/machine` ^6.0.0 (peer dep). All sources import bare specifiers; vitest aliases resolve to source.

**Spec reference:** `docs/superpowers/specs/2026-05-17-instruction-debugger-design.md` @ master.

**Branch:** `feat/issue-59-63-debugger-lockdown`. PR target: `master` (branch-protected, 2 required checks).

---

## File Structure

**New files:**

- `packages/machine/src/lockdown.ts` — `wrapStateForLockdown(state, cache)`, per-instance and module-level cache support, the two-layer `Proxy<State>` and `Proxy<DebugConfig>` traps with the instructional error message.
- `packages/machine/src/breakpoints.ts` — `BreakpointFilter`, `BreakpointTarget`, `Breakpoint` types; `mergeBreakpointFilters(filters)` to compute the union assigned to `state.debug`; `validateBreakpointFilter(filter)` for the "neither before nor after" rejection.
- `packages/machine/test/lockdown.spec.ts` — Proxy mechanics: setter rejection on both levels, prototype/`instanceof` preservation, cache identity, reads-pass-through.
- `packages/machine/test/state-at.spec.ts` — #63 resolver: string + object forms, edge cases, identity with `initialState`, `candidatesFor` shape.
- `packages/machine/test/breakpoints.spec.ts` — #59 registry: add/clear/list, filter union on shared States, halt breakpoints (both wrapped and bare singleton), arrival-aware gating in `onPause`.

**Modified files:**

- `packages/machine/src/classes/PostMachine.ts` — add `#pathToState: Map<string, State>` reverse map and `#breakpoints: Breakpoint[]` registry; add public methods (resolver trio + registry quartet); modify `initialState` getter to return cached Proxy; gate the existing `onPause` wrapper through the registry.
- `packages/machine/src/index.ts` — wrap `haltState` at module load via the lockdown module-level cache; export `BreakpointFilter`, `BreakpointTarget`, `Breakpoint`.
- `packages/machine/test/debugger.spec.ts` — migrate two cases that currently do `machine.initialState.debug = { before: true }` (lines 88, 112) to use `pm.setBreakpoint`; that direct write is the exact pattern the lockdown now blocks.
- `packages/machine/test/examples.spec.ts` — mirror new README examples verbatim.
- `packages/machine/README.md` — new "Path-based resolver", "Breakpoints", and "Lockdown semantics" sections; update the "State sharing" subsection to reference `candidatesFor` and `arrivalPath`.
- `packages/machine/CHANGELOG.md` — v6.3.0 entry with `2026-MM-DD` date placeholder.

`packages/machine/package.json` is **not** modified in this PR — the version bump (6.2.0 → 6.3.0) lands on a separate `v6-3-0` branch after merge, matching the project's release pattern.

---

## Tasks

### Task 1: Path → State reverse map (private plumbing)

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Test: covered via Task 3+ (no direct API yet — verify in Task 3)

- [ ] **Step 1: Branch from updated master**

```bash
git fetch origin master
git checkout master
git pull --ff-only
git checkout -b feat/issue-59-63-debugger-lockdown
```

- [ ] **Step 2: Add the reverse map field and population**

In `packages/machine/src/classes/PostMachine.ts`:

Add a field next to the existing two maps (line ~37):

```ts
  #pathToState: Map<string, State> = new Map();
```

In `#recordPath(state, path)` (line ~393), populate the reverse map alongside the existing `#stateToCandidatePaths` update. Import `formatPath` from `../path` at the top of the file:

```ts
import { type Path, comparePathsCanonically, formatPath } from '../path';
```

Update `#recordPath`:

```ts
  #recordPath(state: State, path: Path): void {
    const existing = this.#stateToCandidatePaths.get(state);
    if (existing) {
      existing.push(path);
    } else {
      this.#stateToCandidatePaths.set(state, [path]);
    }
    this.#pathToState.set(formatPath(path), state);
  }
```

- [ ] **Step 3: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all existing tests pass (the field is private and only written to; nothing reads it yet).

- [ ] **Step 4: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts
git commit -m "Add #pathToState reverse map to PostMachine"
```

---

### Task 2: `lockdown.ts` — two-layer Proxy helper

**Files:**
- Create: `packages/machine/src/lockdown.ts`
- Create: `packages/machine/test/lockdown.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/machine/test/lockdown.spec.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { State, ifOtherSymbol, haltState } from '@turing-machine-js/machine';
import { wrapStateForLockdown } from '../src/lockdown';

describe('wrapStateForLockdown', () => {
  function makeState(): State {
    return new State({ [ifOtherSymbol]: { nextState: haltState } }, 'test-state');
  }

  test('reads pass through to the underlying State', () => {
    const s = makeState();
    const cache = new Map<State, State>();
    const wrapped = wrapStateForLockdown(s, cache);
    expect(wrapped.name).toBe('test-state');
    expect(wrapped.id).toBe(s.id);
  });

  test('preserves instanceof State', () => {
    const s = makeState();
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(wrapped).toBeInstanceOf(State);
  });

  test('cache returns the same Proxy for the same underlying State', () => {
    const s = makeState();
    const cache = new Map<State, State>();
    const w1 = wrapStateForLockdown(s, cache);
    const w2 = wrapStateForLockdown(s, cache);
    expect(w1).toBe(w2);
  });

  test('setting .debug throws with instructional error', () => {
    const wrapped = wrapStateForLockdown(makeState(), new Map());
    expect(() => {
      (wrapped as unknown as { debug: unknown }).debug = { before: true };
    }).toThrow(/setBreakpoint/);
  });

  test('setting .debug.before throws with instructional error', () => {
    const wrapped = wrapStateForLockdown(makeState(), new Map());
    expect(() => {
      (wrapped.debug as unknown as { before: boolean }).before = true;
    }).toThrow(/setBreakpoint/);
  });

  test('setting .debug.after throws with instructional error', () => {
    const wrapped = wrapStateForLockdown(makeState(), new Map());
    expect(() => {
      (wrapped.debug as unknown as { after: boolean }).after = true;
    }).toThrow(/setBreakpoint/);
  });

  test('reading .debug returns a Proxy that allows reads', () => {
    const s = makeState();
    s.debug = { before: true };
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(wrapped.debug?.before).toBe(true);
  });

  test('reading .debug returns null when underlying debug is null', () => {
    // Covers the falsy branch of the get trap's `value && typeof value === 'object'` guard,
    // which the breakpoints suite exercises only indirectly.
    const wrapped = wrapStateForLockdown(makeState(), new Map());
    expect(wrapped.debug).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/lockdown.spec.ts`
Expected: FAIL — `wrapStateForLockdown` is not defined.

- [ ] **Step 3: Implement `lockdown.ts`**

> **Engine compat note (verified 2026-05-18 against installed `@turing-machine-js/machine` v6):** the upstream `State` class does **not** use ECMAScript private fields (`#name`, `#id`, etc.), so `Reflect.get(target, prop, receiver)` is safe — getter/method invocations with `this = proxy` succeed. If a future engine release introduces private fields, this helper must change to drop `receiver` and bind functions to `target` (`if (typeof value === 'function') return value.bind(target)`); the lockdown.spec.ts `name`/`id` tests will catch the regression.

Create `packages/machine/src/lockdown.ts`:

```ts
import type { State } from '@turing-machine-js/machine';

const LOCKDOWN_ERROR =
  'Use pm.setBreakpoint(target, filter) to enable breakpoints. '
  + 'Direct state.debug assignment is disabled on objects returned by PostMachine.';

function wrapDebugConfig<T extends object>(target: T): T {
  return new Proxy(target, {
    set() {
      throw new Error(LOCKDOWN_ERROR);
    },
  });
}

export function wrapStateForLockdown(
  state: State,
  cache: Map<State, State>,
): State {
  const cached = cache.get(state);
  if (cached) return cached;

  const debugCache = new WeakMap<object, object>();

  const wrapped = new Proxy(state, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'debug' && value && typeof value === 'object') {
        const existing = debugCache.get(value);
        if (existing) return existing;
        const dbgProxy = wrapDebugConfig(value);
        debugCache.set(value, dbgProxy);
        return dbgProxy;
      }
      return value;
    },
    set(target, prop, value, receiver) {
      if (prop === 'debug') {
        throw new Error(LOCKDOWN_ERROR);
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });

  cache.set(state, wrapped);
  return wrapped;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/lockdown.spec.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Run the full suite — confirm no regression**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/lockdown.ts packages/machine/test/lockdown.spec.ts
git commit -m "Add lockdown.ts — two-layer Proxy helper for State debug-config"
```

---

### Task 3: `pm.stateAt(path)` — path-based resolver returning wrapped Proxy

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Create: `packages/machine/test/state-at.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/machine/test/state-at.spec.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  PostMachine,
  State,
  check, mark, right, stop,
} from '../src/index';

describe('pm.stateAt — happy paths', () => {
  test('top-level instruction by string', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    const s = pm.stateAt('10');
    expect(s).toBeInstanceOf(State);
    expect(s.name).toBe('10');
  });

  test('top-level instruction by object', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    const s = pm.stateAt({ instructionIndex: 10 });
    expect(s.name).toBe('10');
  });

  test('subroutine instruction by string', () => {
    const pm = new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: stop,
      sub: { 1: mark, 2: stop },
    });
    const s = pm.stateAt('sub::1');
    expect(s.name).toBe('sub::1');
  });

  test('subroutine instruction by object with scope string', () => {
    const pm = new PostMachine({
      10: stop,
      sub: { 1: mark, 2: stop },
    });
    const s = pm.stateAt({ scope: 'sub', instructionIndex: 1 });
    expect(s.name).toBe('sub::1');
  });

  test('subroutine instruction by object with scope array', () => {
    const pm = new PostMachine({
      10: stop,
      sub: { 1: mark, 2: stop },
    });
    const s = pm.stateAt({ scope: ['sub'], instructionIndex: 1 });
    expect(s.name).toBe('sub::1');
  });
});

describe('pm.stateAt — wrapped Proxy semantics', () => {
  test('returned object satisfies instanceof State', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.stateAt('10')).toBeInstanceOf(State);
  });

  test('debug write throws with instructional error', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => {
      pm.stateAt('10').debug = { before: true };
    }).toThrow(/setBreakpoint/);
  });

  test('cache returns same Proxy across calls', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.stateAt('10')).toBe(pm.stateAt('10'));
  });

  test('shared-state paths return same Proxy', () => {
    // 10 and 30 share a State via hash dedup (both are `mark` with the same next).
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    expect(pm.stateAt('10')).toBe(pm.stateAt('30'));
  });
});

describe('pm.stateAt — rejections', () => {
  test('unresolved top-level instruction throws', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('999')).toThrow(/unknown instruction|does not resolve/i);
  });

  test('unknown subroutine throws', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('foo::1')).toThrow(/unknown subroutine|does not resolve/i);
  });

  test("'halt' is rejected (not an instruction path)", () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('halt')).toThrow(/halt|not an instruction path/i);
  });

  test('wrapper composite (contains >) is rejected', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('foo>10~20')).toThrow();
  });

  test('continuation state (contains ~) is rejected', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('10~30')).toThrow();
  });

  test('zero instruction index is rejected by parsePath', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt({ instructionIndex: 0 })).toThrow(/positive integer/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/state-at.spec.ts`
Expected: FAIL — `pm.stateAt is not a function`.

- [ ] **Step 3: Implement `pm.stateAt` in PostMachine.ts**

In `packages/machine/src/classes/PostMachine.ts`:

Add the lockdown cache field next to the existing maps:

```ts
  #stateProxyCache: Map<State, State> = new Map();
```

Add the import at the top:

```ts
import { wrapStateForLockdown } from '../lockdown';
import { type Path, comparePathsCanonically, formatPath, parsePath } from '../path';
```

Add a private helper to resolve a `Path | string` input to a canonical path string + underlying State, throwing on invalid/unresolved input:

```ts
  #resolveToState(target: Path | string): { path: Path; state: State } {
    const parsed: Path = typeof target === 'string'
      ? parsePath(target)
      : this.#validatePathObject(target);
    const key = formatPath(parsed);
    const state = this.#pathToState.get(key);
    if (!state) {
      throw new Error(`path '${key}' does not resolve in this machine`);
    }
    return { path: parsed, state };
  }

  #validatePathObject(p: Path): Path {
    if (!Number.isInteger(p.instructionIndex) || p.instructionIndex < 1) {
      throw new Error(`invalid path: instructionIndex must be a positive integer, got ${p.instructionIndex}`);
    }
    if (p.groupInstructionIndex !== undefined
      && (!Number.isInteger(p.groupInstructionIndex) || p.groupInstructionIndex < 1)) {
      throw new Error(`invalid path: groupInstructionIndex must be a positive integer, got ${p.groupInstructionIndex}`);
    }
    if (p.scope !== undefined) {
      const segs = typeof p.scope === 'string' ? p.scope.split('::') : p.scope;
      for (const s of segs) {
        if (!subroutineNameValidator(s)) {
          throw new Error(`invalid path: scope segment '${s}' is not a valid subroutine name`);
        }
      }
    }
    // Canonicalize so the registry/listBreakpoints output is shape-stable
    // regardless of whether the caller passed a string or an object form,
    // and regardless of whether scope was 'foo::bar' or ['foo', 'bar'].
    return parsePath(formatPath(p));
  }
```

Add the public method:

```ts
  stateAt(target: Path | string): State {
    const { state } = this.#resolveToState(target);
    return wrapStateForLockdown(state, this.#stateProxyCache);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/state-at.spec.ts`
Expected: PASS — all `stateAt` tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/state-at.spec.ts
git commit -m "Add pm.stateAt(path) — wrapped State resolver"
```

---

### Task 4: `pm.hasState` and `pm.candidatesFor`

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Modify: `packages/machine/test/state-at.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `packages/machine/test/state-at.spec.ts`:

```ts
describe('pm.hasState', () => {
  test('returns true for a resolved path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('10')).toBe(true);
  });

  test('returns false for an unresolved well-formed path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('999')).toBe(false);
  });

  test('returns false for a malformed string', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('halt')).toBe(false);
  });

  test('returns false for an unknown subroutine path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('foo::1')).toBe(false);
  });
});

describe('pm.candidatesFor', () => {
  test('un-shared state returns a single-element list', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.candidatesFor('10')).toEqual([{ instructionIndex: 10 }]);
  });

  test('shared state returns all candidates in canonical order', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    expect(pm.candidatesFor('10')).toEqual([
      { instructionIndex: 10 },
      { instructionIndex: 30 },
    ]);
    // Same list regardless of which path you query from.
    expect(pm.candidatesFor('30')).toEqual(pm.candidatesFor('10'));
  });

  test('throws on unresolved path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.candidatesFor('999')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/state-at.spec.ts`
Expected: FAIL — `hasState`/`candidatesFor` not defined.

- [ ] **Step 3: Implement both methods**

In `PostMachine.ts`, add:

```ts
  hasState(target: Path | string): boolean {
    try {
      this.#resolveToState(target);
      return true;
    } catch {
      return false;
    }
  }

  candidatesFor(target: Path | string): Path[] {
    const { state } = this.#resolveToState(target);
    return this.#stateToCandidatePaths.get(state) ?? [];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/state-at.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/state-at.spec.ts
git commit -m "Add pm.hasState and pm.candidatesFor"
```

---

### Task 5: `pm.initialState` returns wrapped Proxy

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Modify: `packages/machine/test/state-at.spec.ts`
- Modify: `packages/machine/test/debugger.spec.ts`

- [ ] **Step 1: Add failing tests for the identity guarantee**

Append to `packages/machine/test/state-at.spec.ts`:

```ts
describe('pm.initialState — wrapped Proxy', () => {
  test('returns a Proxy that blocks debug writes', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => {
      pm.initialState.debug = { before: true };
    }).toThrow(/setBreakpoint/);
  });

  test('initialState identity equals stateAt(<entry-path>)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.initialState).toBe(pm.stateAt('10'));
  });

  test('initialState satisfies instanceof State', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.initialState).toBeInstanceOf(State);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/state-at.spec.ts`
Expected: FAIL — `debug` setter currently succeeds; identity is not preserved.

- [ ] **Step 3: Modify the `initialState` getter to return cached Proxy**

In `PostMachine.ts` (line ~74):

```ts
  get initialState(): State {
    return wrapStateForLockdown(this.#initialState, this.#stateProxyCache);
  }
```

The internal uses of `this.#initialState` inside `run()` and `runStepByStep()` continue to pass the bare State to `super.run()` / `super.runStepByStep()`. Only the public getter wraps.

- [ ] **Step 4: Migrate `debugger.spec.ts` — the two cases that now break**

Two tests in `packages/machine/test/debugger.spec.ts` (lines 88 and 112) do `machine.initialState.debug = { before: true }`. That direct write is exactly what the lockdown blocks. Both must move to the runtime channel via `machineState.state.debug` inside `onStep` (or use a separate pre-Proxy reference), since `pm.setBreakpoint` doesn't exist yet.

**Use the runtime channel:** set `state.debug` inside an `onStep` callback that fires once.

Replace lines 86–93 (the first test):

```ts
    // Attach a `before` breakpoint via the runtime channel: set `state.debug`
    // from inside an onStep callback. The engine's run loop checks state.debug
    // on the next iteration boundary, so the pause fires on the step after the
    // assignment.
    let armed = false;
    const seen: MachineState[] = [];
    await machine.run({
      onStep: (s: MachineState) => {
        if (!armed) {
          s.state.debug = { before: true };
          armed = true;
        }
      },
      onPause: (s) => { seen.push(s); },
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].debugBreak).toEqual({ before: true });
```

Replace lines 110–123 (the second test) similarly:

```ts
    let armed = false;
    let asyncCallbackResolved = false;
    await machine.run({
      onStep: (s: MachineState) => {
        if (!armed) {
          s.state.debug = { before: true };
          armed = true;
        }
      },
      onPause: async () => {
        await new Promise((r) => setTimeout(r, 10));
        asyncCallbackResolved = true;
      },
    });

    expect(asyncCallbackResolved).toBe(true);
```

These tests now exercise the documented runtime-channel escape hatch — exactly what the spec's "Pause-wrapper semantics" table calls out as the `S ∉ registeredStates` case (raw passthrough, no registry).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/state-at.spec.ts packages/machine/test/debugger.spec.ts
git commit -m "Wrap pm.initialState in lockdown Proxy; migrate debugger.spec to runtime channel"
```

---

### Task 6: Wrap `haltState` re-export at module load

**Files:**
- Modify: `packages/machine/src/index.ts`
- Modify: `packages/machine/test/lockdown.spec.ts` (add module-level wrap tests)

- [ ] **Step 1: Add failing tests for the haltState wrap**

Append to `packages/machine/test/lockdown.spec.ts`:

```ts
describe('haltState re-export — module-level wrap', () => {
  test('haltState (from post-machine-js) is a Proxy that blocks debug writes', async () => {
    const { haltState } = await import('../src/index');
    expect(() => {
      (haltState as unknown as { debug: unknown }).debug = { before: true };
    }).toThrow(/setBreakpoint/);
  });

  test('haltState (from post-machine-js) reads pass through', async () => {
    const { haltState: postHalt } = await import('../src/index');
    const { haltState: engineHalt } = await import('@turing-machine-js/machine');
    expect(postHalt.id).toBe(engineHalt.id);
  });

  test('the post-machine-js haltState wrap is a singleton across imports', async () => {
    const { haltState: a } = await import('../src/index');
    const { haltState: b } = await import('../src/index');
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/lockdown.spec.ts`
Expected: FAIL — the current re-export from `index.ts` passes the bare upstream singleton through, so debug writes succeed.

- [ ] **Step 3: Wrap haltState at module load in `index.ts`**

In `packages/machine/src/index.ts`, replace the `haltState` re-export. Current state has no explicit haltState re-export — the engine's `haltState` is reachable via deep import only. Add an explicit wrapped re-export.

Add imports and the module-level cache + wrap at the top:

```ts
import { haltState as engineHaltState, type State } from '@turing-machine-js/machine';
import { wrapStateForLockdown } from './lockdown';

const haltStateCache: Map<State, State> = new Map();
export const haltState = wrapStateForLockdown(engineHaltState, haltStateCache);
```

(`engineHaltState` is the bare upstream singleton — keep that name local; users import the wrapped `haltState` from `@post-machine-js/machine`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/lockdown.spec.ts`
Expected: PASS — all 10 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/index.ts packages/machine/test/lockdown.spec.ts
git commit -m "Wrap haltState re-export at module load via lockdown"
```

---

### Task 7: `breakpoints.ts` — types and helpers

**Files:**
- Create: `packages/machine/src/breakpoints.ts`
- Create: `packages/machine/test/breakpoints.spec.ts` (helpers section)

- [ ] **Step 1: Write the failing tests for the helpers**

Create `packages/machine/test/breakpoints.spec.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  mergeBreakpointFilters,
  validateBreakpointFilter,
  type BreakpointFilter,
} from '../src/breakpoints';

describe('mergeBreakpointFilters', () => {
  test('two `before: true` filters merge to `before: true`', () => {
    const out = mergeBreakpointFilters([{ before: true }, { before: true }]);
    expect(out).toEqual({ before: true });
  });

  test('`before: "*"` ∪ `before: " "` = `before: ["*", " "]`', () => {
    const out = mergeBreakpointFilters([{ before: '*' }, { before: ' ' }]);
    expect(out.before).toEqual(expect.arrayContaining(['*', ' ']));
  });

  test('`before: true` dominates `before: "*"`', () => {
    const out = mergeBreakpointFilters([{ before: true }, { before: '*' }]);
    expect(out).toEqual({ before: true });
  });

  test('mixed before+after merges component-wise', () => {
    const out = mergeBreakpointFilters([
      { before: '*' },
      { after: ' ' },
    ]);
    expect(out.before).toBe('*');
    expect(out.after).toBe(' ');
  });

  test('empty input returns empty object', () => {
    expect(mergeBreakpointFilters([])).toEqual({});
  });
});

describe('validateBreakpointFilter', () => {
  test('accepts before: true', () => {
    expect(() => validateBreakpointFilter({ before: true })).not.toThrow();
  });

  test('accepts after: "*"', () => {
    expect(() => validateBreakpointFilter({ after: '*' })).not.toThrow();
  });

  test('rejects {} with instructional error', () => {
    expect(() => validateBreakpointFilter({} as BreakpointFilter))
      .toThrow(/at least one.*before.*after/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/breakpoints.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `breakpoints.ts`**

Create `packages/machine/src/breakpoints.ts`:

```ts
import type { State } from '@turing-machine-js/machine';
import type { Path } from './path';

export type BreakpointFilter = {
  before?: boolean | string | string[];
  after?: boolean | string | string[];
};

export type BreakpointTarget = Path | string | State;

export type Breakpoint =
  | { kind: 'instruction'; path: Path; filter: BreakpointFilter }
  | { kind: 'halt'; filter: BreakpointFilter };

export function validateBreakpointFilter(filter: BreakpointFilter): void {
  if (filter.before === undefined && filter.after === undefined) {
    throw new Error(
      'Breakpoint filter must set at least one of `before` or `after`.',
    );
  }
}

function mergeOnePhase(
  values: ReadonlyArray<boolean | string | string[] | undefined>,
): boolean | string | string[] | undefined {
  const present = values.filter((v) => v !== undefined) as Array<boolean | string | string[]>;
  if (present.length === 0) return undefined;
  if (present.some((v) => v === true)) return true;
  const symbols = new Set<string>();
  for (const v of present) {
    if (Array.isArray(v)) v.forEach((s) => symbols.add(s));
    else if (typeof v === 'string') symbols.add(v);
  }
  if (symbols.size === 1) return [...symbols][0];
  return [...symbols];
}

export function mergeBreakpointFilters(filters: ReadonlyArray<BreakpointFilter>): BreakpointFilter {
  const before = mergeOnePhase(filters.map((f) => f.before));
  const after = mergeOnePhase(filters.map((f) => f.after));
  const out: BreakpointFilter = {};
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/breakpoints.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/breakpoints.ts packages/machine/test/breakpoints.spec.ts
git commit -m "Add breakpoints.ts — types, mergeBreakpointFilters, validateBreakpointFilter"
```

---

### Task 8: `pm.setBreakpoint` / `clearBreakpoint` / `clearBreakpoints` / `listBreakpoints`

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Modify: `packages/machine/src/index.ts` (export new types)
- Modify: `packages/machine/test/breakpoints.spec.ts` (registry section)

- [ ] **Step 1: Write failing tests for the registry**

Append to `packages/machine/test/breakpoints.spec.ts`:

```ts
import { PostMachine, State, haltState, mark, right, check, stop } from '../src/index';
import { haltState as engineHaltState } from '@turing-machine-js/machine';

describe('pm.setBreakpoint / listBreakpoints', () => {
  test('registers an instruction breakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    const list = pm.listBreakpoints();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      kind: 'instruction',
      path: { instructionIndex: 10 },
      filter: { before: true },
    });
  });

  test('registers a halt breakpoint (wrapped haltState)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint(haltState, { before: true });
    const list = pm.listBreakpoints();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ kind: 'halt', filter: { before: true } });
  });

  test('registers a halt breakpoint (bare upstream haltState)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint(engineHaltState, { before: true });
    expect(pm.listBreakpoints()).toEqual([{ kind: 'halt', filter: { before: true } }]);
  });

  test('rejects empty filter', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.setBreakpoint('10', {})).toThrow(/at least one/i);
  });

  test('setBreakpoint enables state.debug on the underlying State', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    // Inspect via the lockdown Proxy — reads pass through.
    expect(pm.stateAt('10').debug).toEqual({ before: true });
  });

  test('setBreakpoint enables state.debug on shared State with union filter', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    pm.setBreakpoint('10', { before: '*' });
    pm.setBreakpoint('30', { before: ' ' });
    const dbg = pm.stateAt('10').debug;
    expect(dbg?.before).toEqual(expect.arrayContaining(['*', ' ']));
  });

  test('listBreakpoints returns canonical Path shape regardless of input form', () => {
    const pm = new PostMachine({ 10: stop, sub: { 1: mark, 2: stop } });
    // Two equivalent inputs: dotted-string scope and array scope.
    pm.setBreakpoint({ scope: 'sub', instructionIndex: 1 }, { before: true });
    const [bp] = pm.listBreakpoints();
    expect(bp.kind).toBe('instruction');
    if (bp.kind === 'instruction') {
      // Canonical: scope is always the array form after normalization.
      expect(bp.path).toEqual({ scope: ['sub'], instructionIndex: 1 });
    }
  });
});

describe('pm.clearBreakpoint / clearBreakpoints', () => {
  test('clearBreakpoint removes one registration and resets state.debug to null', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.clearBreakpoint('10');
    expect(pm.listBreakpoints()).toEqual([]);
    expect(pm.stateAt('10').debug).toBeNull();
  });

  test('clearBreakpoint on shared State shrinks the union filter', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    pm.setBreakpoint('10', { before: '*' });
    pm.setBreakpoint('30', { before: ' ' });
    pm.clearBreakpoint('10');
    expect(pm.stateAt('30').debug).toEqual({ before: ' ' });
  });

  test('clearBreakpoints removes all', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.setBreakpoint(haltState, { before: true });
    pm.clearBreakpoints();
    expect(pm.listBreakpoints()).toEqual([]);
    expect(pm.stateAt('10').debug).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/breakpoints.spec.ts`
Expected: FAIL — `setBreakpoint` / `listBreakpoints` / `clearBreakpoint` / `clearBreakpoints` not defined.

- [ ] **Step 3: Implement the registry on PostMachine**

In `packages/machine/src/classes/PostMachine.ts`:

Add imports:

```ts
import {
  type Breakpoint,
  type BreakpointFilter,
  type BreakpointTarget,
  mergeBreakpointFilters,
  validateBreakpointFilter,
} from '../breakpoints';
```

Also import `State` static check (already imported) and `haltState` from engine (already imported).

Add field:

```ts
  #breakpoints: Breakpoint[] = [];
```

Add a private resolver that maps a `BreakpointTarget` to either an instruction `{ kind: 'instruction', path, state }` or a halt `{ kind: 'halt' }`. The halt case is detected via `State.isHalt(s)` after unwrapping any Proxy (reads through to underlying).

```ts
  #resolveBreakpointTarget(target: BreakpointTarget):
    | { kind: 'instruction'; path: Path; state: State }
    | { kind: 'halt' }
  {
    if (target instanceof State) {
      if (State.isHalt(target)) {
        return { kind: 'halt' };
      }
      throw new Error(
        'setBreakpoint accepts a State only for the haltState singleton. '
        + 'Use a Path or path string for instruction breakpoints.',
      );
    }
    const { path, state } = this.#resolveToState(target);
    return { kind: 'instruction', path, state };
  }

  #refreshStateDebug(state: State): void {
    const filters = this.#breakpoints
      .filter((bp): bp is Extract<Breakpoint, { kind: 'instruction' }> =>
        bp.kind === 'instruction' && this.#pathToState.get(formatPath(bp.path)) === state)
      .map((bp) => bp.filter);
    state.debug = filters.length > 0 ? mergeBreakpointFilters(filters) : null;
  }

  #refreshHaltDebug(): void {
    const filters = this.#breakpoints
      .filter((bp): bp is Extract<Breakpoint, { kind: 'halt' }> => bp.kind === 'halt')
      .map((bp) => bp.filter);
    haltState.debug = filters.length > 0 ? mergeBreakpointFilters(filters) : null;
  }
```

Note: the `haltState` referenced inside `#refreshHaltDebug` is the engine's bare singleton (already imported at the top from `@turing-machine-js/machine`). The lockdown wrap is in `index.ts`, not in this file.

Add the four public methods:

```ts
  setBreakpoint(target: BreakpointTarget, filter: BreakpointFilter): void {
    validateBreakpointFilter(filter);
    const resolved = this.#resolveBreakpointTarget(target);
    if (resolved.kind === 'instruction') {
      this.#breakpoints.push({ kind: 'instruction', path: resolved.path, filter });
      this.#refreshStateDebug(resolved.state);
    } else {
      this.#breakpoints.push({ kind: 'halt', filter });
      this.#refreshHaltDebug();
    }
  }

  clearBreakpoint(target: BreakpointTarget): void {
    const resolved = this.#resolveBreakpointTarget(target);
    if (resolved.kind === 'instruction') {
      const key = formatPath(resolved.path);
      this.#breakpoints = this.#breakpoints.filter(
        (bp) => !(bp.kind === 'instruction' && formatPath(bp.path) === key),
      );
      this.#refreshStateDebug(resolved.state);
    } else {
      this.#breakpoints = this.#breakpoints.filter((bp) => bp.kind !== 'halt');
      this.#refreshHaltDebug();
    }
  }

  clearBreakpoints(): void {
    const instructionStates = new Set<State>();
    let hadHalt = false;
    for (const bp of this.#breakpoints) {
      if (bp.kind === 'instruction') {
        const s = this.#pathToState.get(formatPath(bp.path));
        if (s) instructionStates.add(s);
      } else {
        hadHalt = true;
      }
    }
    this.#breakpoints = [];
    for (const s of instructionStates) this.#refreshStateDebug(s);
    if (hadHalt) this.#refreshHaltDebug();
  }

  listBreakpoints(): Breakpoint[] {
    return this.#breakpoints.map((bp) =>
      bp.kind === 'instruction'
        ? { kind: 'instruction', path: { ...bp.path }, filter: { ...bp.filter } }
        : { kind: 'halt', filter: { ...bp.filter } },
    );
  }
```

Re-export the new types from `packages/machine/src/index.ts`:

```ts
export type { Breakpoint, BreakpointFilter, BreakpointTarget } from './breakpoints';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/breakpoints.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/src/index.ts packages/machine/test/breakpoints.spec.ts
git commit -m "Add pm.setBreakpoint / clearBreakpoint / clearBreakpoints / listBreakpoints"
```

---

### Task 9: Registry-aware `onPause` filtering

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Modify: `packages/machine/test/breakpoints.spec.ts`

- [ ] **Step 1: Write failing tests for arrival-aware gating**

Append to `packages/machine/test/breakpoints.spec.ts`:

```ts
import { Tape, type MachineState } from '../src/index';

describe('onPause — registry-aware filtering', () => {
  function build(): PostMachine {
    return new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });
  }

  test('fires onPause when registered breakpoint matches arrival', async () => {
    const pm = build();
    pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: ['*', '*', ' '] }));
    pm.setBreakpoint('30', { before: true });
    const paused: MachineState[] = [];
    await pm.run({ onPause: (s) => { paused.push(s); } });
    expect(paused.some((m) => m.arrivalPath.instructionIndex === 30)).toBe(true);
  });

  test('silently resumes when a sibling instruction shares the State but did not match arrival', async () => {
    const pm = new PostMachine({
      10: mark(40),
      20: stop,
      30: mark(40),
      40: stop,
    });
    pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: [' '] }));
    // 10 and 30 share a State. Set breakpoint only on 30; running enters via 10
    // (entry instruction), so the engine pauses on the shared State at arrival
    // 10, but PostMachine's wrapper sees arrival=10, no registered match → silent.
    pm.setBreakpoint('30', { before: true });
    const paused: MachineState[] = [];
    await pm.run({ onPause: (s) => { paused.push(s); } });
    expect(paused).toEqual([]);
  });

  test('runtime channel: state.debug set inside onStep fires onPause unfiltered', async () => {
    const pm = build();
    pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: ['*', '*', ' '] }));
    let armed = false;
    const paused: MachineState[] = [];
    await pm.run({
      onStep: (s) => {
        if (!armed) {
          s.state.debug = { before: true };
          armed = true;
        }
      },
      onPause: (s) => { paused.push(s); },
    });
    // No registry entry; pause should pass through.
    expect(paused.length).toBeGreaterThan(0);
  });

  test('halt breakpoint fires onPause at halt', async () => {
    const pm = build();
    pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: ['*', '*', ' '] }));
    pm.setBreakpoint(haltState, { before: true });
    const paused: MachineState[] = [];
    await pm.run({ onPause: (s) => { paused.push(s); } });
    expect(paused.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (or pass for the wrong reason)**

Run: `npx vitest run packages/machine/test/breakpoints.spec.ts`
Expected: the "silently resumes" test FAILS — current wrapper passes every engine pause through. Other cases may pass spuriously because no filtering exists.

- [ ] **Step 3: Gate `onPause` dispatch through the registry**

In `PostMachine.ts`, replace the `onPause` arm of the existing `run()` (line ~117) with registry-aware filtering:

```ts
      onPause: onPause ? async (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        advanceTracking(raw);
        if (this.#shouldFireOnPause(raw, wrapped)) {
          await onPause(wrapped);
        }
      } : undefined,
```

Add the private decision helper:

```ts
  #shouldFireOnPause(raw: EngineMachineState, wrapped: MachineState): boolean {
    // Halt-pause: engine pauses on haltState before halting.
    if (State.isHalt(raw.state)) {
      return this.#breakpoints.some((bp) => bp.kind === 'halt');
    }
    // Find registered instruction breakpoints whose target State is the current one.
    const registeredOnThisState = this.#breakpoints.filter((bp): bp is Extract<Breakpoint, { kind: 'instruction' }> =>
      bp.kind === 'instruction' && this.#pathToState.get(formatPath(bp.path)) === raw.state,
    );
    if (registeredOnThisState.length === 0) {
      // Runtime channel: state.debug was set outside the registry; passthrough.
      return true;
    }
    // Arrival-aware match: at least one registered breakpoint targets the arrival path.
    const arrivalKey = formatPath(wrapped.arrivalPath);
    return registeredOnThisState.some((bp) => formatPath(bp.path) === arrivalKey);
  }
```

Also gate `runStepByStep` if `onPause` semantics apply there — they don't (the generator yields every step regardless), so leave it unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/breakpoints.spec.ts`
Expected: PASS — all registry tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/breakpoints.spec.ts
git commit -m "Gate onPause through the breakpoint registry (arrival-aware)"
```

---

### Task 10: README — new sections and updates

**Files:**
- Modify: `packages/machine/README.md`
- Modify: `packages/machine/test/examples.spec.ts`

- [ ] **Step 1: Add a "Path-based resolver" section to README**

In `packages/machine/README.md`, after the "Naming convention" section, add:

````markdown
## Path-based resolver (v6.3.0+)

`PostMachine` exposes three construction-time queries for addressing states by instruction path.

```ts
import { PostMachine, mark, stop } from '@post-machine-js/machine';

const pm = new PostMachine({ 10: mark, 20: stop });

pm.stateAt('10');               // wrapped State for instruction 10
pm.hasState('10');              // true
pm.hasState('999');             // false (never throws)
pm.candidatesFor('10');         // [{ instructionIndex: 10 }]
```

Both string and object forms work for paths:

```ts
pm.stateAt({ instructionIndex: 10 });
pm.stateAt({ scope: 'sub', instructionIndex: 1 });
pm.stateAt({ scope: ['outer', 'inner'], instructionIndex: 1, groupInstructionIndex: 2 });
```

Returned States are debug-locked: `pm.stateAt('10').debug = ...` throws. Use `pm.setBreakpoint` instead (see below). Reads (`.name`, `.id`, `instanceof State`) all pass through to the underlying engine State, so the wrapped State works with engine utilities like `State.toGraph`.
````

- [ ] **Step 2: Add a "Breakpoints" section**

```` markdown
## Breakpoints (v6.3.0+)

Register pauses by instruction path:

```ts
import { PostMachine, Tape, haltState, mark, right, check, stop } from '@post-machine-js/machine';

const pm = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: ['*', '*', ' '] }));

pm.setBreakpoint('30', { before: true });

await pm.run({
  onPause: (m) => {
    // console.log('paused at', m.arrivalPath);
  },
});
```

Filters mirror the engine's `DebugConfig`:

```ts
pm.setBreakpoint('10', { before: true });           // pause before every iteration
pm.setBreakpoint('10', { before: '*' });            // pause only on read '*'
pm.setBreakpoint('10', { before: ['*', ' '] });     // pause on either symbol
pm.setBreakpoint('10', { before: true, after: '*' });
```

Halt breakpoints:

```ts
pm.setBreakpoint(haltState, { before: true });      // pause at halt
```

Management:

```ts
pm.listBreakpoints();      // returns Breakpoint[]
pm.clearBreakpoint('10');  // remove a single registration
pm.clearBreakpoints();     // remove all
```

**State sharing.** When two instructions share an underlying State via hash dedup, setting a breakpoint on instruction 30 enables the engine's `state.debug` on the shared State — meaning the engine pauses on every visit. `PostMachine`'s `onPause` wrapper then consults the registry and *only* surfaces the pause when the just-followed reference matches a registered path (`m.arrivalPath`). Sibling-instruction visits silently resume.
````

- [ ] **Step 3: Add a "Lockdown semantics" subsection**

```` markdown
### Lockdown semantics

`pm.setBreakpoint` is the only construction-time path to `state.debug`. Direct assignments are blocked:

```ts
pm.stateAt('10').debug = { before: true };        // throws — points at setBreakpoint
pm.stateAt('10').debug.before = true;             // throws — same error
pm.initialState.debug = { before: true };         // throws
haltState.debug = { before: true };               // throws (from @post-machine-js/machine)
```

The runtime channel inside callbacks remains open:

```ts
await pm.run({
  onStep: (m) => {
    if (someCondition(m)) {
      m.state.debug = { before: true };           // runtime channel — allowed
    }
  },
});
```

Pauses triggered by this runtime channel bypass the registry filter and fire `onPause` unfiltered. This is the documented escape hatch for advanced introspection.
````

- [ ] **Step 4: Update the "Naming convention — State sharing" subsection**

Find the existing subsection in `README.md` (search for "State sharing") and replace its last sentence about "use the engine's Reference resolution" with:

```markdown
Use `pm.candidatesFor(path)` to list all paths pointing at the same underlying State at construction time, or read `MachineState.candidatePaths` from a runtime callback to get the same information.
```

- [ ] **Step 5: Mirror the new README examples in `examples.spec.ts`**

In `packages/machine/test/examples.spec.ts`, add `describe('Path-based resolver', …)`, `describe('Breakpoints', …)`, and `describe('Lockdown semantics', …)` blocks. Each example becomes a `test(...)` that mirrors the code verbatim and asserts the `// console.log(...)` lines as `expect(...).toBe(...)`. For the breakpoints example, capture the `paused.map((m) => m.arrivalPath)` calls.

The structural-snippet rule applies: examples that don't call `.run()` (the path-form examples) need only construction-time assertions (e.g., assert `stateAt` returns without throwing).

Imports may need to grow:

```ts
import {
  // existing imports …
  haltState,
  type Breakpoint,
} from '../src/index';
```

- [ ] **Step 6: Run tests to verify all docs are exercised**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/machine/README.md packages/machine/test/examples.spec.ts
git commit -m "README: add Path-based resolver, Breakpoints, Lockdown semantics sections"
```

---

### Task 11: CHANGELOG v6.3.0 entry

**Files:**
- Modify: `packages/machine/CHANGELOG.md`

- [ ] **Step 1: Add the entry**

At the top of `packages/machine/CHANGELOG.md`, insert (above the v6.2.0 entry):

```markdown
## 6.3.0 — 2026-MM-DD

### Added

- **Path-based State resolver** (#63): `pm.stateAt(path)`, `pm.hasState(path)`, `pm.candidatesFor(path)`. Accepts both path strings (`'foo::10.2'`) and object form (`{ scope, instructionIndex, groupInstructionIndex }`).
- **Per-instruction breakpoint registry** (#59): `pm.setBreakpoint(target, filter)`, `pm.clearBreakpoint(target)`, `pm.clearBreakpoints()`, `pm.listBreakpoints()`. `target` is `Path | string | State` (the State form is accepted only for `haltState`). Filters mirror the engine's `DebugConfig` shape.
- **Construction-time debug-config lockdown**: `pm.stateAt(...)`, `pm.initialState`, and the `haltState` re-export now return a `Proxy<State>` that blocks `state.debug = ...` and `state.debug.before = ...` with an instructional error pointing at `pm.setBreakpoint`. Reads pass through; `instanceof State` and engine utilities (`State.toGraph`, `summarize`) still work.
- New types exported: `Breakpoint`, `BreakpointFilter`, `BreakpointTarget`.

### Changed

- `pm.initialState` returns a debug-locked Proxy. Identity is preserved (`pm.initialState === pm.stateAt(<entry-instruction-path>)`).
- The `haltState` re-export from `@post-machine-js/machine` is now a debug-locked Proxy. Identity breaks vs. the bare upstream singleton (`@turing-machine-js/machine`'s `haltState !== @post-machine-js/machine`'s `haltState`). Identity-sensitive code should use `State.isHalt(s)`. `pm.setBreakpoint(haltState, ...)` accepts either form.

### Notes

- Arrival-aware `onPause` filtering: with state-sharing via hash dedup, multiple instructions may share an underlying State; `setBreakpoint('30', ...)` enables `state.debug` on the shared State (engine pauses on every visit), but PostMachine's wrapper only surfaces pauses whose `arrivalPath` matches a registered breakpoint. Sibling visits silently resume.
- Runtime channel preserved: `machineState.state.debug = ...` inside an `onStep`/`onPause` callback bypasses the lockdown and the registry — useful for conditional mid-run enable.
- The graph-walk escape (`pm.stateAt(...).getNextStateForSymbol(...)` reaches an unproxied State) remains. Tracked in #72; landing target v7.

### Migration

- If your code did `pm.initialState.debug = ...`, switch to `pm.setBreakpoint(<entry-instruction-path>, ...)`. The entry path is the smallest-indexed instruction in the top-level scope.
- If your code imported `haltState` from `@turing-machine-js/machine` for identity checks against PostMachine's wrapped re-export, prefer importing `haltState` from `@post-machine-js/machine`, or use `State.isHalt(s)`.
```

- [ ] **Step 2: Commit**

```bash
git add packages/machine/CHANGELOG.md
git commit -m "CHANGELOG: add v6.3.0 entry"
```

---

### Task 12: Final verification — build, tests, lint, coverage

**Files:** none modified; verification only.

- [ ] **Step 1: TypeScript build**

Run: `npm run build`
Expected: PASS — `dist/` regenerates, no TS errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 3: Coverage**

Run: `npm run test:coverage`
Expected: PASS with thresholds at or above the current 100/100/100/100 baseline. If any of the four metrics drops below 100, investigate before proceeding.

If a defensive branch is uncovered, follow the v6.2.0 precedent: rather than adding `c8 ignore`, delete the unreachable code (the global CLAUDE.md says: don't add error handling, fallbacks, or validation for scenarios that can't happen).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS — no errors.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/issue-59-63-debugger-lockdown
gh pr create --base master --title "v6.3.0: Per-instruction breakpoints + path-based resolver + lockdown (#59, #63)" --body "$(cat <<'EOF'
Closes #59 and #63. Implements the v6.3.0 layer of the coordinated debugger spec (`docs/superpowers/specs/2026-05-17-instruction-debugger-design.md`).

## What's in

- **#63 — path-based resolver**: `pm.stateAt`, `pm.hasState`, `pm.candidatesFor`. Both string and object Path forms.
- **#59 — breakpoint registry**: `pm.setBreakpoint`, `pm.clearBreakpoint`, `pm.clearBreakpoints`, `pm.listBreakpoints`. Path and `haltState` targets. Filter union on shared States; arrival-aware filtering in `onPause`.
- **Construction-time lockdown**: two-layer `Proxy<State>` wrapping `pm.stateAt`, `pm.initialState`, and the `haltState` re-export. Direct `state.debug = ...` and `state.debug.before = ...` throw with an instructional error. Reads pass through; `instanceof` and engine utilities work.
- **Runtime channel preserved**: `machineState.state.debug = ...` inside callbacks bypasses the registry — documented escape hatch.

## Breaking changes (within v6.x)

- `pm.initialState.debug = ...` now throws. Migrate to `pm.setBreakpoint(<entry-path>, ...)`.
- `haltState` from `@post-machine-js/machine` is a Proxy and is no longer `===` to the bare upstream singleton. Use `State.isHalt(s)` for identity-sensitive checks.

## Known limitations

- Graph-walk escape (reaching unproxied States via `state.getNextStateForSymbol(...)`) remains. Tracked in #72, landing target v7.

## Test plan

- [ ] `npm run build`
- [ ] `npm test` — all suites green
- [ ] `npm run test:coverage` — 100/100/100/100 maintained
- [ ] `npm run lint`
EOF
)"
```

- [ ] **Step 6: Confirm CI**

Wait for the 2 required status checks (build + tests) to pass on the PR. Hand back to the user for review and merge.

---

## Self-Review

**Spec coverage:**
- Path type + `parsePath` + `formatPath` → already in master (v6.2.0). No task needed; reused.
- `MachineState` extension with `arrivalPath` + `candidatePaths` → already in master (v6.2.0). No task needed; reused.
- `pm.stateAt` / `pm.hasState` / `pm.candidatesFor` → Tasks 3–4. ✓
- Two-layer Proxy lockdown → Task 2 (helper), Task 5 (`initialState` wrap), Task 6 (haltState wrap). ✓
- Per-instance Proxy cache → in lockdown.ts (the `Map<State, State>` arg). ✓
- Module-level haltState wrap exception → Task 6. ✓
- `BreakpointFilter` / `BreakpointTarget` / `Breakpoint` types → Task 7. ✓
- `setBreakpoint` / `clearBreakpoint` / `clearBreakpoints` / `listBreakpoints` → Task 8. ✓
- Filter aggregation (union on shared States) → Task 7 (`mergeBreakpointFilters`), Task 8 (`#refreshStateDebug`). ✓
- Halt breakpoint accepting both wrapped and bare singleton → Task 8 (`#resolveBreakpointTarget` uses `State.isHalt`). ✓
- Registry-aware `onPause` filtering → Task 9. ✓
- README updates ("Path-based resolver", "Breakpoints", "Lockdown semantics", "State sharing" subsection) → Task 10. ✓
- examples.spec.ts mirror → Task 10. ✓
- CHANGELOG v6.3.0 entry → Task 11. ✓
- Spec out-of-scope items (conditional `when`, step-in/out/over, graph-walk Proxy) → correctly not scheduled. ✓

**Placeholder scan:** all code shown verbatim, no "TBD"/"add error handling here", no "similar to Task N" references, no unstated types or methods.

**Type consistency:** `Path` shape used everywhere matches the v6.2.0 export (`{ scope?, instructionIndex, groupInstructionIndex? }`). `formatPath(path)` used as the canonical key for `#pathToState` and the registry comparison.

**Coverage baseline:** Task 12 enforces 100/100/100/100 with the same "delete unreachable code, don't `c8 ignore`" precedent as v6.2.0.

**Release shape:** matches the project's release pattern memory — `feat/issue-…` feature branch, PR to branch-protected master, no admin bypass. The version bump (`packages/machine/package.json`: 6.2.0 → 6.3.0) is **not** included in this PR; it lands later on a dedicated `v6-3-0` branch, per the project's release pattern (verified by PR #73: feature merged at master `209d5fa` with `package.json` untouched). The CHANGELOG entry in Task 11 uses a `2026-MM-DD` date placeholder that the bump branch fills in.

The PR title in Task 12 deliberately omits a version prefix for the same reason.
