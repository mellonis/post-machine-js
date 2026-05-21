import {
  PostMachine,
  State,
  Tape,
  alphabet,
  blankSymbol,
  markSymbol,
  call, check, left, mark, noop, right, stop,
  toMermaid,
  summarizePostMachine,
  equivalentPostMachines,
  parsePath,
  formatPath,
  type MachineState,
  type Path,
} from '../index';

describe('packages/machine/README.md', () => {
  describe('Constants', () => {
    test('alphabet is the upstream Alphabet over [" ", "*"]', () => {
      // The README claims `alphabet` is an `Alphabet` instance for
      // Post-machine tapes (' ', '*'). `Alphabet` isn't re-exported
      // (intentional — PostMachine wraps it), so we verify shape
      // instead of constructor identity. The Alphabet class exposes
      // `symbols` and `blankSymbol` as prototype getters.
      expect(alphabet).toBeDefined();
      expect((alphabet as { symbols: readonly string[] }).symbols).toEqual([' ', '*']);
      expect((alphabet as { blankSymbol: string }).blankSymbol).toBe(' ');
    });

    test('blankSymbol is " " (space)', () => {
      // The README claims `blankSymbol` is the blank symbol, ' ' (space).
      expect(blankSymbol).toBe(' ');
    });

    test('markSymbol is "*"', () => {
      // The README claims `markSymbol` is the mark symbol, '*'.
      expect(markSymbol).toBe('*');
    });
  });

  describe('Quick start', () => {
    test('** → marks first blank to make ***', async () => {
      const machine = new PostMachine({
        10: check(20, 30),
        20: right(10),
        30: mark,
        40: stop,
      });

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: ['*', '*', ' '],
      }));

      await machine.run();

      // console.log(machine.tape.symbols.join('').trim()); // ***
      expect(machine.tape.symbols.join('').trim())
        .toBe('***');
    });
  });

  describe('Commands', () => {
    describe('noop in the graph — fall-through and unconditional jump', () => {
      test('noop in a chain produces a single [K]/[S] state', () => {
        const machine = new PostMachine({
          10: mark,
          20: noop,
          30: mark,
          40: stop,
        });

        const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

        // 3 reachable instructions (`40: stop` is elided — see trailing-stop test below).
        expect(mermaid).toContain('["10"]');
        expect(mermaid).toContain('["20"]');
        expect(mermaid).toContain('["30"]');
        // noop's signature: `[K]/[S]` — keep, stay. Marks have `['*']/[S]`.
        expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \[K\]\/\[S\]" --> s\d+/); // noop
        expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \['\*'\]\/\[S\]" --> s\d+/); // mark
      });

      test('noop(40) jumps directly; unreachable instructions are dropped', () => {
        const machine = new PostMachine({
          10: noop(40),
          20: mark,
          30: mark,
          40: stop,
        });

        const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

        // Only instruction 10 appears; 20/30 are unreachable, 40 = trailing stop.
        expect(mermaid).toContain('["10"]');
        expect(mermaid).not.toContain('"20"');
        expect(mermaid).not.toContain('"30"');
        // 10's transition is noop's `[K]/[S]` straight to halt (s0).
        expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \[K\]\/\[S\]" --> s0/);
      });
    });

    describe('Trailing stop doesn\'t get its own node', () => {
      test('{ 10: mark, 20: stop } emits one state, not two', () => {
        const machine = new PostMachine({
          10: mark,
          20: stop,
        });

        const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

        expect(mermaid).toContain('["10"]');
        // No "20" label — the trailing stop is elided as a halt routing
        // convention; instruction 10 transitions straight to s0(((halt))).
        expect(mermaid).not.toContain('"20"');
        expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \['\*'\]\/\[S\]" --> s0/);
      });

      test('pm.stateAt for a trailing-stop index resolves to haltState', () => {
        const machine = new PostMachine({
          10: mark,
          20: stop,
        });

        const stopState = machine.stateAt({instructionIndex: 20});

        // Graph doesn't render `s20`, but the lookup API still resolves the
        // path to the canonical haltState singleton.
        expect(stopState).toBeDefined();
        expect(stopState!.isHalt).toBe(true);
      });
    });
  });

  describe('Grouped instructions', () => {
    test('[mark, right, mark] under one label produces "**"', async () => {
      const machine = new PostMachine({
        1: [mark, right, mark],
        2: stop,
      });

      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbols: [' ', ' ', ' '],
        position: 0,
      }));

      await machine.run();

      // console.log(machine.tape.symbols.join('').trim()); // **
      expect(machine.tape.symbols.join('').trim())
        .toBe('**');
    });

    test('check inside a group throws at construction', () => {
      // README claim: `check` always throws inside a group, regardless of form.
      expect(() => new PostMachine({
        1: [mark, check(2, 3)],
        2: stop,
        3: stop,
      })).toThrow();
    });

    test('stop inside a group throws at construction', () => {
      // README claim: `stop` always throws inside a group, regardless of form.
      expect(() => new PostMachine({
        1: [mark, stop],
      })).toThrow();
    });

    test('indexed mark inside a group throws at construction', () => {
      // README claim: indexed forms (mark(N), right(N), ...) throw in a group
      // because explicit jump conflicts with sequential fall-through.
      expect(() => new PostMachine({
        1: [mark, right(10), mark],
        2: stop,
        10: stop,
      })).toThrow();
    });

    test('indexed call inside a group throws at construction', () => {
      // README claim: indexed call('sub', N) form throws in a group; bare
      // call('sub') is allowed.
      expect(() => new PostMachine({
        sub: { 1: stop },
        1: [mark, call('sub', 2)],
        2: stop,
      })).toThrow();
    });

    test('bare call inside a group is allowed', () => {
      // Sanity-check the bare-form-allowed half of the indexed-vs-bare rule.
      expect(() => new PostMachine({
        sub: { 1: stop },
        1: [mark, call('sub')],
        2: stop,
      })).not.toThrow();
    });
  });

  describe('Subroutines', () => {
    test('engine Mermaid output for the simple subroutine matches README <details>', () => {
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

      const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

      // Header.
      expect(mermaid).toContain('flowchart TD');
      expect(mermaid).toContain('%% alphabets: [[" ","*"]]');

      // Halt + the entry — under engine v7's callable-subtree emit (#174)
      // PLUS PostMachine's drop-acyclic-hopper change (#85), the wrapper at
      // the call site wraps `rightToBlank::1` directly (not the v6.x hopper
      // named `rightToBlank`). The subgraph label and composite name both
      // reflect the bare's identity.
      expect(mermaid).toContain('(((halt)))');
      expect(mermaid).toMatch(/subgraph w_\d+\["callable subtree of rightToBlank::1"\]/);
      expect(mermaid).toContain('[["rightToBlank::1(1~2)"]]');
      expect(mermaid).toContain('["rightToBlank::1"]'); // bare inside the subgraph
      // The v6.x hopper named 'rightToBlank' is dropped (acyclic + plain first instr).
      expect(mermaid).not.toContain('["rightToBlank"]');

      // Bold `== "call" ==>` from wrapper to bare + dotted `-. "return" .->`
      // from subgraph back to wrapper. The retired alpha.1 `-. onHalt .->`
      // keyword does not appear; wrapper-to-override is a regular solid arrow.
      expect(mermaid).toMatch(/s\d+ == "call" ==> s\d+/);
      expect(mermaid).toMatch(/w_\d+ -\. "return" \.-> s\d+/);
      expect(mermaid).not.toMatch(/onHalt/);

      // The subroutine's internal cycle: a right-move state and a check state
      // that loops back on '*' and exits on the blank. Engine v7 label vocabulary.
      expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \[K\]\/\[R\]" --> s\d+/);    // right (keep + R)
      expect(mermaid).toMatch(/s\d+ -- "\['\*'\] → \[K\]\/\[S\]" --> s\d+/);  // check on '*'
      // Body's halt-bound transition is retargeted to the frame's halt marker (c\d+),
      // not the real s0 — that's the callable-subtree contract.
      expect(mermaid).toMatch(/s\d+ -- "\[B\] → \[K\]\/\[S\]" --> c\d+/);     // check on blank

      // The mark instruction's edge: write '*', stay, transition to halt.
      expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \['\*'\]\/\[S\]" --> s\d+/);
    });

    test('** → marks first blank to make *** (single subroutine, single call)', async () => {
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

      await machine.run();

      // console.log(machine.tape.symbols.join('').trim()); // ***
      expect(machine.tape.symbols.join('').trim())
        .toBe('***');
    });

    test(' *  → *** by extending the region one cell on each side', async () => {
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
        10: call('walkRightToBlank'),
        20: mark,
        30: call('walkLeftToBlank'),
        40: mark,
        50: stop,
      });

      extend.replaceTapeWith(new Tape({
        alphabet: extend.tape.alphabet,
        symbols: [' ', '*', ' '],
        position: 1,
      }));

      await extend.run();

      // console.log(extend.tape.symbols.join('')); // ***
      expect(extend.tape.symbols.join(''))
        .toBe('***');
    });
  });

  describe('Custom symbols', () => {
    test('## → marks first . to make ### with .# alphabet', async () => {
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

      await machine.run();

      // console.log(machine.tape.symbols.join('').replace(/\.+$/, '')); // ###
      expect(machine.tape.symbols.join('').replace(/\.+$/, ''))
        .toBe('###');
    });
  });

  describe('Naming convention', () => {
    test('Quick example: machine.initialState.name === "foo(10~30)"', () => {
      const m = new PostMachine({
        10: call('foo', 30),
        20: stop,
        30: stop,
        foo: { 1: stop },
      });

      // m.initialState.name === "foo(10~30)"
      expect(m.initialState.name).toBe('foo(10~30)');
    });
  });

  describe('MachineState shape (v6.1.0+)', () => {
    test('onStep receives arrivalPath and candidatePaths for a simple machine', async () => {
      const m = new PostMachine({
        10: mark,
        20: stop,
      });

      const steps: { arrivalPath: Path; candidatePaths: Path[] }[] = [];
      await m.run({
        onStep: (s: MachineState) => {
          // console.log('at:', s.arrivalPath, 'shared with:', s.candidatePaths);
          steps.push({ arrivalPath: s.arrivalPath, candidatePaths: s.candidatePaths });
        },
      });

      // onStep fires once — for the `mark` transition at instruction 10.
      expect(steps).toHaveLength(1);

      // arrivalPath identifies instruction 10 (no scope, no group).
      expect(steps[0].arrivalPath).toEqual({ instructionIndex: 10 });
      // formatPath round-trips it to the string form used in the naming convention.
      expect(formatPath(steps[0].arrivalPath)).toBe('10');
      // parsePath round-trips the string back to Path.
      expect(parsePath('10')).toEqual({ instructionIndex: 10 });

      // candidatePaths: only one path shares this state (no hash-cache dedup here).
      expect(steps[0].candidatePaths).toHaveLength(1);
      expect(steps[0].candidatePaths[0]).toEqual({ instructionIndex: 10 });
    });
  });

  describe('Introspection and equivalence', () => {
    describe('Visualization — toMermaid + State.toGraph', () => {
      function buildQuickStart(): PostMachine {
        return new PostMachine({
          10: check(20, 30),
          20: right(10),
          30: mark,
          40: stop,
        });
      }

      test('first line is "flowchart TD"', () => {
        const machine = buildQuickStart();
        const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

        // console.log(mermaid.split('\n')[0]); // flowchart TD
        expect(mermaid.split('\n')[0])
          .toBe('flowchart TD');
      });

      // Pins the README's <details> engine-source block. State names are now deterministic
      // (instruction-derived); node IDs (s\d+) are still auto-generated and shift between
      // runs, so we pin the labels via `toContain(...)`.
      test('Quick Start engine output matches README <details> block', () => {
        const machine = buildQuickStart();
        const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

        // Header lines (literal).
        expect(mermaid).toContain('flowchart TD');
        expect(mermaid).toContain('%% alphabets: [[" ","*"]]');

        // Halt node (always literal "halt").
        expect(mermaid).toContain('(((halt)))');

        // Initial state — square-bracket node shape; under engine v7 the entry is
        // marked by a separate idle sentinel + dotted enter edge, not a double-paren shape.
        expect(mermaid).toContain('["10"]');
        expect(mermaid).toContain('idle([idle])');
        expect(mermaid).toMatch(/idle -\. enter \.-> s\d+/);
        // Two intermediate states — square-bracket node shape with instruction-derived names.
        expect(mermaid).toContain('["20"]');
        expect(mermaid).toContain('["30"]');

        // Each of the 4 transitions described in the README's reading guide.
        // Engine v7 edge-label vocabulary: ['x'] = literal symbol, [B] = blank, [*] = any-other,
        // [K] = keep, [E] = erase; movements [L]/[R]/[S].
        expect(mermaid).toMatch(/s\d+ -- "\['\*'\] → \[K\]\/\[S\]" --> s\d+/);
        expect(mermaid).toMatch(/s\d+ -- "\[B\] → \[K\]\/\[S\]" --> s\d+/);
        expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \[K\]\/\[R\]" --> s\d+/);
        expect(mermaid).toMatch(/s\d+ -- "\[\*\] → \['\*'\]\/\[S\]" --> s\d+/);
      });
    });

    describe('Structural summary — summarizePostMachine', () => {
      test('inline vs subroutine have different graph shape', () => {
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

        // console.log(a.stateCount, a.compositionEdgeCount, a.maxCompositionDepth); // 4 0 0
        expect(a.stateCount).toBe(4);
        expect(a.compositionEdgeCount).toBe(0);
        expect(a.maxCompositionDepth).toBe(0);

        // Under #85, `walkToBlank` is acyclic + has a plain first instruction
        // (check), so its hopper is dropped. The subroutine contributes 2
        // body states (walkToBlank::1, walkToBlank::2) + 1 continuation +
        // the wrapper at instruction 10 + the top-level mark = 6 nodes
        // (vs alpha.2's 7 with the hopper).
        // console.log(b.stateCount, b.compositionEdgeCount, b.maxCompositionDepth); // 6 1 1
        expect(b.stateCount).toBe(6);
        expect(b.compositionEdgeCount).toBe(1);
        expect(b.maxCompositionDepth).toBe(1);

        // The README's Structural summary section shows both machines'
        // toMermaid emits in <details> blocks alongside the counts. Pin the
        // salient shape features so the doc claim "this is what the engine
        // emits" doesn't go stale (looser-shape checks per existing repo
        // convention; the engine repo has stricter normalized snapshots).
        const inlineMermaid = toMermaid(State.toGraph(inline.initialState, inline.tapeBlock));
        const subMermaid = toMermaid(State.toGraph(withSubroutine.initialState, withSubroutine.tapeBlock));

        // inline: flat graph, no subgraph, no wrapper (no `sN[[…]]` shape; the
        // `[[` in `%% alphabets: [[" ","*"]]` is the JSON-stringified header).
        expect(inlineMermaid).not.toMatch(/subgraph w_/);
        expect(inlineMermaid).not.toMatch(/s\d+\[\[/);
        expect(inlineMermaid).not.toMatch(/== "call" ==>/);
        expect(inlineMermaid).toMatch(/idle -\. enter \.-> s\d+/);

        // withSubroutine: wrapper outside the subgraph + callable-subtree shape.
        // Under #85 the hopper is dropped — the wrapper wraps walkToBlank::1
        // directly, not a bare named 'walkToBlank'.
        expect(subMermaid).toMatch(/subgraph w_\d+\["callable subtree of walkToBlank::1"\]/);
        expect(subMermaid).toContain('[["walkToBlank::1(10~20)"]]'); // wrapper composite
        expect(subMermaid).toContain('["walkToBlank::1"]');          // bare, inside subgraph
        expect(subMermaid).not.toContain('["walkToBlank"]');         // hopper dropped
        expect(subMermaid).toContain('["10~20"]');                // continuation
        expect(subMermaid).toMatch(/s\d+ == "call" ==> s\d+/);    // wrapper → bare
        expect(subMermaid).toMatch(/w_\d+ -\. "return" \.-> s\d+/);
        expect(subMermaid).not.toMatch(/onHalt/);
      });
    });

    describe('Behavioral equivalence — equivalentPostMachines', () => {
      test('reports allAgree false when candidate forgot to mark', () => {
        const reference = new PostMachine({
          10: check(20, 30), 20: right(10), 30: mark, 40: stop,
        });
        const candidate = new PostMachine({
          10: check(20, 30), 20: right(10), 30: stop,
        });

        const report = equivalentPostMachines(reference, candidate, ['** ']);

        // console.log(report.allAgree); // false
        expect(report.allAgree).toBe(false);
      });
    });
  });

  describe('Path-based resolver (v6.1.0+)', () => {
    test('top-level instruction is reachable by string and object path', () => {
      const pm = new PostMachine({ 10: mark, 20: stop });

      expect(pm.stateAt('10')).toBeInstanceOf(State);
      expect(pm.hasState('10')).toBe(true);
      expect(pm.hasState('999')).toBe(false);
      expect(pm.candidatesFor('10')).toEqual([{ instructionIndex: 10 }]);
    });

    test('object-form paths accept both scope string and array', () => {
      const pm = new PostMachine({
        10: stop,
        sub: { 1: mark, 2: stop },
        outer: { 1: stop, inner: { 1: mark, 2: stop } },
      });

      expect(pm.stateAt({ instructionIndex: 10 })).toBeInstanceOf(State);
      expect(pm.stateAt({ scope: 'sub', instructionIndex: 1 })).toBeInstanceOf(State);
      expect(pm.stateAt({ scope: ['outer', 'inner'], instructionIndex: 1 })).toBeInstanceOf(State);
    });
  });

  describe('Breakpoints (v6.1.0+)', () => {
    test('registered breakpoint fires onPause with arrivalPath', async () => {
      const pm = new PostMachine({
        10: check(20, 30),
        20: right(10),
        30: mark,
        40: stop,
      });

      pm.replaceTapeWith(new Tape({ alphabet: pm.tape.alphabet, symbols: ['*', '*', ' '] }));

      pm.setBreakpoint('30', { before: true });

      const paused: number[] = [];
      await pm.run({
        onPause: (m: MachineState) => {
          paused.push(m.arrivalPath.instructionIndex);
        },
      });

      expect(paused).toContain(30);
    });

    test('listBreakpoints / clearBreakpoint / clearBreakpoints round-trip', () => {
      const pm = new PostMachine({ 10: mark, 20: stop });

      pm.setBreakpoint('10', { before: true });
      expect(pm.listBreakpoints()).toHaveLength(1);

      pm.clearBreakpoint('10');
      expect(pm.listBreakpoints()).toEqual([]);

      pm.setBreakpoint('10', { before: true });
      pm.clearBreakpoints();
      expect(pm.listBreakpoints()).toEqual([]);
    });
  });

  describe('Lockdown semantics (v6.1.0+)', () => {
    test('direct write on un-shared State redirects to setBreakpoint', () => {
      const pm = new PostMachine({ 10: mark, 20: stop });

      pm.stateAt('10').debug = { before: true };

      expect(pm.listBreakpoints()).toEqual([
        { kind: 'instruction', path: { instructionIndex: 10 }, filter: { before: true } },
      ]);
    });

    test('direct write of null redirects to clearBreakpoint', () => {
      const pm = new PostMachine({ 10: mark, 20: stop });

      pm.setBreakpoint('10', { before: true });
      pm.stateAt('10').debug = null;

      expect(pm.listBreakpoints()).toEqual([]);
    });
  });
});
