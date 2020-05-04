import PostMachine, {
  left, right, mark, erase, check, stop, Tape,
} from '@post-machine-js/machine';

describe('run tests', () => {
  test('run', () => {
    const machine = new PostMachine({
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

    machine.tape = new Tape({
      alphabet: machine.tape.alphabet,
      symbolList: ['*', '*', '*', ' ', ' ', ' ', '*'],
    });

    const onStepMock = jest.fn();

    machine.run({ stepsLimit: 1, onStep: onStepMock });

    expect(machine.tape.symbolList.join('').trim()).toEqual('****');
  });
});
