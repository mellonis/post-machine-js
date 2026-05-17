import {
  PostMachine,
  State,
  Tape,
  alphabet,
  blankSymbol,
  markSymbol,
  call, check, left, mark, right, stop,
  toMermaid,
  summarizePostMachine,
  equivalentPostMachines,
} from '../src/index';

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

      // Halt + the entry-state with composite name. The wrapper at top-level instruction 1
      // is `call('rightToBlank')`, so the composite reads as `<hopper>><continuation>` —
      // here `"rightToBlank>1~2"` (subroutine hopper named after the subroutine, continuation
      // forwards from instr 1 to instr 2).
      expect(mermaid).toContain('(((halt)))');
      expect(mermaid).toContain('(("rightToBlank>1~2"))');

      // The dotted onHalt edge — the override path back from the subroutine.
      expect(mermaid).toMatch(/s\d+ -\. onHalt \.-> s\d+/);

      // The subroutine's internal cycle: a right-move state and a check state
      // that loops back on '*' and exits on the blank.
      expect(mermaid).toMatch(/s\d+ -- "\* → ·\/R" --> s\d+/);   // right (keep + R)
      expect(mermaid).toMatch(/s\d+ -- "\\\* → ·\/S" --> s\d+/); // check on '*'
      expect(mermaid).toMatch(/s\d+ -- "- → ·\/S" --> s\d+/);    // check on blank (ifOtherSymbol)

      // The mark instruction's edge: write '*', stay, transition to halt.
      expect(mermaid).toMatch(/s\d+ -- "\* → \*\/S" --> s\d+/);
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
    test('Quick example: machine.initialState.name === "foo>10~30"', () => {
      const m = new PostMachine({
        10: call('foo', 30),
        20: stop,
        30: stop,
        foo: { 1: stop },
      });

      // m.initialState.name === "foo>10~30"
      expect(m.initialState.name).toBe('foo>10~30');
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

        // Initial state — double-paren entry shape with instruction-derived name.
        expect(mermaid).toContain('(("10"))');
        // Two intermediate states — square-bracket node shape with instruction-derived names.
        expect(mermaid).toContain('["20"]');
        expect(mermaid).toContain('["30"]');

        // Each of the 4 transitions described in the README's reading guide.
        // Edge labels are exact as emitted; node IDs (s\d+) are not pinned.
        expect(mermaid).toMatch(/s\d+ -- "\\\* → ·\/S" --> s\d+/);
        expect(mermaid).toMatch(/s\d+ -- "- → ·\/S" --> s\d+/);
        expect(mermaid).toMatch(/s\d+ -- "\* → ·\/R" --> s\d+/);
        expect(mermaid).toMatch(/s\d+ -- "\* → \*\/S" --> s\d+/);
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

        // console.log(b.stateCount, b.compositionEdgeCount, b.maxCompositionDepth); // 6 1 1
        expect(b.stateCount).toBe(6);
        expect(b.compositionEdgeCount).toBe(1);
        expect(b.maxCompositionDepth).toBe(1);
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
});
