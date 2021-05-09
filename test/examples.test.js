import PostMachine, {
  call, check, erase, left, mark, right, stop, Tape,
} from '@post-machine-js/machine';

describe('README.md', () => {
  describe('An example', () => {
    let machine;

    beforeAll(() => {
      machine = new PostMachine({
        10: erase,
        20: right,
        30: check(20, 40),
        40: mark,
        50: right,
        60: check(70, 90),
        70: left,
        80: stop,
        90: left,
        100: check(90, 110),
        110: right(10),
      });
    });

    test('***   * -> ****', () => {
      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbolList: ['*', '*', '*', ' ', ' ', ' ', '*'],
      }));

      // console.log(machine.tape.symbolList.join('').trim()); // ***   *

      expect(machine.tape.symbolList.join('').trim())
        .toBe('***   *');

      machine.run();

      // console.log(machine.tape.symbolList.join('').trim()); // ****

      expect(machine.tape.symbolList.join('').trim())
        .toBe('****');
    });
  });

  describe('An example with subroutines', () => {
    let machine;

    beforeAll(() => {
      machine = new PostMachine({
        leftAndGoToBlank: {
          1: left,
          2: check(1, 3),
          3: stop,
        },
        rightAndGoToBlank: {
          1: right,
          2: check(1, 3),
          3: stop,
        },
        markTwoCells: {
          1: [mark, right, mark],
        },
        1: call('leftAndGoToBlank'),
        2: [right, erase],
        3: call('rightAndGoToBlank'),
        4: call('rightAndGoToBlank'),
        5: call('markTwoCells'),
        6: call('leftAndGoToBlank'),
        7: left,
        8: check(1, 9),
        9: stop,
      });
    });

    test('* -> **', () => {
      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbolList: ['*'],
      }));

      // console.log(machine.tape.symbolList.join('').trim()); // *

      expect(machine.tape.symbolList.join('').trim())
        .toBe('*');

      machine.run();

      // console.log(machine.tape.symbolList.join('').trim()); // **

      expect(machine.tape.symbolList.join('').trim())
        .toBe('**');
    });

    test('*** -> ******', () => {
      machine.replaceTapeWith(new Tape({
        alphabet: machine.tape.alphabet,
        symbolList: ['*', '*', '*'],
      }));

      // console.log(machine.tape.symbolList.join('').trim()); // ***

      expect(machine.tape.symbolList.join('').trim())
        .toBe('***');

      machine.run();

      // console.log(machine.tape.symbolList.join('').trim()); // ******

      expect(machine.tape.symbolList.join('').trim())
        .toBe('******');
    });
  });
});
