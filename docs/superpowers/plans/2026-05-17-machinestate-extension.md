# MachineState Extension Implementation Plan (Plan A — #70)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `MachineState` (re-exported from `@post-machine-js/machine`) with `arrivalPath: Path` and `candidatePaths: Path[]` fields. Wrap `pm.run()` and `pm.runStepByStep()` callbacks so consumers get the extended shape with instruction-level context. Rename `__onPause` → `onPause` (drop experimental prefix).

**Architecture:** Add a `Path` type + `parsePath`/`formatPath` resolver in a new `packages/machine/src/path.ts` module. At PostMachine construction, build two reverse maps: `Map<State, Path[]>` (for `candidatePaths` field) and `Map<{from: State, symbol: Symbol}, Path>` (for `arrivalPath` derivation). Wrap the engine's callback dispatch so each yielded `MachineState` is augmented with the two fields before reaching the user.

**Tech Stack:** TypeScript, Vitest, npm workspaces, `@turing-machine-js/machine` peer dep v6 (unchanged).

**Spec reference:** `docs/superpowers/specs/2026-05-17-instruction-debugger-design.md` — sections "Path: the address space" and "#70: MachineState extension (primitive)".

**Issue:** [#70](https://github.com/mellonis/post-machine-js/issues/70).

**Release target:** v6.2.0 (minor — additive runtime callback shape change; existing readers of `state`/`tape` unaffected).

---

## File structure

- **Create** `packages/machine/src/path.ts` — `Path` type, `normalizeScope` helper, `parsePath`, `formatPath`. Pure functions, no PostMachine dependency.
- **Modify** `packages/machine/src/index.ts` — export `Path`, `parsePath`, `formatPath`; modify the `MachineState` re-export to resolve to the extended shape.
- **Modify** `packages/machine/src/classes/PostMachine.ts` — build the two reverse maps during `#buildInitialState`; wrap `run()` and `runStepByStep()` callback dispatch; rename `__onPause` → `onPause`.
- **Create** `packages/machine/test/path.spec.ts` — unit tests for `parsePath`/`formatPath` and validation rules.
- **Create** `packages/machine/test/machine-state.spec.ts` — runtime tests for `arrivalPath` and `candidatePaths` fields.
- **Modify** `packages/machine/test/debugger.spec.ts` — rename `__onPause` → `onPause` in existing tests; add tests covering the extended MachineState shape.
- **Modify** `packages/machine/README.md` — add section on Path + extended MachineState; update existing onPause references.
- **Modify** `packages/machine/CHANGELOG.md` — v6.2.0 entry.

The hash dedup naming convention from v6.1.0 (`#67`) is unchanged. This plan extends the public surface but doesn't change state names.

---

## Task 1: Create `Path` type and resolver

**Files:**
- Create: `packages/machine/src/path.ts`
- Create: `packages/machine/test/path.spec.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `packages/machine/test/path.spec.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parsePath, formatPath, type Path } from '../src/path';

describe('parsePath — happy paths', () => {
  test('top-level instruction', () => {
    expect(parsePath('10')).toEqual({ instructionIndex: 10 });
  });

  test('top-level group inner', () => {
    expect(parsePath('10.2')).toEqual({ instructionIndex: 10, groupInstructionIndex: 2 });
  });

  test('subroutine body instruction', () => {
    expect(parsePath('foo::1')).toEqual({ scope: ['foo'], instructionIndex: 1 });
  });

  test('nested subroutine', () => {
    expect(parsePath('outer::inner::1')).toEqual({ scope: ['outer', 'inner'], instructionIndex: 1 });
  });

  test('group inner inside subroutine', () => {
    expect(parsePath('foo::10.2')).toEqual({
      scope: ['foo'],
      instructionIndex: 10,
      groupInstructionIndex: 2,
    });
  });

  test('group inner inside nested subroutine', () => {
    expect(parsePath('outer::inner::10.2')).toEqual({
      scope: ['outer', 'inner'],
      instructionIndex: 10,
      groupInstructionIndex: 2,
    });
  });
});

describe('parsePath — rejections', () => {
  test('wrapper composite (contains >)', () => {
    expect(() => parsePath('foo>10~30')).toThrow(/wrapper composite|not an instruction path/i);
  });

  test('group wrapper composite', () => {
    expect(() => parsePath('50.1>50~60')).toThrow(/wrapper composite|not an instruction path/i);
  });

  test('continuation state (contains ~)', () => {
    expect(() => parsePath('10~30')).toThrow(/continuation|not an instruction path/i);
  });

  test('continuation to halt', () => {
    expect(() => parsePath('foo::10~halt')).toThrow(/continuation|not an instruction path/i);
  });

  test('halt literal', () => {
    expect(() => parsePath('halt')).toThrow(/halt|not an instruction path/i);
  });

  test('leading :: prefix', () => {
    expect(() => parsePath('::10')).toThrow(/leading|invalid scope|empty/i);
  });

  test('empty scope segment', () => {
    expect(() => parsePath('foo::::1')).toThrow(/empty scope segment|invalid scope/i);
  });

  test('non-identifier scope segment', () => {
    expect(() => parsePath('foo.bar::1')).toThrow(/invalid scope|identifier/i);
  });

  test('group inner index of zero', () => {
    expect(() => parsePath('10.0')).toThrow(/group.*index|positive integer/i);
  });

  test('non-numeric instruction index', () => {
    expect(() => parsePath('foo::abc')).toThrow(/instruction index|integer/i);
  });

  test('empty string', () => {
    expect(() => parsePath('')).toThrow(/empty|invalid path/i);
  });
});

describe('formatPath', () => {
  test('top-level', () => {
    expect(formatPath({ instructionIndex: 10 })).toBe('10');
  });

  test('top-level group inner', () => {
    expect(formatPath({ instructionIndex: 10, groupInstructionIndex: 2 })).toBe('10.2');
  });

  test('with scope as array', () => {
    expect(formatPath({ scope: ['foo'], instructionIndex: 1 })).toBe('foo::1');
  });

  test('with scope as dotted string', () => {
    expect(formatPath({ scope: 'foo', instructionIndex: 1 })).toBe('foo::1');
  });

  test('nested scope as array', () => {
    expect(formatPath({ scope: ['outer', 'inner'], instructionIndex: 1 })).toBe('outer::inner::1');
  });

  test('nested scope as dotted string', () => {
    expect(formatPath({ scope: 'outer::inner', instructionIndex: 1 })).toBe('outer::inner::1');
  });

  test('with scope and group inner', () => {
    expect(formatPath({ scope: ['foo'], instructionIndex: 10, groupInstructionIndex: 2 })).toBe('foo::10.2');
  });

  test('empty scope normalizes to top-level', () => {
    expect(formatPath({ scope: [], instructionIndex: 10 })).toBe('10');
    expect(formatPath({ scope: '', instructionIndex: 10 })).toBe('10');
    expect(formatPath({ scope: undefined, instructionIndex: 10 })).toBe('10');
  });
});

describe('roundtrip parsePath ↔ formatPath', () => {
  const cases = ['10', '10.2', 'foo::1', 'foo::10.2', 'outer::inner::1', 'outer::inner::10.2'];
  for (const s of cases) {
    test(`'${s}' roundtrips`, () => {
      expect(formatPath(parsePath(s))).toBe(s);
    });
  }
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/path.spec.ts`
Expected: FAIL — module `../src/path` does not exist.

- [ ] **Step 1.3: Implement `path.ts`**

Create `packages/machine/src/path.ts`:

```ts
export type Path = {
  scope?: string | string[];
  instructionIndex: number;
  groupInstructionIndex?: number;
};

// Subroutine name regex matches PostMachine's existing subroutineNameValidator.
const SUBROUTINE_NAME_REGEX = /^[A-Z$_][A-Z0-9$_]*$/i;

export function normalizeScope(scope: string | string[] | undefined): string[] {
  if (!scope) return [];
  return typeof scope === 'string' ? scope.split('::') : [...scope];
}

export function parsePath(s: string): Path {
  if (!s) {
    throw new Error(`invalid path: empty string`);
  }

  if (s.includes('>')) {
    throw new Error(`invalid path '${s}': contains '>', which is the engine's wrapper composite separator (not an instruction path)`);
  }

  if (s.includes('~')) {
    throw new Error(`invalid path '${s}': contains '~', which marks continuation states (not an instruction path)`);
  }

  if (s === 'halt') {
    throw new Error(`invalid path 'halt': haltState is not an instruction path`);
  }

  if (s.startsWith('::')) {
    throw new Error(`invalid path '${s}': leading '::' is not allowed; top-level paths have no scope prefix`);
  }

  // Split scope from the final segment. The final segment is either '<idx>' or '<idx>.<group>'.
  const segments = s.split('::');
  for (const seg of segments) {
    if (seg === '') {
      throw new Error(`invalid path '${s}': empty scope segment`);
    }
  }

  const finalSegment = segments.pop() as string;
  const scopeSegments = segments;

  for (const seg of scopeSegments) {
    if (!SUBROUTINE_NAME_REGEX.test(seg)) {
      throw new Error(`invalid path '${s}': scope segment '${seg}' is not a valid subroutine name`);
    }
  }

  // Final segment: parse '<idx>' or '<idx>.<group>'.
  let instructionIndexStr: string;
  let groupInstructionIndex: number | undefined;

  if (finalSegment.includes('.')) {
    const [idxStr, groupStr, ...rest] = finalSegment.split('.');
    if (rest.length > 0) {
      throw new Error(`invalid path '${s}': multiple '.' in final segment`);
    }
    instructionIndexStr = idxStr;
    const groupNum = Number(groupStr);
    if (!Number.isInteger(groupNum) || groupNum < 1) {
      throw new Error(`invalid path '${s}': group inner index must be a positive integer, got '${groupStr}'`);
    }
    groupInstructionIndex = groupNum;
  } else {
    instructionIndexStr = finalSegment;
  }

  const instructionIndex = Number(instructionIndexStr);
  if (!Number.isInteger(instructionIndex) || instructionIndex < 1) {
    throw new Error(`invalid path '${s}': instruction index must be a positive integer, got '${instructionIndexStr}'`);
  }

  const path: Path = { instructionIndex };
  if (scopeSegments.length > 0) {
    path.scope = scopeSegments;
  }
  if (groupInstructionIndex !== undefined) {
    path.groupInstructionIndex = groupInstructionIndex;
  }
  return path;
}

export function formatPath(p: Path): string {
  const scope = normalizeScope(p.scope);
  const scopeStr = scope.length > 0 ? `${scope.join('::')}::` : '';
  const groupSuffix = p.groupInstructionIndex !== undefined ? `.${p.groupInstructionIndex}` : '';
  return `${scopeStr}${p.instructionIndex}${groupSuffix}`;
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run packages/machine/test/path.spec.ts`
Expected: PASS — all parsePath/formatPath tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/machine/src/path.ts packages/machine/test/path.spec.ts
git commit -m "Add Path type and parsePath/formatPath resolver"
```

---

## Task 2: Export Path types from `index.ts`

**Files:**
- Modify: `packages/machine/src/index.ts`

- [ ] **Step 2.1: Read the current index.ts**

Inspect `packages/machine/src/index.ts` to understand the existing export structure.

- [ ] **Step 2.2: Add Path exports**

Add to `packages/machine/src/index.ts` (preserve existing exports, just add):

```ts
export { parsePath, formatPath, type Path } from './path';
```

(Place near other type/function exports, e.g., after the engine re-exports.)

- [ ] **Step 2.3: Verify nothing broke**

Run: `npm test`
Expected: all existing tests pass + Task 1's path.spec.ts passes.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 2.4: Commit**

```bash
git add packages/machine/src/index.ts
git commit -m "Export Path, parsePath, formatPath from package entry"
```

---

## Task 3: Extended `MachineState` re-export

**Files:**
- Modify: `packages/machine/src/index.ts`

- [ ] **Step 3.1: Locate the current MachineState re-export**

In `packages/machine/src/index.ts`, find the existing `MachineState` re-export. It's currently a pass-through from `@turing-machine-js/machine`.

- [ ] **Step 3.2: Replace with the extended type**

Modify the re-export. Replace whatever currently exports `MachineState` (likely something like `export type { MachineState } from '@turing-machine-js/machine';`) with:

```ts
import type { MachineState as EngineMachineState } from '@turing-machine-js/machine';
import type { Path } from './path';

export type MachineState = EngineMachineState & {
  arrivalPath: Path;
  candidatePaths: Path[];
};
```

The Path import path is `./path` (the local module from Task 1).

- [ ] **Step 3.3: Verify build still works**

Run: `npm run build`
Expected: clean build. The type extension is structural; existing consumers reading `state`, `tape`, etc. are unaffected.

Run: `npm test`
Expected: all existing tests pass. (Runtime field-population is in Task 5; type alone doesn't break anything.)

- [ ] **Step 3.4: Commit**

```bash
git add packages/machine/src/index.ts
git commit -m "Extend MachineState re-export with arrivalPath and candidatePaths"
```

---

## Task 4: Build reverse maps during construction

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`

- [ ] **Step 4.1: Survey existing fields and constructor flow**

Read `packages/machine/src/classes/PostMachine.ts` to understand:
- Private fields (`#initialState`, `#blankSymbol`, `#markSymbol`).
- The `#buildInitialState` private method and how it threads `instructionPrefix` (added in v6.1.0 / #67).
- Where the constructor calls `#buildInitialState` and binds references.

- [ ] **Step 4.2: Add two private fields for the reverse maps**

Add to the PostMachine class fields (near `#initialState`):

```ts
#stateToCandidatePaths: Map<State, Path[]> = new Map();
```

The Reference → Path map for arrival derivation lands in Task 5 (`#referenceToPath`). No additional fields needed in Task 4.

Add the import for `Path` at the top of the file:

```ts
import type { Path } from '../path';
```

- [ ] **Step 4.3: Track Path for each instruction during `#buildInitialState`**

Modify `#buildInitialState` to thread `scope: string[]` alongside the existing `instructionPrefix`. Add a new param:

```ts
#buildInitialState({
  instructions,
  subroutinesDataFromUpperScope = {},
  subroutineInitialStatesFromUpperScope = {},
  calledFromGroup = false,
  instructionPrefix = '',
  scope = [],
}: {
  instructions: Instructions;
  subroutinesDataFromUpperScope?: Record<string, { reference: Reference; instructions: Instructions }>;
  subroutineInitialStatesFromUpperScope?: Record<string, State>;
  calledFromGroup?: boolean;
  instructionPrefix?: string;
  scope?: string[];
}): State {
```

Pass `scope` through recursive calls:

```ts
// For subroutine body recursion (where existing code passes subroutineName::):
reference.bind(this.#buildInitialState({
  instructions: subroutineInstructions,
  subroutinesDataFromUpperScope: subroutinesData,
  subroutineInitialStatesFromUpperScope: subroutineInitialStates,
  instructionPrefix: `${instructionPrefix}${subroutineName}::`,
  scope: [...scope, subroutineName],
}));
```

```ts
// For group recursion (existing code passes <outer>. as prefix):
const groupState = this.#buildInitialState({
  instructions: groupInstructions,
  subroutinesDataFromUpperScope: subroutinesData,
  subroutineInitialStatesFromUpperScope: subroutineInitialStates,
  calledFromGroup: true,
  instructionPrefix: `${instructionPrefix}${instructionIndex}.`,
  scope,  // group recursion stays in the parent scope
});
```

- [ ] **Step 4.4: Record Path for each reference at the point of bind**

In `#buildInitialState`, after building `builtStates` and binding `references[instructionIndex].bind(state)`, record the Path for each:

```ts
// At the end of #buildInitialState, after the binding loop:
builtStates.forEach((state, instructionIndexStr) => {
  references[instructionIndexStr].bind(state);

  // Record the reverse-map entry for this instruction.
  const path: Path = {
    instructionIndex: Number(instructionIndexStr),
    ...(scope.length > 0 ? { scope: [...scope] } : {}),
    ...(calledFromGroup ? { /* see note below */ } : {}),
  };

  // For group recursion, the inner instruction's path also needs groupInstructionIndex.
  // The `instructionIndexStr` inside a group is the inner index (1, 2, ...).
  // The outer instruction index is encoded in the `instructionPrefix`'s "<outer>." trailing fragment.
  // Cleaner: thread groupOuterIndex through as a separate param when recursing into a group.

  // Records into reverse maps:
  this.#recordPath(state, path);
});
```

NOTE for the engineer: the cleanest way to track group inner paths is to pass a `groupOuterInstructionIndex?: number` param into `#buildInitialState`. When set, each instructionIndex inside the recursion is a `groupInstructionIndex`, and the outer is the `groupOuterInstructionIndex`. Adjust the params and Path construction accordingly. Refactor in Step 4.4.

- [ ] **Step 4.5: Refactored param threading for group context**

Replace Step 4.3's group recursion call with:

```ts
const groupState = this.#buildInitialState({
  instructions: groupInstructions,
  subroutinesDataFromUpperScope: subroutinesData,
  subroutineInitialStatesFromUpperScope: subroutineInitialStates,
  calledFromGroup: true,
  instructionPrefix: `${instructionPrefix}${instructionIndex}.`,
  scope,
  groupOuterInstructionIndex: Number(instructionIndex),
});
```

Add the param to `#buildInitialState`:

```ts
groupOuterInstructionIndex?: number;
```

Inside `#buildInitialState`, when constructing a Path for an instruction:

```ts
const path: Path = groupOuterInstructionIndex !== undefined
  ? {
      ...(scope.length > 0 ? { scope: [...scope] } : {}),
      instructionIndex: groupOuterInstructionIndex,
      groupInstructionIndex: Number(instructionIndexStr),
    }
  : {
      ...(scope.length > 0 ? { scope: [...scope] } : {}),
      instructionIndex: Number(instructionIndexStr),
    };
```

- [ ] **Step 4.6: Add the `#recordPath` helper**

```ts
#recordPath(state: State, path: Path): void {
  const existing = this.#stateToCandidatePaths.get(state);
  if (existing) {
    existing.push(path);
  } else {
    this.#stateToCandidatePaths.set(state, [path]);
  }
}
```

After all instructions in all scopes are processed (i.e., after the top-level `#buildInitialState` returns), sort each Path[] deterministically:

```ts
// In the PostMachine constructor, after the initial #buildInitialState call:
for (const [, paths] of this.#stateToCandidatePaths) {
  paths.sort((a, b) => comparePathsCanonically(a, b));
}
```

Add `comparePathsCanonically` as a private static helper or pull out into `path.ts`:

```ts
// In packages/machine/src/path.ts:
export function comparePathsCanonically(a: Path, b: Path): number {
  const aScope = normalizeScope(a.scope).join('::');
  const bScope = normalizeScope(b.scope).join('::');
  if (aScope !== bScope) return aScope < bScope ? -1 : 1;
  if (a.instructionIndex !== b.instructionIndex) return a.instructionIndex - b.instructionIndex;
  const aGroup = a.groupInstructionIndex ?? -1;
  const bGroup = b.groupInstructionIndex ?? -1;
  return aGroup - bGroup;
}
```

Import `comparePathsCanonically` into `PostMachine.ts`.

- [ ] **Step 4.7: Write a test for the reverse map (via a temporary test-hook)**

For now, the reverse map is internal. To test it without exposing it as public API, add a temporary `__getCandidatePathsForState(state: State): Path[]` method to PostMachine (prefixed with `__` to signal test-only; will be removed when `pm.candidatesFor` lands in Plan B / #63).

Actually — skip the temporary hook. The reverse map's correctness is tested via `candidatePaths` on the wrapped MachineState (Task 5). Just verify the construction doesn't crash:

Run: `npm test`
Expected: existing tests pass. The reverse map is populated but not yet read.

- [ ] **Step 4.8: Commit**

```bash
git add packages/machine/src/path.ts packages/machine/src/classes/PostMachine.ts
git commit -m "Build state→Path[] reverse map during PostMachine construction"
```

---

## Task 5: Build Reference→Path map for arrival derivation

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`

The engine's `State` class exposes `getNextState(symbol: symbol): State | Reference` which returns the **raw** transition target (a `Reference` for forward-declared targets, or a `State` for direct ones like `haltState`). This means we can derive arrivalPath at runtime without modifying `commands.ts` — just look up the Reference in a construction-time map.

- [ ] **Step 5.1: Add the Reference→Path field**

Add to PostMachine class fields:

```ts
#referenceToPath: Map<Reference, Path> = new Map();
```

- [ ] **Step 5.2: Populate during `#buildInitialState`**

In `#buildInitialState`, after the `references` object is constructed (around the existing line where `references` is created via `instructionIndexList.reduce`), add a loop that records each Reference's Path:

```ts
for (const indexKey of instructionIndexList) {
  const path: Path = groupOuterInstructionIndex !== undefined
    ? {
        ...(scope.length > 0 ? { scope: [...scope] } : {}),
        instructionIndex: groupOuterInstructionIndex,
        groupInstructionIndex: Number(indexKey),
      }
    : {
        ...(scope.length > 0 ? { scope: [...scope] } : {}),
        instructionIndex: Number(indexKey),
      };
  this.#referenceToPath.set(references[indexKey], path);
}
```

Subroutine-entry references (the ones in `localSubroutinesData`) are intentionally **not** recorded here. The hopper is engine machinery for `withOverrodeHaltState` composition; arrival to a subroutine body fires onStep for the body's first instruction (which IS in `#referenceToPath`), not the hopper. Verify during Task 6 testing.

- [ ] **Step 5.3: Run tests**

Run: `npm test`
Expected: existing tests still pass. The `#referenceToPath` map is populated but not yet read.

- [ ] **Step 5.4: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts
git commit -m "Build Reference→Path map for arrival derivation"
```

---

## Task 6: Wrap `run()` and `runStepByStep()` callbacks

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts`
- Create: `packages/machine/test/machine-state.spec.ts`

- [ ] **Step 6.1: Write failing tests for the wrapped MachineState**

Create `packages/machine/test/machine-state.spec.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { PostMachine, mark, right, check, stop, call, parsePath } from '../src/index';
import type { MachineState } from '../src/index';

describe('PostMachine — wrapped MachineState', () => {
  test('onStep receives arrivalPath and candidatePaths', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.arrivalPath).toBeDefined();
      expect(Array.isArray(s.candidatePaths)).toBe(true);
    }
  });

  test('first-step arrivalPath is the entry instruction', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen[0].arrivalPath).toEqual(parsePath('10'));
  });

  test('un-shared state has single candidatePath', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen[0].candidatePaths).toEqual([parsePath('10')]);
  });

  test('shared state (two structurally-identical instructions) has multiple candidatePaths', async () => {
    // Both 10 and 20 produce identical mark-then-30 transitions.
    // The hash cache dedupes them; their candidatePaths reflect the sharing.
    const m = new PostMachine({
      10: mark(30),
      20: mark(30),
      30: stop,
    });
    // Walk the graph: any state reachable should have candidatePaths covering both 10 and 20.
    // Verify via onStep when control reaches the shared state.
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    // The first step is at instr 10 (or 20, depending on which is the entry — the first listed is 10).
    expect(seen[0].candidatePaths.length).toBe(2);
    expect(seen[0].candidatePaths.map(p => p.instructionIndex)).toEqual([10, 20]);
  });

  test('subroutine body instruction has fully-qualified arrivalPath', async () => {
    const m = new PostMachine({
      10: call('foo'),
      foo: { 1: mark },
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    // After the call wrapper, control reaches foo::1.
    const fooStep = seen.find(s => s.arrivalPath.scope && (s.arrivalPath.scope as string[]).join('::') === 'foo' && s.arrivalPath.instructionIndex === 1);
    expect(fooStep).toBeDefined();
  });

  test('group inner has arrivalPath with groupInstructionIndex', async () => {
    const m = new PostMachine({
      50: [right, mark],
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    // The first inner (right) at 50.1.
    const groupInner = seen.find(s => s.arrivalPath.instructionIndex === 50 && s.arrivalPath.groupInstructionIndex === 1);
    expect(groupInner).toBeDefined();
  });
});

describe('PostMachine — onPause rename', () => {
  test('onPause fires when state.debug is set on a reachable state', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    // Set debug on the initial state directly (raw escape — still works in Plan A; locked in Plan B).
    m.initialState.debug = { before: true };
    const paused: MachineState[] = [];
    await m.run({ onPause: (s) => { paused.push(s); } });
    expect(paused.length).toBeGreaterThan(0);
    expect(paused[0].arrivalPath).toBeDefined();
  });

  test('onStep callback also receives wrapped state', async () => {
    const m = new PostMachine({ 10: mark, 20: stop });
    const stepped: MachineState[] = [];
    await m.run({ onStep: (s) => { stepped.push(s); } });
    expect(stepped[0].arrivalPath).toBeDefined();
    expect(Array.isArray(stepped[0].candidatePaths)).toBe(true);
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npx vitest run packages/machine/test/machine-state.spec.ts`
Expected: FAIL — wrapped MachineState fields don't exist yet at runtime.

- [ ] **Step 6.3: Implement the wrap in `run()`**

Add the type import at the top of `PostMachine.ts`:

```ts
import type { MachineState as EngineMachineState } from '@turing-machine-js/machine';
```

Modify `run()`:

```ts
override async run({
  stepsLimit = 1e5,
  onStep,
  onPause,
}: {
  stepsLimit?: number;
  onStep?: (machineState: MachineState) => void;
  onPause?: (machineState: MachineState) => void | Promise<void>;
} = {}): Promise<void> {
  let prevState: State | null = null;
  let prevJsSymbol: symbol | null = null;
  const entryPath = this.#firstStepArrivalPath();

  const wrapAndForward = async <T>(raw: EngineMachineState, dispatch: ((m: MachineState) => T) | undefined): Promise<T | undefined> => {
    if (!dispatch) return undefined;
    const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
    prevState = raw.state;
    prevJsSymbol = this.tapeBlock.symbol([raw.currentSymbols[0]]);
    return dispatch(wrapped);
  };

  await super.run({
    initialState: this.#initialState,
    stepsLimit,
    onStep: onStep ? (raw) => wrapAndForward(raw, onStep) : undefined,
    onPause: onPause ? (raw) => wrapAndForward(raw, onPause) : undefined,
  });
}
```

The engine's `MachineState` field used here is `currentSymbols: string[]` (one entry per tape; post-machine-js is single-tape so `[0]`). The JS Symbol that keys the State's transition map is obtained via `tapeBlock.symbol([symbolString])`. The raw Reference for the followed transition is obtained via `state.getNextState(jsSymbol)` (see Step 6.4).

- [ ] **Step 6.4: Implement `#wrapMachineState` and `#firstStepArrivalPath`**

Add private methods to PostMachine:

```ts
#firstStepArrivalPath(): Path {
  // The entry instruction's path = canonical candidatePath of the initial state.
  // For programs starting with a call, the initial state is a wrapper composite
  // whose candidatePaths include the call's path — pick the canonical (first) entry.
  const candidates = this.#stateToCandidatePaths.get(this.#initialState);
  if (!candidates || candidates.length === 0) {
    throw new Error('PostMachine internal: initial state has no candidate paths');
  }
  return candidates[0];
}

#wrapMachineState(
  raw: EngineMachineState,
  prevState: State | null,
  prevJsSymbol: symbol | null,
  entryPath: Path,
): MachineState {
  let arrivalPath: Path;
  if (prevState === null || prevJsSymbol === null) {
    arrivalPath = entryPath;
  } else {
    // Get the raw followed transition: State or Reference.
    // The engine's State.getNextState(symbol) returns the raw nextState entry.
    const followed = prevState.getNextState(prevJsSymbol);
    if (followed instanceof Reference) {
      const fromRef = this.#referenceToPath.get(followed);
      if (fromRef) {
        arrivalPath = fromRef;
      } else {
        // Reference not in our map (e.g., subroutine entry hopper) — fall back.
        const candidates = this.#stateToCandidatePaths.get(raw.state);
        arrivalPath = candidates && candidates.length > 0 ? candidates[0] : entryPath;
      }
    } else {
      // followed is a State (e.g., haltState, inline continuation). No Reference → fall back.
      const candidates = this.#stateToCandidatePaths.get(raw.state);
      arrivalPath = candidates && candidates.length > 0 ? candidates[0] : entryPath;
    }
  }
  const candidatePaths = this.#stateToCandidatePaths.get(raw.state) ?? [];
  return { ...raw, arrivalPath, candidatePaths } as MachineState;
}
```

The spread `{ ...raw, ... }` creates a fresh object per call so subsequent iterations don't accidentally see stale fields if the engine reuses the MachineState object.

- [ ] **Step 6.5: Implement the wrap in `runStepByStep()`**

```ts
override * runStepByStep({ stepsLimit = 1e5 }: { stepsLimit?: number } = {}): Generator<MachineState> {
  let prevState: State | null = null;
  let prevJsSymbol: symbol | null = null;
  const entryPath = this.#firstStepArrivalPath();

  for (const raw of super.runStepByStep({ initialState: this.#initialState, stepsLimit })) {
    const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
    prevState = raw.state;
    prevJsSymbol = this.tapeBlock.symbol([raw.currentSymbols[0]]);
    yield wrapped;
  }
}
```

Replace the existing generator body in `PostMachine.ts` (currently a one-liner delegating to `super.runStepByStep`).

- [ ] **Step 6.6: Run tests**

Run: `npx vitest run packages/machine/test/machine-state.spec.ts`
Expected: tests pass for the simple cases (un-shared states, first-step, basic subroutine + group). Some shared-state tests may fail at edge boundaries — likely candidates: continuations, halt entries, transitions across `withOverrodeHaltState` wrapper boundaries. The fallback in `#wrapMachineState` returns the canonical Path when the followed transition isn't a tracked Reference; this should keep tests passing while documenting the limitation.

If non-edge tests fail, investigate. Document failures or file follow-up issues if necessary.

- [ ] **Step 6.7: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/machine-state.spec.ts
git commit -m "Wrap run/runStepByStep callbacks with arrivalPath and candidatePaths"
```

---

## Task 7: Rename `__onPause` → `onPause`

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts` (already done in Task 6 if you used `onPause` directly)
- Modify: `packages/machine/test/debugger.spec.ts`

- [ ] **Step 7.1: Confirm Task 6 used `onPause` (not `__onPause`)**

Re-read the `run()` signature changes from Task 6. The callback param should be `onPause`, not `__onPause`. If you accidentally kept `__onPause`, rename it now.

- [ ] **Step 7.2: Update existing debugger.spec.ts tests**

In `packages/machine/test/debugger.spec.ts`, replace every occurrence of `__onPause` with `onPause`. Update the file header comment too:

```ts
// PostMachine debugger surface — async run() semantics and the onPause
// forwarding. Mirrors v3.spec.ts structure; ...
```

```ts
describe('PostMachine — onPause forwarding', () => {
  test('onPause fires when state.debug is set on a reachable state', async () => {
    // ... existing test body, but with `onPause: (s) => { ... }`
  });

  test('run() awaits an async onPause before resolving', async () => {
    // ... existing test body, but with `onPause: async () => { ... }`
  });
});
```

- [ ] **Step 7.3: Run tests**

Run: `npm test`
Expected: all tests pass — the rename is complete and existing test logic still works (semantics unchanged from v6.1.0's `__onPause`).

- [ ] **Step 7.4: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/debugger.spec.ts
git commit -m "Rename __onPause → onPause (drop experimental prefix)"
```

---

## Task 8: Document the new shape

**Files:**
- Modify: `packages/machine/README.md`
- Modify: `packages/machine/CHANGELOG.md`

- [ ] **Step 8.1: Add a "MachineState shape" subsection to README**

Locate the README's "Debugging" section (or wherever `__onPause` is currently documented). Update mentions of `__onPause` to `onPause` (drop the experimental prefix wording). Add a subsection describing the new MachineState fields:

```markdown
## MachineState shape (v6.2.0+)

PostMachine's `onStep` and `onPause` callbacks receive an extended `MachineState` with two additional fields:

| Field             | Type     | Meaning                                                                                  |
|-------------------|----------|------------------------------------------------------------------------------------------|
| `arrivalPath`     | `Path`   | The instruction path that just transitioned to the current state                          |
| `candidatePaths`  | `Path[]` | All paths whose references resolve to the current state (informational; multiple for shared states) |

These fields disambiguate state-sharing (the hash-cache dedup from v6.1.0). When two instructions produce structurally-identical transitions, they share a State; `arrivalPath` tells you which instruction the engine just transitioned through, while `candidatePaths` tells you the full sharing set.

**Example.**

\`\`\`javascript
import { PostMachine, mark, stop } from '@post-machine-js/machine';

const m = new PostMachine({
  10: mark,
  20: stop,
});

await m.run({
  onStep: (s) => {
    console.log('at:', s.arrivalPath, 'shared with:', s.candidatePaths);
  },
});
\`\`\`

The `Path` type and the `parsePath`/`formatPath` helpers are exported from `@post-machine-js/machine` — see the [Naming convention](#naming-convention) section for the path-string format.
```

- [ ] **Step 8.2: Update CHANGELOG.md with v6.2.0 entry**

Add to `packages/machine/CHANGELOG.md` above the v6.1.0 entry:

```markdown
## [6.2.0] - 2026-MM-DD

Foundation for #59 (per-instruction breakpoints) and #63 (state-by-instruction-label lookup). Extends the runtime callback shape with instruction-level context derived from the v6.1.0 naming convention.

### Added

- `MachineState` (re-exported from `@post-machine-js/machine`) now resolves to the engine's `MachineState` extended with two PostMachine-flavored fields: `arrivalPath: Path` and `candidatePaths: Path[]`. The `onStep` and `onPause` callbacks for `pm.run()` and `pm.runStepByStep()` receive the extended shape. (#70)
- New exports: type `Path`, function `parsePath(s: string): Path`, function `formatPath(p: Path): string`. The path-string format mirrors the naming convention from v6.1.0 — `'10'`, `'foo::1'`, `'50.2'`, `'outer::inner::10.2'`, etc.
- `arrivalPath` disambiguates the state-sharing UX gap noted in v6.1.0's "State sharing across structurally-identical instructions" section. When two instructions share a State, `arrivalPath` reports the specific instruction the engine just transitioned through (not the canonical first-named one).
- `candidatePaths` exposes the full set of paths sharing the current State, sorted deterministically (scope lex, then instruction index, then group inner index).

### Changed

- **BREAKING (experimental → stable)** — `__onPause` callback on `pm.run()` renamed to `onPause`. The `__` prefix was the contract that this surface might restructure without warning; #59 (the structured breakpoint API) doesn't restructure `onPause`'s shape, so the prefix is dropped. Migration: simple find/replace.

### Notes

- No engine peer-dep bump — this release ships against `@turing-machine-js/machine ^6.0.0` (unchanged).
- The `Path` type uses a `scope?: string | string[]` union so consumers can write either `{ scope: 'foo::bar', ... }` (dotted-string form) or `{ scope: ['foo', 'bar'], ... }` (array form). `parsePath` returns the array form (canonical); both are accepted by every API that takes a Path.
- For state-sharing, the canonical `candidatePaths[0]` is the canonical Path (first by scope, then instruction index); `arrivalPath` may differ when the engine arrived via a non-canonical reference.

### Migration

```diff
- await pm.run({ __onPause: handler });
+ await pm.run({ onPause: handler });
```

No other call-site changes required. Consumers reading `state`, `tape`, etc. on `MachineState` are unaffected — the new fields are additive.
```

- [ ] **Step 8.3: Update existing README references to `__onPause`**

Search the README for any mention of `__onPause` and replace with `onPause`. Likely in:
- The Debugging section.
- Any code examples using `pm.run({ __onPause: ... })`.

- [ ] **Step 8.4: Commit**

```bash
git add packages/machine/README.md packages/machine/CHANGELOG.md
git commit -m "Document MachineState extension and onPause rename for v6.2.0"
```

---

## Task 9: Doc-example tests for new README examples

**Files:**
- Modify: `packages/machine/test/examples.spec.ts`

- [ ] **Step 9.1: Pin the README's MachineState example**

In `packages/machine/test/examples.spec.ts`, add a new describe block under the existing `'packages/machine/README.md'` block:

```ts
describe('MachineState shape', () => {
  test('Example: machine.run with onStep observing arrivalPath/candidatePaths', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const observations: Array<{ arrival: string; candidates: number }> = [];
    await m.run({
      onStep: (s) => {
        observations.push({
          arrival: JSON.stringify(s.arrivalPath),
          candidates: s.candidatePaths.length,
        });
      },
    });
    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0].candidates).toBe(1);
  });
});
```

(Place after the existing `'Naming convention'` describe block.)

Add `mark` and `stop` to the imports at the top of `examples.spec.ts` if not already present.

- [ ] **Step 9.2: Run tests**

Run: `npm test`
Expected: all tests pass including the new doc-example test.

- [ ] **Step 9.3: Commit**

```bash
git add packages/machine/test/examples.spec.ts
git commit -m "Pin README MachineState example in examples.spec.ts"
```

---

## Task 10: Final verification

- [ ] **Step 10.1: Full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10.2: Coverage**

Run: `npm run test:coverage`
Expected: hits the floors in `vitest.config.ts` (95/90/95/95). The new code paths in `path.ts` and `PostMachine.ts` should be exercised by Tasks 1, 6, 7, 9 tests.

- [ ] **Step 10.3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 10.4: Build**

Run: `npm run build`
Expected: clean build; the Rollup-step warnings about `this` are pre-existing.

- [ ] **Step 10.5: Smoke test via console**

Build a small machine in a scratch file and `console.log` the wrapped MachineState fields to eyeball the output. Confirm `arrivalPath` shape (object with `instructionIndex`, optional `scope`, optional `groupInstructionIndex`) and `candidatePaths` ordering.

- [ ] **Step 10.6: Open PR**

Create branch (if not on one already), push, open PR against master:

```bash
gh pr create --title "feat: extend MachineState with arrivalPath/candidatePaths (#70)" --body "$(cat <<'EOF'
Closes #70. Foundation for #59 + #63 (next).

## Summary
- New `Path` type + `parsePath`/`formatPath` resolver.
- `MachineState` re-export extended with `arrivalPath: Path` + `candidatePaths: Path[]`.
- `run()` / `runStepByStep()` callbacks receive the extended shape.
- `__onPause` renamed to `onPause` (drop experimental prefix).

## Test plan
- [x] `npm test` — full suite green
- [x] `npm run test:coverage` — hits 95/90/95/95 floors
- [x] `npm run lint` — clean
- [x] `npm run build` — clean

Refs: docs/superpowers/plans/2026-05-17-machinestate-extension.md
EOF
)"
```

Branch name suggestion: `feat/issue-70-machinestate-extension`.

---

## Follow-up (separate branch, separate PR)

After this PR merges, the v6.2.0 release happens on a separate `v6-2-0` branch per the post-machine-js release pattern:

1. Branch from updated master: `git checkout -b v6-2-0`.
2. Bump `packages/machine/package.json` from `6.1.0` to `6.2.0`.
3. Fill CHANGELOG date.
4. Open PR, merge.
5. `cd packages/machine && npm publish` (manual).
6. `gh release create v6.2.0 --title "v6.2.0" --notes "..."` (stable release).

---

## Self-review summary

**Spec coverage (against `2026-05-17-instruction-debugger-design.md`):**

- [x] Path type with `scope?: string | string[]` union — Task 1.
- [x] `parsePath`/`formatPath` resolver with validation rules (wrapper composites, continuations, halt, leading `::`, malformed scope, malformed group) — Task 1.
- [x] Reverse map `Map<State, Path[]>` built at construction — Task 4.
- [x] Reference → Path map for arrival derivation — Task 5.
- [x] Deterministic ordering of `candidatePaths` (scope lex, then instruction index, then group inner) — Task 4 (`comparePathsCanonically`).
- [x] First-step `arrivalPath` convention — Task 6 (`#firstStepArrivalPath`).
- [x] `WrappedMachineState` returned from `run`/`runStepByStep` — Tasks 6.
- [x] `__onPause` → `onPause` rename — Task 7.
- [x] `MachineState` re-export shape — Task 3.
- [x] README + CHANGELOG updates — Task 8.
- [x] Doc-example test for README content — Task 9.

**Not in this plan (Plan B / #63+#59 territory):**

- Proxy wrap of `pm.stateAt` / `pm.initialState` / `haltState` re-export.
- `pm.setBreakpoint` / `pm.clearBreakpoint` / `pm.listBreakpoints`.
- `pm.stateAt` / `pm.hasState` / `pm.candidatesFor`.
- Registry-aware filtering in `onPause`.

**Open implementation questions (engineer to resolve):**

1. **Continuation arrival behavior.** When the engine transitions to a continuation state (the `new State({...})` inside `withOverrodeHaltState`), what does `arrivalPath` report? The continuation is reached via the wrapper's halt-override stack pop, not a Reference; `state.getNextState(prevSymbol)` from prior state wouldn't return the continuation directly. The plan defaults to graceful fallback (`candidatePaths[0]` of the resulting state). Options to revisit: (a) the wrapper's owning instruction's path, (b) the continuation's target instruction's path, (c) graceful fallback (current). Verify behavior during Task 6 testing; adjust the fallback in `#wrapMachineState` if needed.
2. **State sharing test stability.** Test cases that rely on hash dedup (Task 6 "shared state has multiple candidatePaths") need to verify that the engine deduplicates as expected for a given program. If dedup behavior changes between engine releases, these tests may need adjusting.
3. **First-step canonical path for wrapper-as-initial-state.** For programs starting with `1: call('foo')`, the initial state is a wrapper composite. Its `candidatePaths` list includes the call instruction's path (e.g., `'1'`). `#firstStepArrivalPath` returns `candidatePaths[0]` which after the deterministic sort should be the canonical (lowest scope/index) path — verify this matches user expectations for non-trivial entry instructions.
