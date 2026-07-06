# @post-machine-js/machine

[![build](https://github.com/mellonis/post-machine-js/actions/workflows/main.yml/badge.svg?branch=master)](https://github.com/mellonis/post-machine-js/actions/workflows/main.yml)
![npm (scoped)](https://img.shields.io/npm/v/@post-machine-js/machine)

A Post machine — a 2-symbol Turing-machine variant with a numbered-instruction program model — built on top of `@turing-machine-js/machine`.

<details>
<summary>Table of contents</summary>

- [Install](#install)
- [Quick start](#quick-start)
- [Classes](#classes) — [`PostMachine`](#postmachine) · [`Tape`](#tape)
- [Constants](#constants)
- [Custom symbols](#custom-symbols)
- [Commands](#commands) — [Classical](#classical-commands) · [Author's extensions](#authors-extensions) · [Scope rules](#scope-rules-for-indexed-forms)
- [Grouped instructions](#grouped-instructions)
- [Subroutines](#subroutines)
- [MachineState shape](#machinestate-shape)
- [Naming convention](#naming-convention)
- [Tags](#tags) — [`$tag` decorator](#inline-tag-decorator) · [Registry](#post-construction-registry) · [Auto-tag policy](#auto-tag-policy) · [Mermaid output](#mermaid-output)
- [Introspection and equivalence](#introspection-and-equivalence) — [Visualization](#visualization--tomermaid--statetograph) · [Structural summary](#structural-summary--summarizepostmachine) · [Behavioral equivalence](#behavioral-equivalence--equivalentpostmachines)
- [Breakpoints](#breakpoints)
- [Links](#links)

</details>

## Install

`@post-machine-js/machine` declares `@turing-machine-js/machine` as a **peer dependency**, so both share a single instance of the upstream engine. The upstream library has runtime singletons (`haltState`, `ifOtherSymbol`, and the `Symbol`-keyed `movements` constants) whose identity is checked at runtime; duplicate copies in the bundle would break those checks.

```sh
npm install @turing-machine-js/machine @post-machine-js/machine
```

## Quick start

The Post machine alphabet has only two symbols — blank (` `) and mark (`*`). A program is a numbered map of instructions. The example below walks the head right while the cell under it is marked, then writes a mark on the first blank it finds:

```javascript
import { PostMachine, check, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: check(20, 30),  // marked → go to 20 (step right); blank → go to 30 (mark)
  20: right(10),      // step right, then re-check at 10
  30: mark,           // write '*'; falls through to 40
  40: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', ' '],
}));

machine.run();
console.log(machine.tape.symbols.join('').trim()); // ***
```

Each instruction is a command. Used bare (`mark`, `right`, `erase`), it falls through to the next numbered instruction; called with an index (`mark(20)`), it jumps to instruction `20`. `check(ix1, ix0)` branches — `ix1` if the current cell is marked, else `ix0`. `stop` halts.

The state graph for the example above (`toMermaid(State.toGraph(machine.initialState, machine.tapeBlock))`):

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>main"]
  u2["20"]
  u3["30"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "['*'] → [K]/[S]" --> u2
  u1 -- "[B] → [K]/[S]" --> u3
  u2 -- "[*] → [K]/[R]" --> u1
  u3 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

Reading the diagram:

**Nodes.** Each `s\d+` is a Mermaid-internal node ID; the bracketed/parenthesized text is the state's display label. `s0` is always `haltState`. Node shapes:
- `(((label)))` — halt state
- `["label"]` — intermediate (and now also entry) state
- `([idle])` — the `idle` sentinel that marks the entry point via a dotted `idle -. enter .-> s_initial` edge
- (Wrappers produced by `withOverriddenHaltState` use a `[[bare(continuation)]]` double-square node. Top-level wrappers sit OUTSIDE their callable subtree's `subgraph w_N["callable subtree of NAME"]` block; wrappers whose continuation chain participates in a caller's frame render INSIDE the owner frame's subgraph with the same `[[…]]` shape — see the [Subroutines](#subroutines) section.)

The labels are PostMachine's instruction-derived names — `"10"`, `"20"`, `"30"` map directly to the instruction indices in the program. The wrapper composite shape (`"<outer>(<continuation>)"`) doesn't appear in this example because there are no calls or groups; see the [Subroutines](#subroutines) section for that. The `40: stop` instruction is elided — `stop` halts the machine, so the transition from `30: mark` flows straight to halt rather than through an intermediate state.

**Edges.** Compact `read → write/move` syntax with bracketed tokens:
- **Read side**: `['*']` is the literal mark symbol; `[B]` is the blank symbol; `[*]` is `ifOtherSymbol` — the any-other catch-all (or sole-edge match-all on a state with only one outgoing transition).
- **Write side**: `[K]` is "keep" (no write); `[E]` is "erase" (write the blank); `['*']` (and `[' ']` for blank) is a literal symbol write.
- **Move**: `[S]` = stay, `[L]` = left, `[R]` = right.

## Classes

### PostMachine

The runtime. Subclasses `TuringMachine` from `@turing-machine-js/machine`: the constructor walks the numbered instruction list, materializes a state graph using the upstream `State` and `Reference` primitives, and runs it. Subroutines are introduced by adding string-keyed groups to the program (see [Subroutines](#subroutines) below).

**Constructor.** `new PostMachine(instructions, options?)` — `instructions` is the numbered-instruction map (with optional string-keyed subroutine groups); `options` is `{ blankSymbol?, markSymbol? }` (see [Custom symbols](#custom-symbols)).

**Methods.**
- `run({ stepsLimit? } = {})` → `RunResult`. Runs to termination or until `stepsLimit` (default `1e5`) is exhausted, then returns the engine's call-scoped `RunResult`: `{ outcome: 'halted' | 'aborted', state, stack, step }` (re-exported from `@post-machine-js/machine`; **v7.1**, adopting the engine v7.1 run-outcome surface). `outcome` is `'halted'` for a normal `stop` / fall-through ending (`stack` is `[]` by construction — every subroutine/group frame already popped) or `'aborted'` when an `abort` instruction punched through to the run (`stack` is the frozen backtrace of continuations `abort` short-circuited past — see [Author's extensions](#authors-extensions)). `state` is the State whose transition triggered the outcome; `state.name` is PostMachine's instruction-derived name (see [Naming convention](#naming-convention)) — with one caveat: two or more `abort` instructions in the *same scope* share one cached State (the unary-command caching convention), so `state.name` reports the first-built of them. The final iteration's `arrivalPath` always identifies the actual abort site — prefer it for abort-site reporting. `step` is the 1-based iteration count at termination. **Synchronous and callback-free as of v7.0.0-alpha.6** (adopting the engine's debug-surface reshape) — for per-step observation use `runStepByStep()`; for breakpoints, throttling, or interactive stepping use `debugRun()`.
- `debugRun({ stepsLimit? } = {})` → `PostDebugSession`. An interactive debugger session bound to this machine (see [Breakpoints](#breakpoints)). It emits `pause` / `step` / `iter` / `halt` / `abort` events (`session.on(event, listener)`) and exposes `continue()` / `stepIn()` / `stepOver()` / `stepOut()` / **`stepInstruction()`** / `pause()` / `stop()` / `setRunInterval(ms)`; call `await session.start()` to begin. `pause`-event payloads carry `m.pause: { side: 'before' | 'after', cause: 'breakpoint' | 'step' | 'manual' }`. `halt` and `abort` are the two mutually-exclusive terminal events — a run fires exactly one of the two, never both — and **both** carry the same `RunResult` payload `run()` returns (additive for `halt`, which previously fired with no arguments). Pausing right before the `abort` event: `abortState.debug = true` (boolean, mirrors `haltState.debug`) or `pm.setBreakpoint(abortState, filter)` arms a pause on the AFTER side of the iter whose transition targets `abortState` — see [Breakpoints](#breakpoints). **`stepInstruction()` (v7.0.0-alpha.7)** is the Post-level program-counter step — advance to the next numbered instruction in the *current* scope; skips sub-step transitions inside groups (`50.1 → 50.2`) and descents into called scopes (`call('foo') → foo::1`) because those aren't numbered instructions in your program. Two rules cover the whole semantics: (1) advance until the click-time `(scope, instructionIndex)` pair changes; (2) if there's no next numbered instruction in the current scope, the natural engine continuation fires (return to caller's continuation inside a call/group, halt at top level). Throws if no paused state.
- `runStepByStep({ stepsLimit? } = {})` → `Generator<MachineState, RunResult>`. Synchronous step-at-a-time execution; the consumer drives the loop with `for ... of` or `.next()`. Pure iteration — it does no breakpoint detection (that lives in `debugRun()`). The generator's `return` value is the same `RunResult` `run()` returns — a `for...of` loop discards it (that's how JS generators work), so drain manually (a `while (!r.done)` / `.next()` loop) if you need the terminal outcome from step-by-step iteration.
- `replaceTapeWith(newTape)` — swap the active tape. Build the new tape against `machine.tape.alphabet` so symbol identities match the machine's interned alphabet.

**Properties.**
- `tape` — the active `Tape`. Equivalent to `tapeBlock.tapes[0]`.
- `tapeBlock` — the upstream `TapeBlock` wrapping `tape`. Pass to upstream utilities (`State.toGraph`, `summarize`, `equivalentOn`) when reaching past PostMachine.
- `initialState` — the entry `State` of the assembled state graph. Pass alongside `tapeBlock` to the upstream graph utilities.

### Tape

Reexported from `@turing-machine-js/machine`. Post machine tapes use a 2-symbol alphabet — `' '` / `'*'` by default, but **the two glyphs are configurable per machine instance** (see [Custom symbols](#custom-symbols)). Whatever pair you pass in becomes the blank/mark for that machine; `mark`, `erase`, `check`, and the engine's `Tape` all read those glyphs from the per-instance alphabet at build time. Useful for rendering / visualization (e.g. the `demo.machines.mellonis.ru` interactive playground lets users choose any two characters, then runs the machine against tapes built on that alphabet), interop with other tape formats, or didactic clarity.

Always build initial tapes against `machine.tape.alphabet` so the symbol identities match the machine's interned alphabet — even when you're using the defaults, since `Alphabet` instances aren't structurally interchangeable.

## Constants

The default values used by new PostMachine instances. Custom-symbol machines (see [Custom symbols](#custom-symbols)) override them at the per-instance level — reach for `machine.tape.alphabet.blankSymbol` and friends when you need the *active* glyphs for a specific machine. The module-level exports are useful for code that wants the canonical defaults without instantiating.

* `alphabet` — the default `Alphabet` instance for Post-machine tapes (` `, `*`).
* `blankSymbol` — the default blank symbol, ` ` (space).
* `markSymbol` — the default mark symbol, `*`.

## Custom symbols

The Post machine semantics are independent of which two characters represent blank and mark. Pass an options object as the second constructor argument to swap the glyphs — useful for rendering, interop with other formats, or didactic clarity. Both must be single characters and distinct from each other; passing neither (or `undefined` / `null`) falls back to the defaults.

```javascript
import { PostMachine, check, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine(
  {
    10: check(20, 30),
    20: right(10),
    30: mark,
    40: stop,
  },
  { blankSymbol: '.', markSymbol: '#' },
);

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['#', '#', '.'],
}));

machine.run();
console.log(machine.tape.symbols.join('').replace(/\.+$/, '')); // ###
```

`mark`, `erase`, and `check` read the chosen symbols from the per-instance alphabet at build time; subroutines and grouped instructions inherit the same alphabet. Build the initial tape against `machine.tape.alphabet` (as in the snippet above) so your tape symbols are validated against the same alphabet the machine was built with.

## Commands

Each command has two forms: **bare** (`mark`) — falls through to the next position in its containing scope (the next numbered instruction in the map, or the next item in an [array group](#grouped-instructions)); or **with an explicit index** (`mark(20)`) — jumps to instruction `20`. The bare form is what you use when "next entry in this scope" is what you want; the indexed form is for back-edges, branches, and explicit jumps. A `—` in either form column means that form doesn't exist for that command.

Two commands break that callable pattern: `stop` and `abort` have no parameterized form at all — the only legal use of either was always bare — so they're exported as non-callable `unique symbol` **tokens** (the same shape as the upstream engine's `ifOtherSymbol` sentinel), not functions. Writing `stop()` or `abort(20)` throws a native `TypeError`, same as calling any other non-function value; a token makes the illegal call-form unrepresentable instead of merely guarded. Every command that DOES have an indexed form (`mark`, `erase`, `left`, `right`, `noop`, `call`, `check`) stays a function — calling it (bare or indexed) is what produces the bound state-producer PostMachine consumes.

The first table is the **canonical instruction set** of a Post(–Turing) machine per Post's 1936 paper. The second is **the author's extensions** added on top of the classical machine in this implementation — subroutines (`call`), a placeholder (`noop`), and machine-wide abnormal termination (`abort`); all three are conveniences, not part of the original specification.

### Classical commands

| Command | Bare form | Indexed form | Behavior |
|---|---|---|---|
| `check` | — | `check(ix1, ix0)` | Branch on the current cell: marked → instruction `ix1`, blank → instruction `ix0` |
| `erase` | `erase` | `erase(ix)` | Write the blank symbol; fall through / jump to `ix` |
| `left` | `left` | `left(ix)` | Move the head left; fall through / jump to `ix` |
| `mark` | `mark` | `mark(ix)` | Write the mark symbol; fall through / jump to `ix` |
| `right` | `right` | `right(ix)` | Move the head right; fall through / jump to `ix` |
| `stop` | `stop` | — | Halt the machine — inside a subroutine, this *returns* to the caller (the call site's continuation) rather than ending the whole run; `stop` is illegal inside a [group](#grouped-instructions) (see below) |

`check` requires both branch targets so has no bare form; `stop` always halts (or returns — see above) so has no indexed form, and (per the token note above) no callable form of any kind.

### Author's extensions

| Command | Bare form | Indexed form | Behavior |
|---|---|---|---|
| `call` | `call(name)` | `call(name, ix)` | Invoke subroutine `name`; fall through / jump to `ix` afterwards |
| `noop` | `noop` | `noop(ix)` | Do nothing; fall through / jump to `ix` |
| `abort` | `abort` | — | End the *entire run* immediately, from any depth |

`call` and the [Subroutines](#subroutines) feature add procedure-like reuse to the classical numbered-instruction model. `noop` is the placeholder of choice: useful for reserving instruction numbers in a worked example, padding a sketch, or as a labelled jump target. (Bare `noop` has no classical analog; `noop(ix)` corresponds to Post's unconditional jump.)

`abort` is machine-wide abnormal termination. Where `stop` only ends the *current* scope (the top-level program, or — inside a subroutine — just that call, returning to whatever invoked it), `abort` ends the run outright, no matter how deep the call stack is: `run()`'s `RunResult.outcome` becomes `'aborted'`, and `RunResult.stack` carries the frozen backtrace of continuations `abort` short-circuited past — the subroutine/group frames that were pending when it fired, preserved rather than popped (see [`run()`](#postmachine) below). Because `abort` never resolves to a continuation, there's no "where do I go next" ambiguity for it to trip over — which is exactly why `abort` is legal inside a [group](#grouped-instructions), where `stop` is not (a group has its own fall-through continuation that `stop`'s classical "halt right here" meaning conflicts with; `abort` isn't going anywhere, so there's no conflict to have). Like every other instruction, `abort` produces its own named per-instruction `State` — so executing it costs one iteration (`RunResult.step` counts it same as any other instruction); it isn't a zero-cost escape hatch.

### Scope rules for indexed forms

The `ix` in any indexed form (`mark(ix)`, `erase(ix)`, `noop(ix)`, `left(ix)`, `right(ix)`, `check(ix1, ix0)`, and `call(name, ix)`'s second arg) always references **the scope the call is written in** — top-level when at the top of the instructions map, the surrounding [subroutine](#subroutines)'s local indices when inside a subroutine body. The post engine resolves indexed jumps lexically; there is no implicit jump to top-level from inside a subroutine.

`call(name)`'s `name` argument is resolved by walking the **lexical scope chain from the current scope outward**, first match wins. Subroutines can nest (a subroutine body may itself contain string-keyed subroutines), and `call('foo')` from inside `outer` finds `outer.foo` before checking the top-level program. This mirrors how identifiers resolve in lexically-scoped languages.

| Construct | Scope of the literal arg |
|---|---|
| Top-level `mark(20)` | top-level instruction indices |
| Inside `subA`: `mark(2)` | `subA`'s local indices |
| Top-level `call('foo')` | searches top-level subroutines |
| Inside `subA`: `call('foo')` | searches `subA`'s local subroutines first, then walks outward to top-level |
| Inside `subA`: `call('foo', 5)` | second arg `5` is in `subA`'s local indices (where to jump after `foo` returns) |

The [Subroutines](#subroutines) section shows nesting and call-site examples; the canonical path notation (`foo::bar::1`) reflects this lexical nesting directly.

<details>
<summary><code>noop</code> in the graph — fall-through and unconditional jump</summary>

```javascript
const machine = new PostMachine({
  10: mark,
  20: noop,
  30: mark,
  40: stop,
});
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>main"]
  u2["20"]
  u3["30"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "[*] → ['*']/[S]" --> u2
  u2 -- "[*] → [K]/[S]" --> u3
  u3 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

`u2` is the noop. Its single outgoing edge `[*] → [K]/[S]` is the signature: read anything, keep the cell (`K`, no write), stay in place (`S`, no move) — then fall through to instruction 30. The marks at `u1` and `u3` write `'*'` and move stay; the structural difference between a "useful" command and `noop` is the write cell (`'*'` vs `K`).

Indexed form `noop(40)` rewires the fall-through to instruction 40 — Post's unconditional jump:

```javascript
const machine = new PostMachine({
  10: noop(40),
  20: mark,
  30: mark,
  40: stop,
});
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>main"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "[*] → [K]/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

Instruction `10` jumps directly to `40` (the trailing stop). Instructions `20` and `30` are unreachable — they don't appear in the graph at all. (`toGraph` only emits reachable states; unreachable ones are silently dropped.)

</details>

<details>
<summary>Trailing <code>stop</code> doesn't get its own node</summary>

```javascript
const machine = new PostMachine({
  10: mark,
  20: stop,
});
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>main"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

Notice: no separate node for instruction `20`. `stop` halts the machine, so `u1` (`10: mark`) transitions directly to `s0(((halt)))` — there's no intermediate state for the `stop` instruction. The trailing `stop` is **elided** in the structural emit: it's a halt routing convention, not a State.

The lookup API is asymmetric in a useful way — `pm.stateAt({ instructionIndex: 20 })` for this machine resolves to `haltState` (the canonical halt singleton), not `undefined`. The graph doesn't render a node for `20`, but the path still resolves.

</details>

<details>
<summary><code>abort</code> — ends the run immediately, from any depth</summary>

```javascript
import { PostMachine, abort, check, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: check(20, 30),
  20: abort,
  30: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*'],
}));

const result = machine.run();
console.log(result.outcome);      // 'aborted'
console.log(result.state.name);   // '20'
console.log(result.stack.length); // 0 — nothing was pending; this is top-level code
console.log(result.step);         // 2
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s1(((abort)))
  s0(((halt)))
  u1["10<br>main"]
  u2["20"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "['*'] → [K]/[S]" --> u2
  u1 -- "[B] → [K]/[S]" --> s0
  u2 -- "[*] → [K]/[S]" --> s1
  classDef abortSentinel stroke:#c0392b,stroke-width:2px,stroke-dasharray:4 3
  class s1 abortSentinel
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

Unlike trailing `stop` (elided above), `abort` gets its own node — `u2["20"]` — because it targets a DIFFERENT sentinel, `s1(((abort)))`, not `s0(((halt)))`. `run()` returns `{outcome: 'aborted', ...}`; `result.state.name` is `'20'` (the instruction that fired `abort`, per PostMachine's [instruction-derived naming](#naming-convention)), and `result.stack` is empty because no subroutine or group call was pending — see the next example for a non-empty stack.

</details>

<details>
<summary><code>abort</code> inside a subroutine — the pending continuation freezes in <code>RunResult.stack</code></summary>

```javascript
import { PostMachine, abort, call, mark, stop } from '@post-machine-js/machine';

const machine = new PostMachine({
  sub: {
    1: mark,
    2: abort,
  },
  10: call('sub'),
  20: stop,
});

const result = machine.run();
console.log(result.outcome);                   // 'aborted'
console.log(result.state.name);                // 'sub::2'
console.log(result.stack.map((s) => s.name));   // ['10~20'] — the call's continuation, frozen
console.log(result.step);                       // 2
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s1(((abort)))
  s0(((halt)))
  u1["10~20"]
  u2[["sub::1(10~20)<br>main"]]
  idle([idle])
  subgraph w_3["callable subtree of sub::1"]
    u3["sub::1<br>sub"]
    u4["sub::2"]
    s0-3(((halt)))
  end
  idle -. enter .-> u2
  u2 == "call" ==> u3
  u2 --> u1
  u3 -- "[*] → ['*']/[S]" --> u4
  u4 -- "[*] → [K]/[S]" --> s1
  u1 -- "[*] → [K]/[S]" --> s0
  classDef abortSentinel stroke:#c0392b,stroke-width:2px,stroke-dasharray:4 3
  class s1 abortSentinel
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  classDef tag_sub fill:#fef3c7,stroke:#92400e
  class u2 tag_main
  class u3 tag_sub
```

Compare this to the [ordinary subroutine diagram](#subroutines): there, the subgraph has a dotted `w_N -. "return" .-> …` arrow feeding back to the wrapper. Here there ISN'T one — `u4`'s (`sub::2`, the `abort` instruction) only outgoing edge goes straight to `s1(((abort)))`, bypassing the wrapper's overridden-halt machinery entirely. The call-site continuation `u1["10~20"]` is never reached at runtime — and that's exactly what `result.stack` reports: `['10~20']` is the continuation that was PENDING (not popped) when `abort` fired, because `abort` short-circuited past it instead of returning through it the way a natural `stop`-triggered return would.

</details>

## Grouped instructions

Several commands can share a single instruction number by passing them as an array:

```javascript
import { PostMachine, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine({
  1: [mark, right, mark],   // mark, step right, mark — all under label 1
  2: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: [' ', ' ', ' '],
  position: 0,
}));

machine.run();
console.log(machine.tape.symbols.join('').trim()); // **
```

Bare commands inside a group fall through to the next item in the array; the last item falls through to the next *top-level* instruction (`2: stop` here). This is sugar for inlining a fixed sequence without giving each step its own top-level number.

**Inside a group, only bare forms work for movement / write commands.** Indexed forms (`mark(20)`, `right(10)`, `call('sub', 5)`, ...) throw at construction time — an explicit jump conflicts with the group's sequential fall-through semantics.

**`check` and `stop` always throw inside a group**, regardless of form. Branching and halting are control-flow boundaries that need their own top-level instruction number.

**`abort` IS allowed inside a group**, bare (its only form) — the one exception to the rule above. `abort` has no continuation to reconcile with the group's own fall-through, so admitting it introduces no ambiguity. Hitting `abort` inside a group ends the entire run, not just the group — the group's continuation never resolves. See [Author's extensions](#authors-extensions) for the full explanation and `RunResult.stack` behavior.

## Subroutines

A subroutine is a string-keyed group of numbered instructions — reusable logic invoked from the top-level program with `call(name)`. The minimum syntax: a single subroutine called once.

```javascript
import { PostMachine, call, check, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine({
  rightToBlank: {
    1: right,
    2: check(1, 3),
    3: stop,
  },
  1: call('rightToBlank'),
  2: mark,
  3: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', ' '],
}));

machine.run();
console.log(machine.tape.symbols.join('').trim()); // ***
```

The state graph as the engine emits it — the subroutine and the wrapping `withOverriddenHaltState` composition are visible:

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["1~2"]
  u2["2"]
  u3[["rightToBlank::1(1~2)<br>main"]]
  idle([idle])
  subgraph w_4["callable subtree of rightToBlank::1"]
    u4["rightToBlank::1<br>rightToBlank"]
    u5["rightToBlank::2"]
    s0-4(((halt)))
  end
  idle -. enter .-> u3
  u3 == "call" ==> u4
  w_4 -. "return" .-> u3
  u3 --> u1
  u4 -- "[*] → [K]/[R]" --> u5
  u5 -- "['*'] → [K]/[S]" --> u4
  u5 -- "[B] → [K]/[S]" --> s0-4
  u1 -- "[*] → [K]/[S]" --> u2
  u2 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  classDef tag_rightToBlank fill:#dbeafe,stroke:#1e40af
  class u3 tag_main
  class u4 tag_rightToBlank
```

The `call('rightToBlank')` step at instruction 1 is built using the engine's `withOverriddenHaltState` composition primitive: the subroutine's halt is overridden to point at the next top-level instruction (instead of terminating the machine), so when the subroutine "halts" it actually returns to top-level execution at instruction 2.

Reading the diagram (engine v7's callable-subtree emit + PostMachine's drop-acyclic-hopper rule):
- The labels are PostMachine's instruction-derived names: `"rightToBlank::1"`/`"rightToBlank::2"` for the subroutine body, `"2"` for the top-level mark, `"1~2"` for the continuation, and the composite `"rightToBlank::1(1~2)"` on the wrapper (the `[[…]]` double-square node `u3`). The `<br>main` and `<br>rightToBlank` suffixes are auto-tag annotations — the entry points of the top-level program and the subroutine, respectively. The `u\d+` node IDs are still auto-generated and shift between runs.
- The wrapper `u3[["rightToBlank::1(1~2)<br>main"]]` is the **call site** — it sits OUTSIDE the subgraph. The `idle -. enter .-> u3` edge marks it as the top-level entry; the auto-tag `main` reflects that role. The double-square `[[…]]` shape signals "wrapper" — a state produced by `withOverriddenHaltState`. The wrapper has no transitions of its own; it delegates to the bare via the bold `== "call" ==>` arrow. Under the drop-acyclic-hopper rule, the wrapper wraps `rightToBlank::1` (the first instruction) directly — there is no v6.x "hopper" anchor for this acyclic-in-the-call-graph case.
- The `subgraph w_4["callable subtree of rightToBlank::1"]` is the **callable body** — it contains the bare entry `u4` (auto-tagged `rightToBlank` as the subroutine entry), the second-instruction state `u5`, and a frame-local halt marker `s0-4` (the engine's `s0-{frame}` naming for a per-frame halt stand-in). The body's halt-bound transition (`u5 -- "[B]" --> s0-4`) lands on `s0-4`, not on the real `s0` halt.
- The dotted `w_4 -. "return" .-> u3` is the **return arrow** — when the body lands on `s0-4`, control returns to the wrapper `u3`. Then `u3 --> u1` (the solid wrapper-to-override arrow) hands off to the continuation. This replaces the alpha.1 `-. onHalt .->` keyword.
- `u1` is the continuation; it falls through (keep+S) to `u2`.
- `u2` is the `mark` instruction at top-level 2 (writes `'*'`, then transitions to halt — the trailing top-level `3: stop` is what produces that halt edge).
- The trailing `classDef tag_main` / `classDef tag_rightToBlank` + `class` lines are auto-tag styling (see [Auto-tag policy](#auto-tag-policy)).

That's just syntax — for one call site, inlining is equivalent. Subroutines earn their keep when the same logic appears at multiple sites or when symmetric variants share a shape. Example: extend a marked region by one cell on each side, using mirrored `walkRightToBlank` / `walkLeftToBlank` helpers.

```javascript
import { PostMachine, call, check, left, mark, right, stop, Tape } from '@post-machine-js/machine';

const extend = new PostMachine({
  walkRightToBlank: {
    1: check(2, 3),
    2: right(1),
    3: stop,
  },
  walkLeftToBlank: {
    1: check(2, 3),
    2: left(1),
    3: stop,
  },
  10: call('walkRightToBlank'),  // find blank to the right of the marked region
  20: mark,                       // extend rightward
  30: call('walkLeftToBlank'),   // back through the region to the left blank
  40: mark,                       // extend leftward
  50: stop,
});

extend.replaceTapeWith(new Tape({
  alphabet: extend.tape.alphabet,
  symbols: [' ', '*', ' '],
  position: 1,
}));

extend.run();
console.log(extend.tape.symbols.join('')); // ***
```

The two helpers have the same shape — a `check`/move/loop pair — with mirrored direction commands. Without subroutines, that loop body appears twice in the top-level program with `right` and `left` swapped; the structural cost is real and `summarize` makes it visible (see [Structural summary](#structural-summary--summarize)).

For a single subroutine called from MULTIPLE sites — the other archetypal use case — see the [duplicate-marked-region example](../../README.md#an-example-with-subroutines) in the root README.

## MachineState shape

Every `MachineState` PostMachine yields — from `runStepByStep()` and from `debugRun()` session events (`step` / `iter` / `pause`) — is an extended `MachineState` with two additional fields:

| Field             | Type     | Meaning                                                                                  |
|-------------------|----------|------------------------------------------------------------------------------------------|
| `arrivalPath`     | `Path`   | The instruction path that just transitioned to the current state                          |
| `candidatePaths`  | `Path[]` | All paths whose references resolve to the current state (informational; multiple for shared states) |

These fields disambiguate state-sharing (the hash-cache dedup). When two instructions produce structurally-identical transitions, they share a State; `arrivalPath` tells you which instruction the engine just transitioned through, while `candidatePaths` tells you the full sharing set.

**Example.**

```javascript
import { PostMachine, mark, stop } from '@post-machine-js/machine';

const m = new PostMachine({
  10: mark,
  20: stop,
});

for (const s of m.runStepByStep()) {
  console.log('at:', s.arrivalPath, 'shared with:', s.candidatePaths);
}
```

The `Path` type and the `parsePath`/`formatPath` helpers are exported from `@post-machine-js/machine` — see the [Naming convention](#naming-convention) section for the path-string format.

## Naming convention

PostMachine names every state it constructs by instruction index, so `toMermaid` output, `summarize` output, and `MachineState.name` carry user-meaningful information.

**Rules** — given a state's place in the instruction tree, its name is:

| Construct                                       | Top-level                    | Inside subroutine `foo`      |
|-------------------------------------------------|------------------------------|------------------------------|
| Atomic instruction at index `N`                 | `"N"`                        | `"foo::N"`                   |
| Subroutine hopper (entry forwarder)             | `"sub"`                      | `"foo::sub"`                 |
| Group at instr `O`, inner index `I`             | `"O.I"`                      | `"foo::O.I"`                 |
| Continuation: from `X` to `Y`                   | `"X~Y"`                      | `"foo::X~foo::Y"`            |
| Continuation: tail-position                     | `"X~halt"`                   | `"foo::X~halt"`              |
| Call wrapper composite (engine auto-wraps in parens) | `"sub(X~Y)"` / `"sub(X~halt)"` | `"foo::sub(foo::X~foo::Y)"`   |
| Group wrapper composite                         | `"O.1(O~Y)"` / `"O.1(O~halt)"` | `"foo::O.1(foo::O~foo::Y)"`   |

**Separators in user-meaningful labels:**
- `::` — subroutine scope (lexical nesting), like C++/Rust's scope-resolution operator. `foo::bar::1` reads as "instruction 1 inside subroutine `bar`, which is defined inside subroutine `foo`".
- `.` — group inner-step ordinal. `50.1`, `50.2`, etc. are the sequential commands inside a group at instruction `50`.
- `~` — continuation. `10~30` reads as "after the wrapper at instruction 10 finishes, forward to instruction 30". Tail-position uses `~halt`.
- `(` / `)` — engine-internal `withOverriddenHaltState` composition (outer state wrapping the override target in parens). The engine auto-builds wrapper composites in this shape; user code never writes parens directly into state names.

User-provided subroutine names are constrained to identifier characters (`/^[A-Z$_][A-Z0-9$_]*$/i`), so none of these separators can collide with user input.

**Reading a wrapper composite.** Example: `"foo(10~40)"`.

- The outer (bare) part is everything before the opening paren: `"foo"` (the subroutine hopper). The override is the parenthesized inner: `"10~40"` (the continuation state).
- Split the override at `~`: caller = `"10"` (the call-site instruction), target = `"40"` (where control resumes).

So `"foo(10~40)"` describes: "a wrapper around the `foo` subroutine entry, which on halt forwards from instruction 10 to instruction 40."

For a more complex example, `"outer::inner::deepest(outer::inner::1~halt)"`:
- Outer = `"outer::inner::deepest"` — a deeply-nested subroutine hopper (three levels of lexical nesting).
- Override = `"outer::inner::1~halt"` — the call site at `outer::inner::1`, tail-position (forwards to halt).

**Quick example.**

```javascript
const m = new PostMachine({
  10: call('foo', 30),
  20: stop,
  30: stop,
  foo: { 1: stop },
});
// m.initialState.name === "foo(10~30)"
```

### State sharing across structurally-identical instructions

PostMachine caches state nodes by command shape, so two instructions producing structurally-identical transitions (same command kind, same next-instruction target) share a single underlying `State` object. The shared state carries the name of the *first-processed* instruction. Behavior is identical regardless of which instruction control arrives through, but `MachineState.name` may report the canonical instruction's name rather than the caller's instruction index.

For programmatic lookup by instruction index, use `pm.candidatesFor(path)` (construction-time) or read `MachineState.candidatePaths` from a `runStepByStep()` yield or a `debugRun()` session event (runtime). See [Path-based resolver](#path-based-resolver) and [MachineState shape](#machinestate-shape).

### Engine v7 alignment

Engine v7 (upstream `@turing-machine-js/machine`) changed the wrapper composite shape from `A>B` to `A(B)` (paren-based). PostMachine's naming convention was designed to survive that change: none of our separators (`::`, `.`, `~`) collide with the new paren grammar, so only the *wrapper composite emit* shifted (e.g., the v6.x `"foo>10~40"` is now `"foo(10~40)"`). The names PostMachine constructs internally — and the rules in the table above — are unchanged. v7's `toMermaid` output also adopted a callable-subtree model: the wrapper is a `[[bare(continuation)]]` call site OUTSIDE the subgraph, with a bold `==> "call"` arrow into the bare's subtree and a dotted `-. "return" .->` arrow back to the wrapper. Replaces v6.x's composite-named entry node.

## Tags

Tags are out-of-band string labels attached to states. They don't change runtime behavior — they layer semantic meaning over the auto-generated path-derived names ([Naming convention](#naming-convention)) for two surfaces:

- **Mermaid diagrams** — `toMermaid` emits tags as `<br>`-suffixed annotations on node labels plus `classDef`/`class` lines for visual grouping. A reader who didn't write the program sees what the structurally important entry points are without re-deriving them from the instruction list.
- **Programmatic introspection** — `pm.findByTag(...)` retrieves paths by tag; debugger / analysis code can use tags as stable handles independent of state IDs.

Three ways to apply tags: the **inline `$tag` decorator** at construction, the **`pm.tag` registry** post-construction, and the **auto-tag policy** which marks each program's / subroutine's entry point automatically.

### Inline `$tag` decorator

`$tag(...tags, command)` wraps a command with one or more tags. The tags apply to the resulting State; no extra graph node is created. The leading `$` flags it visually as a decorator (not a primitive command).

**Wrapping a single command.** The common case — one tag per state, applied per instruction:

```javascript
import { PostMachine, $tag, check, mark, right, stop } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: $tag('hot', check(20, 30)),               // tag a single state
  20: $tag('loop-body', 'sampled', right(10)),  // variadic — many tags at once
  30: mark,
  40: stop,
});

console.log(machine.tagsOf({ instructionIndex: 10 }));
// ['hot', 'main'] — inline 'hot' applied at producer time, then 'main' auto-tag
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>hot, main"]
  u2["20<br>loop-body, sampled"]
  u3["30"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "['*'] → [K]/[S]" --> u2
  u1 -- "[B] → [K]/[S]" --> u3
  u2 -- "[*] → [K]/[R]" --> u1
  u3 -- "[*] → ['*']/[S]" --> s0
  classDef tag_hot fill:#dbeafe,stroke:#1e40af
  classDef tag_loop-body fill:#fee2e2,stroke:#991b1b
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  classDef tag_sampled fill:#ede9fe,stroke:#5b21b6
  class u1 tag_hot
  class u2 tag_loop-body
  class u1 tag_main
  class u2 tag_sampled
```

`u1` carries two tags (`hot` from `$tag` + `main` from auto-tag) — the engine emits them comma-separated in the label and applies BOTH `classDef` lines via two `class u1 …` directives. Tag composition is additive.

**Per-member in a group.** `$tag` rejects wrapping a group as a whole (`$tag('foo', [mark, right])` throws). Tag each member individually instead — the inner tags land on the per-member states inside the group's callable subtree:

```javascript
import { PostMachine, $tag, mark, right, stop } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: [$tag('lift', mark), $tag('descend', right)],
  20: stop,
});

console.log(machine.tagsOf({ instructionIndex: 10, groupInstructionIndex: 1 }));
// ['lift']
console.log(machine.tagsOf('10'));
// ['main'] — the outer wrapper at path '10' carries the auto-tag for the top-level entry
```

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10~20"]
  u2[["10.1(10~20)<br>main"]]
  idle([idle])
  subgraph w_3["callable subtree of 10.1"]
    u3["10.1<br>lift"]
    u4["10.2<br>descend"]
    s0-3(((halt)))
  end
  idle -. enter .-> u2
  u2 == "call" ==> u3
  w_3 -. "return" .-> u2
  u2 --> u1
  u3 -- "[*] → ['*']/[S]" --> u4
  u4 -- "[*] → [K]/[R]" --> s0-3
  u1 -- "[*] → [K]/[S]" --> s0
  classDef tag_descend fill:#fef3c7,stroke:#92400e
  classDef tag_lift fill:#fee2e2,stroke:#991b1b
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u4 tag_descend
  class u3 tag_lift
  class u2 tag_main
```

The group expands into a `withOverriddenHaltState` chain wrapped in a callable subtree (same shape as a subroutine call). The wrapper `u2` is the top-level entry (auto-tagged `main`); the inner states `u3` (`lift`) and `u4` (`descend`) carry their per-member tags inside the subgraph. The group's outer path `'10'` resolves to the wrapper; group-inner paths use the `{ instructionIndex: 10, groupInstructionIndex: N }` shape.

Passing bare `$tag` (without invoking it) as an instruction or as a group member also throws — with a message pointing at the correct form.

### Post-construction registry

```typescript
pm.tag(path: Path | string, ...tags: string[]): void;
pm.untag(path: Path | string, ...tags: string[]): void;
pm.tagsOf(path: Path | string): readonly string[];
pm.findByTag(tag: string): Path[];
```

`tag` / `untag` are variadic (one call adds/removes any number of tags). `tagsOf` returns a frozen snapshot; `findByTag` returns all paths whose state currently carries that tag. All four resolve `path` the same way as [`pm.stateAt`](#path-based-resolver) — string form (`'10'`, `'sub::1'`) or object form (`{ instructionIndex: 10 }`).

```javascript
import { PostMachine, mark, stop } from '@post-machine-js/machine';

const machine = new PostMachine({ 10: mark, 20: mark, 30: stop });
machine.tag('10', 'checkpoint');
machine.tag('20', 'checkpoint', 'hot');

console.log(machine.tagsOf('20'));         // ['checkpoint', 'hot'] — no 'main' (20 is not the entry)
console.log(machine.findByTag('checkpoint').length); // 2

machine.untag('20', 'hot');
console.log(machine.tagsOf('20'));         // ['checkpoint']
```

`pm.tag(...)` and `$tag(...)` compose: tags from both sources accumulate on the same state. Inline tags are applied at construction, before any post-construction `pm.tag` call sees the state.

### Auto-tag policy

At construction, PostMachine auto-tags the **entry point** of each program/subroutine:

| Path | Auto-tag |
|---|---|
| Top-level entry (e.g., the first numbered instruction `1` or `10`) | `'main'` |
| Each subroutine's entry (e.g., `sub::1`, `rightToBlank::1`) | the subroutine name (e.g., `'sub'`, `'rightToBlank'`) |

Non-entry instructions and group inner states stay clean. Halt-resolving paths (`stop`-only entries) are also skipped, because `stop` resolves to the engine's globally-shared `haltState` singleton — tagging it would leak across all PostMachine instances. The policy is mechanical and intentionally minimal: it anchors the structural roles without cluttering diagrams.

```javascript
import { PostMachine, call, check, mark, right, stop } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: call('rightToBlank'),
  20: stop,
  rightToBlank: { 1: check(2, 99), 2: right(1), 99: stop },
});

console.log(machine.tagsOf('10'));              // ['main']           — top-level entry
console.log(machine.tagsOf('rightToBlank::1')); // ['rightToBlank']   — subroutine entry
console.log(machine.tagsOf('rightToBlank::2')); // []                 — body, non-entry
console.log(machine.findByTag('main').map((p) => p.instructionIndex)); // [10]
```

### Mermaid output

When tags are present (auto-tag or user-applied), `toMermaid` emits them inline in node labels via `<br>` and as `classDef`/`class` lines for color grouping. The styling palette is hashed deterministically per tag name — same tag name → same color across runs. See the [Visualization](#visualization--tomermaid--statetograph) section below for full example output.

## Introspection and equivalence

The v3 utilities from `@turing-machine-js/machine` work directly against a `PostMachine`. For the two most common ones — `summarize` and `equivalentOn` — this package also ships Post-aware free-function wrappers (`summarizePostMachine`, `equivalentPostMachines`) that bind the standard arguments and hide the `getTapeBlock`-must-clone footgun. **Prefer the wrappers for typical use.** The bare upstream functions are still re-exported here for advanced cases.

### Visualization — `toMermaid` + `State.toGraph`

```javascript
import { PostMachine, State, toMermaid, check, mark, right, stop } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));
console.log(mermaid.split('\n')[0]); // flowchart TD
```

The full rendered emit for this machine:

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>main"]
  u2["20"]
  u3["30"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "['*'] → [K]/[S]" --> u2
  u1 -- "[B] → [K]/[S]" --> u3
  u2 -- "[*] → [K]/[R]" --> u1
  u3 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

(Same machine as the [Quick start](#quick-start) example — see that section for the node/edge-shape reading guide.)

For the raw `Graph` as input to other tools (analysis, custom rendering, alternative serializations), use `State.toGraph(machine.initialState, machine.tapeBlock)` directly. The companion `fromMermaid` and `State.fromGraph` are also re-exported for round-trip workflows — load a Mermaid blob, get a `Graph` back, build a runnable machine from it. Under engine v7, the round-trip is both behaviorally lossless AND bytewise stable for wrapped states (state IDs auto-reassign on each pass, but the emit shape — including shared-bare deduplication — is deterministic).

### Structural summary — `summarizePostMachine`

`summarizePostMachine(machine)` returns counts about the assembled state graph: `stateCount`, `transitionCount`, `compositionEdgeCount`, `maxCompositionDepth`, `selfLoopCount`, `hasCycles`, `tapeCount`, `alphabetCardinalities`. For a PostMachine, `tapeCount` is always `1` and `alphabetCardinalities` is always `[2]` (one tape, two symbols — blank and mark); the interesting fields are the rest.

The typical use is comparing two implementations of the same algorithm — for example, an inline version against one factored through a subroutine:

```javascript
import { PostMachine, summarizePostMachine, call, check, mark, right, stop } from '@post-machine-js/machine';

// Both machines walk right to the first blank cell and mark it.

const inline = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

const withSubroutine = new PostMachine({
  walkToBlank: {
    1: check(2, 3),
    2: right(1),
    3: stop,
  },
  10: call('walkToBlank'),
  20: mark,
  30: stop,
});

const a = summarizePostMachine(inline);
const b = summarizePostMachine(withSubroutine);

console.log(a.stateCount, a.compositionEdgeCount, a.maxCompositionDepth);
// 4 0 0 — inline: 4 states, no composition

console.log(b.stateCount, b.compositionEdgeCount, b.maxCompositionDepth);
// 6 1 1 — subroutine: 2 more states; 1 composition edge from `call` (depth 1)
```

Both programs do the same thing on the same input. This particular comparison is the **worst case for subroutines**: a single call site (no reuse benefit) with a small body — so the `withOverriddenHaltState` wrapper overhead per call (~2 states under engine v7's callable-subtree emit + PostMachine's drop-acyclic-hopper rule: the wrapper node and the continuation; the v6.x hopper is dropped for the common case of a plain leading command) shows up as pure cost. Subroutines start saving states when reuse is real and the body amortizes the wrapper overhead — see the [extend example](#subroutines) above for symmetric variants and the [duplicate-marked-region example](../../README.md#an-example-with-subroutines) in the root README for true multi-call.

The two state graphs as the engine emits them — what the numbers above are summarizing:

<details>
<summary><code>inline</code> — flat 4-state graph, no composition</summary>

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10<br>main"]
  u2["20"]
  u3["30"]
  idle([idle])
  idle -. enter .-> u1
  u1 -- "['*'] → [K]/[S]" --> u2
  u1 -- "[B] → [K]/[S]" --> u3
  u2 -- "[*] → [K]/[R]" --> u1
  u3 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  class u1 tag_main
```

`u1` is `check`; on `'*'` it loops via `u2` (`right`); on blank it falls to `u3` (`mark`) → halt. Four nodes, one back-edge, zero subgraphs.

</details>

<details>
<summary><code>withSubroutine</code> — wrapper + callable subtree + continuation</summary>

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  u1["10~20"]
  u2["20"]
  u3[["walkToBlank::1(10~20)<br>main"]]
  idle([idle])
  subgraph w_4["callable subtree of walkToBlank::1"]
    u4["walkToBlank::1<br>walkToBlank"]
    u5["walkToBlank::2"]
    s0-4(((halt)))
  end
  idle -. enter .-> u3
  u3 == "call" ==> u4
  w_4 -. "return" .-> u3
  u3 --> u1
  u4 -- "['*'] → [K]/[S]" --> u5
  u4 -- "[B] → [K]/[S]" --> s0-4
  u5 -- "[*] → [K]/[R]" --> u4
  u1 -- "[*] → [K]/[S]" --> u2
  u2 -- "[*] → ['*']/[S]" --> s0
  classDef tag_main fill:#dbeafe,stroke:#1e40af
  classDef tag_walkToBlank fill:#ede9fe,stroke:#5b21b6
  class u3 tag_main
  class u4 tag_walkToBlank
```

The two extra nodes vs inline that drive `stateCount: 4 → 6`:
- **`u3[["walkToBlank::1(10~20)"]]`** — the wrapper / call site, OUTSIDE the subgraph. Composite name `walkToBlank::1(10~20)` reflects that PostMachine drops the v6.x "hopper" anchor for acyclic subroutines with a plain first instruction — the wrapper wraps `walkToBlank::1` directly, saving one State.
- **`u1["10~20"]`** — the continuation that PostMachine synthesizes between the `call('walkToBlank')` site at instruction `10` and the next top-level instruction `20`.

The subroutine body (`u4`, `u5`) inside `subgraph w_4` mirrors `inline`'s `u1`, `u2` loop structurally — same algorithm, same internal back-edge. The extra cost is purely the wrapper + continuation machinery. `compositionEdgeCount: 0 → 1` and `maxCompositionDepth: 0 → 1` come from the single `withOverriddenHaltState` wrapper.

(Subroutines with `1: stop`, a leading `call(...)`, a leading group `[...]`, or that participate in a call-graph cycle keep the hopper as a forward-declaration anchor. The common case — plain leading command — drops it.)

</details>

What `summarizePostMachine` actually surfaces is the **structural trade-off**, not just state count: `compositionEdgeCount` and `maxCompositionDepth` go to zero in the inline version (everything is one flat graph) and become non-zero with subroutines (`call` creates a composition edge; nesting goes deeper). Use those fields to reason about the structure of reuse independently of raw size.

`summarizePostMachine(machine)` is sugar for `summarize(machine.initialState, machine.tapeBlock)`. The bare `summarize` is also re-exported for callers who already hold a `(state, tapeBlock)` pair.

### Behavioral equivalence — `equivalentPostMachines`

`equivalentPostMachines(reference, candidate, cases, options?)` runs both PostMachine instances against the same list of input tapes and reports per-case agreement, first-divergence step, and per-side step counts.

```javascript
import { PostMachine, equivalentPostMachines, check, mark, right, stop } from '@post-machine-js/machine';

const reference = new PostMachine({
  10: check(20, 30), 20: right(10), 30: mark, 40: stop,
});
const candidate = new PostMachine({
  10: check(20, 30), 20: right(10), 30: stop,  // forgot to mark
});

const report = equivalentPostMachines(reference, candidate, ['** ']);
console.log(report.allAgree); // false
```

Each case string is loaded onto a fresh clone of the originating PostMachine's tapeBlock per run (the wrapper handles the cloning — required because state-graph symbols are interned per-block). Cross-alphabet comparison and the `compareOutputs` / `compareSnapshots` options are passed through to upstream `equivalentOn`; see the upstream `@turing-machine-js/machine` documentation for full option semantics.

The bare `equivalentOn` is also re-exported. Use it directly when you need a non-PostMachine `Runnable` on either side (e.g., comparing a `PostMachine` against a hand-rolled `TuringMachine`).

## Path-based resolver

`PostMachine` exposes three construction-time queries for addressing states by instruction path.

```javascript
import { PostMachine, mark, stop } from '@post-machine-js/machine';

const pm = new PostMachine({ 10: mark, 20: stop });

pm.stateAt('10');               // the State for instruction 10
pm.hasState('10');              // true
pm.hasState('999');             // false (never throws)
pm.candidatesFor('10');         // [{ instructionIndex: 10 }]
```

Both string and object forms work for paths:

```javascript
pm.stateAt({ instructionIndex: 10 });
pm.stateAt({ scope: 'sub', instructionIndex: 1 });
pm.stateAt({ scope: ['outer', 'inner'], instructionIndex: 1, groupInstructionIndex: 2 });
```

Returned States are the real engine States — `instanceof State`, usable with `State.toGraph`, `summarize`, and other engine utilities — but with `state.debug` set/get installed by PostMachine (see [Breakpoints](#breakpoints) below).

## Breakpoints

Register pauses by instruction path, by `haltState`, or by `abortState`:

```javascript
import { PostMachine, Tape, haltState, mark, right, check, stop } from '@post-machine-js/machine';

const pm = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: ['*', '*', ' '] }));

pm.setBreakpoint('30', { before: true });

const session = pm.debugRun();
session.on('pause', (m) => {
  // m.arrivalPath === { instructionIndex: 30 }
  // m.pause === { side: 'before', cause: 'breakpoint' }
  session.continue();
});
await session.start();
```

Filters mirror the engine's `DebugConfig`:

```javascript
pm.setBreakpoint('10', { before: true });           // pause before every iteration
pm.setBreakpoint('10', { before: '*' });            // pause only on read '*'
pm.setBreakpoint('10', { before: ['*', ' '] });     // pause on either symbol
pm.setBreakpoint('10', { before: true, after: '*' });
```

Halt breakpoints:

```javascript
pm.setBreakpoint(haltState, { before: true });       // pause at halt entry (filter shape is decorative)
```

> Engine v7 collapsed `haltState.debug` to a `boolean` — halt has one meaningful pause moment. The `filter` shape passed to `pm.setBreakpoint(haltState, …)` is kept for API stability but is now decorative: any registered halt breakpoint enables the engine-level boolean, and the registry entry drives only the arrival-path filtering in the `debugRun()` session's pause filter. The pause fires on the AFTER side of the iter whose transition leads to halt.

Abort breakpoints — same shape, the sibling sentinel:

```javascript
import { abortState } from '@post-machine-js/machine';

pm.setBreakpoint(abortState, { before: true });      // pause before the abort-imminent iter (filter shape is decorative)
```

> `abortState.debug` (**v7.1**, adopting the engine v7.1 `abortState` sentinel) is the boolean sibling of `haltState.debug` — same shape, same decorative-filter caveat. A registered abort breakpoint pauses on the AFTER side of the iter whose transition targets `abortState`, right before the `debugRun()` session's terminal `abort` event fires (see [`debugRun()`](#postmachine)). This is a pause on the SENTINEL — pausing on the *abort instruction itself* (its own per-instruction `State`, e.g. path `'20'`) uses an ordinary instruction breakpoint (`pm.setBreakpoint('20', { before: true })`), no different from any other instruction; see [Author's extensions](#authors-extensions) for why `abort` gets its own named State in the first place.

Management:

```javascript
pm.listBreakpoints();      // returns Breakpoint[]
pm.clearBreakpoint('10');  // remove a single registration
pm.clearBreakpoints();     // remove all
```

**State sharing.** When two instructions share an underlying State (hash dedup), setting a breakpoint on instruction 30 enables `state.debug` on the shared State — meaning the engine pauses on every visit. The `debugRun()` session consults the registry and *only* surfaces the pause when `m.arrivalPath` matches a registered path. Sibling-instruction visits auto-continue.

### Lockdown semantics

`pm.setBreakpoint` is the structured channel. Direct `state.debug = X` writes are intercepted: on an un-shared State the assignment redirects to `setBreakpoint` (or `clearBreakpoint` if the value is `null`); on a shared State it throws with the candidate-path list, since the assignment is ambiguous:

```javascript
const pm = new PostMachine({ 10: mark, 20: stop });

pm.stateAt('10').debug = { before: true };
// equivalent to pm.setBreakpoint('10', { before: true })

pm.stateAt('10').debug = null;
// equivalent to pm.clearBreakpoint('10')
```

Direct writes on `haltState` now go straight to the engine setter — the prior module-load halt-lockdown was dropped when the engine collapsed `haltState.debug` to a boolean. Boolean writes are accepted; object writes throw the engine's boolean-only error:

```javascript
haltState.debug = true;                              // ok — enables the halt breakpoint
haltState.debug = false;                             // ok — disables
haltState.debug = null;                              // ok — alias of false
haltState.debug = { before: true };                  // throws: "haltState.debug only accepts boolean..."
```

Direct halt writes bypass PostMachine's registry — they enable the engine pause but `pm.listBreakpoints()` won't record them. Use `pm.setBreakpoint(haltState, …)` when arrival-path filtering or registry awareness matters; use the direct write for ad-hoc halt-pause toggling in tools that don't need the registry.

`abortState` behaves identically — direct boolean writes pass straight through, object writes throw:

```javascript
abortState.debug = true;                             // ok — enables the abort breakpoint
abortState.debug = false;                             // ok — disables
abortState.debug = { before: true };                  // throws: boolean-only, same as haltState
```

Unlike `haltState`, `abortState` needs no explicit carve-out in PostMachine's lockdown-install loop (there's no `if (state.isAbort) continue;` anywhere) — it's structurally impossible for the sentinel to end up locked. An `abort` instruction's producer builds a NAMED per-instruction `State` whose one transition targets `abortState` (see [Author's extensions](#authors-extensions)); the `abortState` singleton itself never becomes a candidate path in any PostMachine instance, so it never enters `#stateToCandidatePaths` and the lockdown-install loop simply never sees it. `pm.setBreakpoint(abortState, …)` is still the registry-aware channel; the direct write is the same open, non-registry-tracked ad-hoc toggle `haltState.debug` is.

This relaxed model preserves the single-channel invariant where it matters: `pm.listBreakpoints()` is still the source of truth for what the `debugRun()` session surfaces. The engine's pause itself is now an open channel — by design, since the halt-lockdown's "per-PostMachine routing" benefit was syntactic only (haltState is a process-global singleton).

For the underlying engine reference — filter shapes for non-halt states, the `before → step → after` per-iter lifecycle (engine v6), and the boolean `haltState.debug` API — see the "Debugging breakpoints" section of the upstream `@turing-machine-js/machine` README.

## Links

- [Post–Turing machine](https://en.wikipedia.org/wiki/Post%E2%80%93Turing_machine) on Wikipedia
- [@turing-machine-js/machine](https://www.npmjs.com/package/@turing-machine-js/machine) — the upstream Turing-machine engine
