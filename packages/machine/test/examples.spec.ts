import {
  PostMachine,
  State,
  Tape,
  call, check, left, mark, right, stop,
  toMermaid,
  summarizePostMachine,
  equivalentPostMachines,
} from '../src/index';

describe('packages/machine/README.md', () => {
  describe('Quick start', () => {
    test('** → marks first blank to make ***', () => {
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

      machine.run();

      // console.log(machine.tape.symbols.join('').trim()); // ***
      expect(machine.tape.symbols.join('').trim())
        .toBe('***');
    });
  });

  describe('Subroutines', () => {
    test('** → marks first blank to make *** (single subroutine, single call)', () => {
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

      // console.log(machine.tape.symbols.join('').trim()); // ***
      expect(machine.tape.symbols.join('').trim())
        .toBe('***');
    });

    test(' *  → *** by extending the region one cell on each side', () => {
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

      extend.run();

      // console.log(extend.tape.symbols.join('')); // ***
      expect(extend.tape.symbols.join(''))
        .toBe('***');
    });
  });

  describe('Custom symbols', () => {
    test('## → marks first . to make ### with .# alphabet', () => {
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

      // console.log(machine.tape.symbols.join('').replace(/\.+$/, '')); // ###
      expect(machine.tape.symbols.join('').replace(/\.+$/, ''))
        .toBe('###');
    });
  });

  describe('Introspection and equivalence', () => {
    describe('Visualization — toMermaid + State.toGraph', () => {
      test('first line is "flowchart TD"', () => {
        const machine = new PostMachine({
          10: check(20, 30),
          20: right(10),
          30: mark,
          40: stop,
        });

        const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

        // console.log(mermaid.split('\n')[0]); // flowchart TD
        expect(mermaid.split('\n')[0])
          .toBe('flowchart TD');
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
