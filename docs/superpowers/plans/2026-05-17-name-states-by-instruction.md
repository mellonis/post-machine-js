# Name PostMachine states by instruction index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace opaque `id:N` state labels in PostMachine with instruction-derived names (`"10"`, `"foo::1"`, `"50.1"`, `"foo>10~40"`), so Mermaid output, `summarize` output, and `MachineState.name` carry user-meaningful information. Foundation for #59 (per-instruction breakpoints) and #63 (state-by-instruction-label lookup) on top.

**Architecture:** Thread an `instructionPrefix: string` through `PostMachine#buildInitialState` and `CommandContext`. Pass the appropriate `name` second-arg to every `new State(...)` constructed inside PostMachine, using the prefix + instruction index. Subroutine bodies prepend `<fq-sub-name>::`; group inner states prepend `<owner-prefix><outer-idx>.`. Subroutine hoppers are named by fully-qualified subroutine name; continuations are named `<caller-fq>~<target-fq-or-halt>`. The engine's `withOverrodeHaltState` auto-composes wrapper names from outer + override names, producing readable composites like `"foo>10~40"`.

**Tech Stack:** TypeScript, Vitest, npm workspaces, `@turing-machine-js/machine` peer dep v6.

**Issue:** [#67](https://github.com/mellonis/post-machine-js/issues/67) — foundation for #59 + #63.

**Release shape:** v6.1.0 minor against engine v6 peer (unchanged). Version bump + publish lives on a separate follow-up branch per the post-machine-js release pattern.

---

## Naming convention reference

| Construct                                       | Top-level                  | Inside `foo`               | Inside `outer::inner`      |
|-------------------------------------------------|----------------------------|----------------------------|----------------------------|
| Atomic instruction at index `N`                 | `"N"`                      | `"foo::N"`                 | `"outer::inner::N"`        |
| Subroutine hopper for subroutine `sub`          | `"sub"`                    | `"foo::sub"`               | `"outer::inner::sub"`      |
| Group at instr `O`, inner index `I`             | `"O.I"`                    | `"foo::O.I"`               | `"outer::inner::O.I"`      |
| Continuation: from instr `X`, to instr `Y`      | `"X~Y"`                   | `"foo::X~foo::Y"`         | `"outer::inner::X~outer::inner::Y"` |
| Continuation: from instr `X`, tail-position     | `"X~halt"`                | `"foo::X~halt"`           | `"outer::inner::X~halt"`  |
| Call wrapper composite (engine auto-emits `>`)  | `"sub>X~Y"` / `"sub>X~halt"` | `"foo::sub>foo::X~foo::Y"` | `"outer::inner::sub>outer::inner::X~outer::inner::Y"` |
| Group wrapper composite (engine auto-emits `>`) | `"O.1>O~Y"` / `"O.1>O~halt"` | `"foo::O.1>foo::O~foo::Y"` | `"outer::inner::O.1>outer::inner::O~outer::inner::Y"` |

**Helper used throughout:** `qualifiedName(prefix, idx) === \`${prefix}${idx}\``. The `prefix` already carries its trailing separator (`""`, `"foo::"`, `"foo::50."`, etc.) so the helper is trivial.

User-provided subroutine names are constrained by `subroutineNameRegex = /^[A-Z$_][A-Z0-9$_]*$/i`, so they can't contain `:`, `.`, `>`, `~`, or `-`. The naming scheme is collision-free.

**Forward-compatibility with engine v7.** Upstream [turing-machine-js#148](https://github.com/mellonis/turing-machine-js/issues/148) plans paren-based wrapper composite naming (`A(B)` instead of `A>B`) and will likely forbid `(`, `)`, and possibly `>` in user-provided state names. The continuation separator was chosen as `~` (rather than the more visually arrow-like `->`) specifically so our names survive the engine-v7 peer bump unchanged — they contain none of v7's forbidden characters. Only the wrapper composite emit changes (from `"foo>10~40"` in v6 to `"foo(10~40)"` in v7), which is the engine's concern, not ours.

---

## File structure

- **Modify:** `packages/machine/src/commands.ts` — extend `CommandContext` with `instructionPrefix`; pass `name` to every `new State(...)` in `checkCommandStateProducer`, `makeUnaryCommandProducer`, and `callCommandStateProducer` (continuation).
- **Modify:** `packages/machine/src/classes/PostMachine.ts` — `#buildInitialState` gets an `instructionPrefix` param; subroutine hoppers are named; subroutine-body and group recursions pass the appropriate prefix; group-wrapper continuation is named.
- **Create:** `packages/machine/test/naming.spec.ts` — direct assertions on `state.name`, hopper names, continuation names, wrapper composites across top-level, subroutine, nested-subroutine, group, group-in-subroutine, tail-position scenarios.
- **Modify:** `packages/machine/test/examples.spec.ts` — tighten the two `id:N`-regex shape-pin assertions (around lines 148, 283, 285) to literal `("10")`, `("rightToBlank::1>1~halt")` etc., per #66 acceptance.
- **Modify:** `packages/machine/README.md` — add a "Naming convention" section showing what names appear in `toMermaid`/`summarize`/`onPause` and how to read composites.
- **Modify:** `packages/machine/CHANGELOG.md` — v6.1.0 entry.

No changes to `validators.ts` (`subroutineNameRegex` already constrains user names to identifiers).

---

## Task 1: Thread `instructionPrefix` plumbing (no behavior change)

**Files:**
- Modify: `packages/machine/src/commands.ts:11-21` (CommandContext type)
- Modify: `packages/machine/src/classes/PostMachine.ts:94-104` (`#buildInitialState` signature), 199-213 (CommandContext construction)

- [ ] **Step 1.1: Add `instructionPrefix` field to `CommandContext`**

Edit `packages/machine/src/commands.ts` — add the field to the `CommandContext` type (around line 11):

```ts
export type CommandContext = {
  instructionIndex: number;
  nextInstructionIndex: number | undefined;
  references: Record<string, Reference>;
  states: Map<string, State>;
  tapeBlock: TapeBlock;
  subroutineInitialStates: Record<string, State>;
  calledFromGroup: boolean;
  blankSymbol: string;
  markSymbol: string;
  instructionPrefix: string;
};
```

- [ ] **Step 1.2: Add `instructionPrefix` param to `#buildInitialState`**

Edit `packages/machine/src/classes/PostMachine.ts:94-104`:

```ts
#buildInitialState({
  instructions,
  subroutinesDataFromUpperScope = {},
  subroutineInitialStatesFromUpperScope = {},
  calledFromGroup = false,
  instructionPrefix = '',
}: {
  instructions: Instructions;
  subroutinesDataFromUpperScope?: Record<string, { reference: Reference; instructions: Instructions }>;
  subroutineInitialStatesFromUpperScope?: Record<string, State>;
  calledFromGroup?: boolean;
  instructionPrefix?: string;
}): State {
```

- [ ] **Step 1.3: Pass `instructionPrefix` into CommandContext**

Edit `PostMachine.ts:202-213` — inside the `list.forEach` loop, add `instructionPrefix` to the `context` literal:

```ts
const context: CommandContext = {
  instructionIndex: Number(instructionIndex),
  nextInstructionIndex: list[ix + 1],
  tapeBlock: this.tapeBlock,
  references,
  states,
  subroutineInitialStates,
  calledFromGroup,
  blankSymbol: this.#blankSymbol,
  markSymbol: this.#markSymbol,
  instructionPrefix,
};
```

- [ ] **Step 1.4: Run tests — no behavior change expected**

Run: `npm test`
Expected: all tests pass (the new field exists but isn't read anywhere yet).

- [ ] **Step 1.5: Commit**

```bash
git add packages/machine/src/commands.ts packages/machine/src/classes/PostMachine.ts
git commit -m "Add instructionPrefix plumbing through CommandContext and #buildInitialState"
```

---

## Task 2: Name top-level instruction states (atomic commands)

**Files:**
- Modify: `packages/machine/src/commands.ts:140-159` (checkCommandStateProducer), 170-221 (makeUnaryCommandProducer)
- Create: `packages/machine/test/naming.spec.ts` — start with top-level cases.

- [ ] **Step 2.1: Write failing tests for top-level atomic-command names**

Create `packages/machine/test/naming.spec.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  PostMachine,
  State,
  check, erase, left, mark, noop, right, stop,
} from '../src/index';

function statesByName(initial: State): Map<string, State> {
  const result = new Map<string, State>();
  const queue: State[] = [initial];
  const seen = new Set<State>();
  while (queue.length) {
    const s = queue.shift()!;
    if (seen.has(s)) continue;
    seen.add(s);
    result.set(s.name, s);
    for (const symbol of s.getSymbolList?.() ?? []) {
      const next = s.getNextStateForSymbol?.(symbol);
      if (next && next instanceof State) queue.push(next);
    }
  }
  return result;
}

describe('PostMachine — top-level instruction names', () => {
  test('atomic commands name states by instruction index', () => {
    const machine = new PostMachine({
      10: mark,
      20: right,
      30: erase,
      40: left,
      50: noop,
      60: stop,
    });
    const names = new Set<string>();
    let s: State | null = machine.initialState;
    const seen = new Set<State>();
    const queue: State[] = [s];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      names.add(cur.name);
    }
    expect(names.has('10')).toBe(true);
  });

  test('initialState has instruction-derived name (top-level "10")', () => {
    const machine = new PostMachine({ 10: stop });
    // stop returns haltState directly — first state is the next reachable named state.
    // For a single-instruction `10: stop`, initialState resolves through references to the haltState
    // forwarding state. Instead, use a multi-instruction program:
    const m2 = new PostMachine({ 10: mark, 20: stop });
    expect(m2.initialState.name).toBe('10');
  });

  test('check state names by instruction index', () => {
    const machine = new PostMachine({
      10: check(20, 30),
      20: mark,
      30: stop,
    });
    expect(machine.initialState.name).toBe('10');
  });
});
```

- [ ] **Step 2.2: Run test — verify it fails**

Run: `npx vitest run packages/machine/test/naming.spec.ts`
Expected: FAIL — names are still `id:N`.

- [ ] **Step 2.3: Implement naming in `checkCommandStateProducer`**

Edit `packages/machine/src/commands.ts` — modify `checkCommandStateProducer` to extract `instructionPrefix` and pass a name to the `new State(...)` (around line 147):

```ts
function checkCommandStateProducer(this: {
  nextInstructionIndexIfMarked: number;
  nextInstructionIndexOtherwise: number;
}, {
  instructionIndex, references, states, tapeBlock, calledFromGroup, blankSymbol, markSymbol, instructionPrefix,
}: CommandContext): State {
  // ... existing validation unchanged ...

  const hash = `:checkFn:${nextInstructionIndexIfMarked}:${nextInstructionIndexOtherwise}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
  }

  const state = new State({
    [tapeBlock.symbol([markSymbol])]: {
      nextState: references[String(nextInstructionIndexIfMarked)],
    },
    [tapeBlock.symbol([blankSymbol])]: {
      nextState: references[String(nextInstructionIndexOtherwise)],
    },
  }, `${instructionPrefix}${instructionIndex}`);

  states.set(hash, state);

  return state;
}
```

- [ ] **Step 2.4: Implement naming in `makeUnaryCommandProducer`**

Edit `packages/machine/src/commands.ts` around line 174-220 — extract `instructionPrefix` from context, pass a name to the `new State(...)` at line 215:

```ts
function makeUnaryCommandProducer(
  hashPrefix: string,
  buildCommand: ((ctx: CommandContext) => UnaryCommand) | null,
): (this: { nextInstructionIndex?: number | symbol }, ctx: CommandContext) => State {
  return function unaryCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, ctx: CommandContext): State {
    const {
      instructionIndex, nextInstructionIndex, references, states, calledFromGroup, instructionPrefix,
    } = ctx;
    // ... existing validation unchanged ...

    const transition = buildCommand === null ? { nextState } : { command: [buildCommand(ctx)], nextState };
    const state = new State({ [ifOtherSymbol]: transition }, `${instructionPrefix}${instructionIndex}`);

    states.set(hash, state);

    return state;
  };
}
```

- [ ] **Step 2.5: Run tests — verify naming tests pass, others unaffected**

Run: `npx vitest run packages/machine/test/naming.spec.ts`
Expected: PASS.

Run: `npm test`
Expected: all tests pass (existing regex shape-pin tests in `examples.spec.ts` still match — `id:N` is just one shape; literal names like `"10"` also match the same `s\d+\["\d+"\]` regex when adjusted, but the current tests use `id:\d+` literally which will FAIL — defer that to Task 7).

If existing `examples.spec.ts` tests fail, capture the failures — they will be fixed in Task 7.

- [ ] **Step 2.6: Commit**

```bash
git add packages/machine/src/commands.ts packages/machine/test/naming.spec.ts
git commit -m "Name atomic-command states by instruction index"
```

---

## Task 3: Name call-instruction continuation states

**Files:**
- Modify: `packages/machine/src/commands.ts:44-108` (callCommandStateProducer)
- Modify: `packages/machine/test/naming.spec.ts` — add call cases.

- [ ] **Step 3.1: Write failing tests for call continuation + wrapper composite names**

Append to `packages/machine/test/naming.spec.ts`:

```ts
import { call } from '../src/index';
import { State as TuringState, ifOtherSymbol } from '@turing-machine-js/machine';

describe('PostMachine — top-level call wrapper names', () => {
  test('call wrapper composite reads as "<sub>><caller>~<target>"', () => {
    const machine = new PostMachine({
      10: call('foo', 30),
      20: stop,
      30: stop,
      foo: { 1: stop },
    });
    // The initialState IS the wrapper at instruction 10.
    expect(machine.initialState.name).toBe('foo>10~30');
  });

  test('tail-position call wrapper composite uses "halt"', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo>10~halt');
  });

  test('call falling through to the next sequential instruction', () => {
    const machine = new PostMachine({
      10: call('foo'),
      20: stop,
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo>10~20');
  });
});
```

- [ ] **Step 3.2: Run tests — verify they fail**

Run: `npx vitest run packages/machine/test/naming.spec.ts -t "call wrapper"`
Expected: FAIL — wrapper composites still contain `id:N`.

- [ ] **Step 3.3: Name the continuation state in `callCommandStateProducer`**

Edit `packages/machine/src/commands.ts:99` — modify the continuation construction:

```ts
function callCommandStateProducer(this: { subroutineName: string; nextInstructionIndex: number | symbol }, {
  instructionIndex,
  nextInstructionIndex,
  references,
  states,
  subroutineInitialStates,
  calledFromGroup,
  instructionPrefix,
}: CommandContext): State {
  // ... existing logic for resolving boundNextInstructionIndex and nextState unchanged ...

  const hash = `:callFn:${subroutineName}:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
  }

  const callerName = `${instructionPrefix}${instructionIndex}`;
  const targetName = nextState === haltState
    ? 'halt'
    : `${instructionPrefix}${boundNextInstructionIndex}`;
  const continuationName = `${callerName}~${targetName}`;

  const state = subroutineInitialStates[subroutineName].withOverrodeHaltState(new State({
    [ifOtherSymbol]: {
      nextState,
    },
  }, continuationName));

  states.set(hash, state);

  return state;
}
```

- [ ] **Step 3.4: Run tests — call naming should pass, but subroutine hopper still unnamed**

Run: `npx vitest run packages/machine/test/naming.spec.ts -t "call wrapper"`
Expected: PARTIAL FAIL — the wrapper composite is now `"id:N>10~30"` (continuation named, hopper still `id:N`). The exact `"foo>10~30"` assertion will fail until Task 4 names the hopper.

That's OK; commit progress and continue.

- [ ] **Step 3.5: Commit**

```bash
git add packages/machine/src/commands.ts packages/machine/test/naming.spec.ts
git commit -m "Name call-continuation states by caller and target instructions"
```

---

## Task 4: Name subroutine hopper states and pass prefix into subroutine-body recursion

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts:136-159` (subroutine hopper + body recursion)
- Modify: `packages/machine/test/naming.spec.ts` — add subroutine body cases.

- [ ] **Step 4.1: Write failing tests for subroutine body inner names + nested subroutines**

Append to `packages/machine/test/naming.spec.ts`:

```ts
describe('PostMachine — subroutine body and hopper names', () => {
  test('subroutine inner states use fully-qualified names', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: check(3, 2),
        2: right,
        3: stop,
      },
    });
    // Wrapper composite at top — hopper should now be "foo".
    expect(machine.initialState.name).toBe('foo>10~halt');

    // The hopper is reachable via the wrapper's bare underlying graph.
    // Walk to find a state named "foo::1".
    const seen = new Set<TuringState>();
    const queue: TuringState[] = [machine.initialState];
    const namesFound = new Set<string>();
    while (queue.length) {
      const s = queue.shift()!;
      if (seen.has(s)) continue;
      seen.add(s);
      namesFound.add(s.name);
      // (Use whatever traversal API the State class exposes; pseudo-code here.)
      // For the actual implementation, prefer State.toGraph + walking the Graph,
      // or rely on summarize() output.
    }
    expect(namesFound.has('foo::1')).toBe(true);
    expect(namesFound.has('foo::2')).toBe(true);
    expect(namesFound.has('foo::3')).toBe(true);
  });

  test('nested subroutines use fully-qualified hopper names', () => {
    const machine = new PostMachine({
      10: call('outer'),
      outer: {
        1: call('inner'),
        2: stop,
        inner: { 1: stop },
      },
    });
    // Wrapper at top-level: hopper "outer".
    expect(machine.initialState.name).toBe('outer>10~halt');

    // The inner subroutine's hopper is reachable from inside outer's body.
    // The wrapper at outer::1 is "outer::inner>outer::1~outer::2".
    // Use summarize() or toGraph() to assert this.
  });
});
```

(If `State` doesn't expose a `getSymbolList`/`getNextStateForSymbol` API, use `State.toGraph(initialState, tapeBlock)` and walk the returned `Graph` instead — `graph.nodes` is a `Record<id, {name, ...}>`.)

- [ ] **Step 4.2: Run tests — verify they fail**

Run: `npx vitest run packages/machine/test/naming.spec.ts -t "subroutine body"`
Expected: FAIL — names still `id:N` or partially named.

- [ ] **Step 4.3: Name the subroutine hopper state**

Edit `packages/machine/src/classes/PostMachine.ts:136-146`:

```ts
const subroutineInitialStates: Record<string, State> = {
  ...subroutineInitialStatesFromUpperScope,
  ...Object.keys(localSubroutinesData).reduce<Record<string, State>>((result, subroutineName) => ({
    ...result,
    [subroutineName]: new State({
      [ifOtherSymbol]: {
        nextState: localSubroutinesData[subroutineName].reference,
      },
    }, `${instructionPrefix}${subroutineName}`),
  }), {}),
};
```

- [ ] **Step 4.4: Pass prefix into subroutine-body recursion**

Edit `PostMachine.ts:148-159`:

```ts
Object.keys(localSubroutinesData).forEach((subroutineName) => {
  const {
    reference,
    instructions: subroutineInstructions,
  } = subroutinesData[subroutineName];

  reference.bind(this.#buildInitialState({
    instructions: subroutineInstructions,
    subroutinesDataFromUpperScope: subroutinesData,
    subroutineInitialStatesFromUpperScope: subroutineInitialStates,
    instructionPrefix: `${instructionPrefix}${subroutineName}::`,
  }));
});
```

- [ ] **Step 4.5: Run tests — subroutine cases should pass**

Run: `npx vitest run packages/machine/test/naming.spec.ts`
Expected: PASS for subroutine body and hopper. The "tail-position call" and "call falling through" tests from Task 3 should now also pass (wrapper composite is `"foo>10~halt"` etc.).

- [ ] **Step 4.6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/naming.spec.ts
git commit -m "Name subroutine hoppers and body states with fully-qualified prefix"
```

---

## Task 5: Pass prefix into group recursion and name group-wrapper continuation

**Files:**
- Modify: `packages/machine/src/classes/PostMachine.ts:215-253` (group handling)
- Modify: `packages/machine/test/naming.spec.ts` — add group cases.

- [ ] **Step 5.1: Write failing tests for group inner names and group wrapper composite**

Append to `packages/machine/test/naming.spec.ts`:

```ts
describe('PostMachine — group states and wrapper composite', () => {
  test('group inner states use "<outer>.<inner>" naming', () => {
    const machine = new PostMachine({
      50: [right, mark, erase],
      60: stop,
    });
    // The initialState is the group wrapper at instr 50.
    // Composite name: "50.1>50~60".
    expect(machine.initialState.name).toBe('50.1>50~60');

    // Walking the graph reveals "50.1", "50.2", "50.3", "50~60", "60".
    // Assert via State.toGraph + scanning graph.nodes for names.
  });

  test('tail-position group wrapper uses "halt" continuation target', () => {
    const machine = new PostMachine({
      50: [right, mark],
    });
    expect(machine.initialState.name).toBe('50.1>50~halt');
  });

  test('group inside a subroutine uses fully-qualified prefix', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: [right, mark],
        2: stop,
      },
    });
    // Inside foo, the group at foo::1 produces inner "foo::1.1", "foo::1.2"
    // and a wrapper composite "foo::1.1>foo::1~foo::2".
    // Assert via State.toGraph.
  });
});
```

- [ ] **Step 5.2: Run tests — verify they fail**

Run: `npx vitest run packages/machine/test/naming.spec.ts -t "group"`
Expected: FAIL.

- [ ] **Step 5.3: Pass prefix into group recursion**

Edit `packages/machine/src/classes/PostMachine.ts:226-235`:

```ts
const groupState = this.#buildInitialState({
  instructions: instruction.reduce<Instructions>((result, command, commandIndexInTheGroup) => ({
    ...result,
    [commandIndexInTheGroup + 1]: command,
  }), {}),
  subroutinesDataFromUpperScope: subroutinesData,
  subroutineInitialStatesFromUpperScope: subroutineInitialStates,
  calledFromGroup: true,
  instructionPrefix: `${instructionPrefix}${instructionIndex}.`,
});
```

- [ ] **Step 5.4: Name the group wrapper continuation**

Edit `packages/machine/src/classes/PostMachine.ts:237-249`:

```ts
let nextState: State | Reference;

if (list[ix + 1] == null) {
  nextState = haltState;
} else {
  nextState = references[String(list[ix + 1])];
}

const callerName = `${instructionPrefix}${instructionIndex}`;
const targetName = nextState === haltState
  ? 'halt'
  : `${instructionPrefix}${list[ix + 1]}`;
const continuationName = `${callerName}~${targetName}`;

builtStates.set(String(instructionIndex), groupState.withOverrodeHaltState(new State({
  [ifOtherSymbol]: {
    nextState,
  },
}, continuationName)));
```

- [ ] **Step 5.5: Run tests — group cases should pass**

Run: `npx vitest run packages/machine/test/naming.spec.ts -t "group"`
Expected: PASS.

Run: `npm test`
Expected: all `naming.spec.ts` tests pass. Existing `examples.spec.ts` regex shape-pin tests targeting `id:N` will fail (Task 7 fixes).

- [ ] **Step 5.6: Commit**

```bash
git add packages/machine/src/classes/PostMachine.ts packages/machine/test/naming.spec.ts
git commit -m "Name group inner states and wrapper continuations"
```

---

## Task 6: Integration scenarios — call-inside-subroutine, group-inside-subroutine, deep nesting

**Files:**
- Modify: `packages/machine/test/naming.spec.ts` — add combined-scenario tests.

- [ ] **Step 6.1: Write tests covering combined scenarios**

Append to `packages/machine/test/naming.spec.ts`:

```ts
describe('PostMachine — combined naming scenarios', () => {
  test('call inside subroutine — both call site and target are fq-prefixed', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: call('bar'),
        2: stop,
        bar: { 1: stop },
      },
    });
    // Use State.toGraph to find the wrapper composite inside foo.
    // Expected: "foo::bar>foo::1~foo::2".
    // ... assert via graph traversal.
  });

  test('group inside subroutine — inner indices namespaced', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: [right, mark],
        2: stop,
      },
    });
    // Expected names inside foo: "foo::1.1", "foo::1.2", continuation "foo::1~foo::2",
    // group wrapper composite "foo::1.1>foo::1~foo::2".
    // ... assert via graph traversal.
  });

  test('tail call inside subroutine — continuation forwards to halt', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: call('bar'),
        bar: { 1: stop },
      },
    });
    // Wrapper at foo::1: "foo::bar>foo::1~halt".
    // ... assert via graph traversal.
  });
});
```

Pick a robust traversal API: use `State.toGraph(machine.initialState, machine.tapeBlock)` and inspect `graph.nodes` (a `Record<id, { name, ... }>`). Collect all names into a `Set` and assert membership.

- [ ] **Step 6.2: Run all naming tests**

Run: `npx vitest run packages/machine/test/naming.spec.ts`
Expected: all pass.

- [ ] **Step 6.3: Run the full suite (except #66 doc-tests which will be fixed next)**

Run: `npm test`
Expected: only `packages/machine/test/examples.spec.ts` tests that pin `id:N` literally fail. All other tests pass.

- [ ] **Step 6.4: Commit**

```bash
git add packages/machine/test/naming.spec.ts
git commit -m "Add integration tests for combined naming scenarios"
```

---

## Task 7: Tighten #66 doc-tests from regex shape-pinning to literal names

**Files:**
- Modify: `packages/machine/test/examples.spec.ts:148, 283, 285` (the `id:\d+` regex assertions).

- [ ] **Step 7.1: Read the existing regex shape-pin assertions**

Run: `grep -n "id:\\\\d" packages/machine/test/examples.spec.ts`
Expected: three matches at approximately lines 148, 283, 285.

- [ ] **Step 7.2: Determine the literal names for the README's Quick Start example**

The Quick Start example (used at lines 130-160) builds:
```ts
new PostMachine({
  rightToBlank: {
    1: right,
    2: check(1, 3),
    3: stop,
  },
  1: call('rightToBlank'),
  2: mark,
  3: stop,
});
```

Expected literal names:
- Top-level instructions: `"1"`, `"2"`, `"3"`
- Subroutine body: `"rightToBlank::1"`, `"rightToBlank::2"`, `"rightToBlank::3"`
- Subroutine hopper: `"rightToBlank"`
- Wrapper at top instr 1 (call falls through to instr 2): composite `"rightToBlank>1~2"`
- Wrapper's continuation: `"1~2"`

For the second example (lines 268-285), inspect the program at that location and derive analogous names.

- [ ] **Step 7.3: Replace regex shape-pin with literal assertions**

At `packages/machine/test/examples.spec.ts:148`, replace:
```ts
expect(mermaid).toMatch(/s\d+\(\("id:\d+>id:\d+"\)\)/);
```
with:
```ts
expect(mermaid).toMatch(/s\d+\(\("rightToBlank>1~2"\)\)/);
```

At lines 283-285, replace:
```ts
expect(mermaid).toMatch(/s\d+\(\("id:\d+"\)\)/);
expect(mermaid).toMatch(/s\d+\["id:\d+"\]/);
```
with literal-name versions matching the program at that test (derive from the source program around line 268).

- [ ] **Step 7.4: Update the comments above each tightened assertion**

Replace the `// (id:N>id:M shape — ...)` comment lines with notes describing the new deterministic literal names.

- [ ] **Step 7.5: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7.6: Commit**

```bash
git add packages/machine/test/examples.spec.ts
git commit -m "Tighten Mermaid shape-pin tests to literal instruction-derived names"
```

---

## Task 8: README and CHANGELOG updates

**Files:**
- Modify: `packages/machine/README.md`
- Modify: `packages/machine/CHANGELOG.md`

- [ ] **Step 8.1: Add a "Naming convention" section to packages/machine/README.md**

Add a section after the existing "Subroutine" or "Visualization" section. Content outline:

```markdown
### Naming convention (v6.1.0+)

PostMachine names every state it constructs by instruction index, so `toMermaid` output, `summarize` output, and `MachineState.name` carry user-meaningful information. The previous `id:N` labels (engine-default auto-counters) are gone.

**Rules:**

| Construct                                       | Top-level                  | Inside subroutine `foo`    |
|-------------------------------------------------|----------------------------|----------------------------|
| Atomic instruction at index `N`                 | `"N"`                      | `"foo::N"`                 |
| Subroutine hopper                               | `"sub"`                    | `"foo::sub"`               |
| Group at instr `O`, inner index `I`             | `"O.I"`                    | `"foo::O.I"`               |
| Continuation: from `X` to `Y`                   | `"X~Y"`                   | `"foo::X~foo::Y"`         |
| Continuation: tail-position                     | `"X~halt"`                | `"foo::X~halt"`           |
| Call wrapper composite (engine auto-emits `>`)  | `"sub>X~Y"`               | `"foo::sub>foo::X~foo::Y"` |
| Group wrapper composite                         | `"O.1>O~Y"`               | `"foo::O.1>foo::O~foo::Y"` |

**Separators in user-meaningful labels:**
- `::` — subroutine scope (lexical nesting).
- `.` — group inner-step ordinal.
- `~` — continuation: "this state forwards from wrapper at X back to the next instruction Y".
- `>` — engine-internal `withOverrodeHaltState` composition (outer state + override override).

User-provided subroutine names are constrained to identifier characters (`/^[A-Z$_][A-Z0-9$_]*$/i`), so none of these separators can collide with user input.

**Reading a wrapper composite:** `"foo>10~40"` decomposes as:
- Outer (left of `>`): `"foo"` — the subroutine entry hopper.
- Override (right of `>`): `"10~40"` — the continuation state that runs after the wrapped subroutine halts. It reads "from call site at instruction 10, forwards to instruction 40".

If the call is in tail position (last instruction in its scope), the continuation forwards to `haltState`, named `"X~halt"`.

**Example:**

\`\`\`ts
const m = new PostMachine({
  10: call('foo', 30),
  20: stop,
  30: stop,
  foo: { 1: stop },
});
// machine.initialState.name === "foo>10~30"
\`\`\`
```

- [ ] **Step 8.2: Update CHANGELOG**

Add to `packages/machine/CHANGELOG.md` (new entry at the top, above v6.0.0):

```markdown
## v6.1.0 (2026-MM-DD)

### Added

- All states constructed inside `PostMachine#buildInitialState` now carry an instruction-derived `name`. Previously every state was labeled `id:N` (engine-default auto-counter); now top-level instructions are labeled `"N"`, subroutine body instructions `"<sub>::N"`, group inners `"<outer>.<inner>"`, continuation states `"<caller>~<target>"`, and `withOverrodeHaltState` wrappers compose to e.g. `"foo>10~30"`. (#67)
- This makes `toMermaid` / `summarize` / `MachineState.name` readable without an external translation step, and gives downstream features (#59 per-instruction breakpoint API, #63 public state-by-instruction-label lookup) a deterministic foundation to look up states by user-meaningful labels.

### Changed

- Doc-tests in `packages/machine/test/examples.spec.ts` previously used regex shape-pinning (`s\d+\("id:\d+"\)`) because state IDs were a global counter and shifted depending on test order. Now that names are deterministic, those assertions pin literal labels (`"rightToBlank>1~2"` etc.).

### Notes

- No engine peer-dep bump — this release ships against `@turing-machine-js/machine ^6.0.0` (unchanged).
- The `id:N` → instruction-derived naming changes the Mermaid output's `name` strings. Consumers parsing those strings (e.g. comparing `state.name === "some>composite"` literally) need to update their expectations.
- Round-trip name accumulation with `withOverrodeHaltState` (upstream [turing-machine-js#138](https://github.com/mellonis/turing-machine-js/issues/138) / [#139](https://github.com/mellonis/turing-machine-js/issues/139)) is more visible now because composite names are user-meaningful (`"foo>10~20>20"` reads as "the wrapper's inner accumulated `>20` twice through a round-trip"). The upstream fix lands in engine v7.
```

- [ ] **Step 8.3: Commit**

```bash
git add packages/machine/README.md packages/machine/CHANGELOG.md
git commit -m "Document naming convention and add CHANGELOG v6.1.0 entry"
```

---

## Task 9: Final verification

- [ ] **Step 9.1: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 9.2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9.3: Run coverage**

Run: `npm run test:coverage`
Expected: hits the floors set in `vitest.config.ts` (95/90/95/95).

- [ ] **Step 9.4: Build**

Run: `npm run build`
Expected: clean build; the new `name` second-args don't affect the public API surface.

- [ ] **Step 9.5: Smoke-test by hand**

Build a small machine in a scratch test and `console.log(toMermaid(State.toGraph(machine.initialState, machine.tapeBlock)))` to eyeball the output. Confirm names look right.

- [ ] **Step 9.6: Open PR**

Push branch and open PR against master. PR description should reference issue #67 and quote the Acceptance checklist from the issue, marking each item with the implementing task.

---

## Follow-up (separate branch, separate PR)

After the feature PR merges, the v6.1.0 release happens on a separate `v6-1-0` branch per the post-machine-js release pattern:

1. Branch from updated master: `git checkout -b v6-1-0`.
2. Bump `packages/machine/package.json` from `6.0.0` to `6.1.0`. Update CHANGELOG date if needed.
3. Update root `package.json` version-tracking if applicable (check existing v6.0.0 bump commit for the exact files).
4. Open PR, merge.
5. After merge: `cd packages/machine && npm publish` (manual).
6. `gh release create v6.1.0 --title "v6.1.0" --notes "..."` (stable release, not prerelease).

---

## Self-review summary

**Spec coverage** (issue #67 Acceptance):

- [x] "All states constructed inside `PostMachine#buildInitialState` carry an instruction-derived `name`." — Tasks 2-5.
- [x] "Subroutine-local instruction indices namespaced by subroutine name." — Task 4.
- [x] "`withOverrodeHaltState` wrappers produce composite names that read as `<outer-name>><inner-name>` instead of `id:N>id:M`." — Tasks 3 + 5 (engine auto-composes; we name both sides).
- [x] "Existing tests continue to pass (regex shape pinning still matches; literal-ID assertions, if any, get updated to use the new names)." — Task 7.
- [x] "One new test pins the new Mermaid output for the Quick Start example with literal `("10")` etc., now that determinism is restored." — Task 7 covers the README's Quick Start tests.

**Design decisions** (all decided in plan-writing conversation, per Q1-Q8):

- Architecture: X-variant (shared subroutine hopper, call-site identity encoded into continuation name).
- Subroutine separator: `::`.
- Group separator: `.`.
- Continuation arrow: ASCII `~`.
- Nested subroutines: fully-qualified names.
- First group inner: with `.1` suffix.
- Optional `name` constructor arg: deferred to a separate issue.
- Engine peer: v6 (no bump).
- #66 doc-tests: tightened in same PR.

**Not in this plan:**

- Optional `name` constructor arg for per-instance prefixing (deferred).
- Engine v7 peer bump and `withOverrodeHaltState` rename (separate post v7.0.0).
- Upstream #138 / #139 fixes (engine concern, soft prerequisite — does not block this work).
- Issue #59 (per-instruction breakpoint API) and #63 (public state-by-instruction-label lookup) — depend on this plan landing first; they get their own plans.