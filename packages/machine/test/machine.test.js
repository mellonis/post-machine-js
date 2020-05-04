import PostMachine, {
  left, right, mark, erase, check, stop, Tape,
} from '@post-machine-js/machine';

describe('constructor', () => {
  test('no instructions', () => {
    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine();
    })
      .toThrow('there is no instructions');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({});
    })
      .toThrow('there is no instructions');
  });

  test('invalid indexes', () => {
    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        a: null, // not integer index
      });
    })
      .toThrow('invalid instruction index(es)');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        [Symbol('a')]: null, // symbol index
      });
    })
      .toThrow('invalid instruction index(es)');
  });

  test('invalid instruction index', () => {
    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: left(),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: left(20),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: left(10),
      });
    })
      .toThrow('infinite loop at instruction 10');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: right(),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: right(20),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: right(10),
      });
    })
      .toThrow('infinite loop at instruction 10');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: mark(),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: mark(20),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: mark(10),
      });
    })
      .toThrow('infinite loop at instruction 10');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: erase(),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: erase(20),
      });
    })
      .toThrow('invalid instruction index');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: erase(10),
      });
    })
      .toThrow('infinite loop at instruction 10');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: check(),
      });
    })
      .toThrow('invalid instruction index: undefined');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: check(10),
      });
    })
      .toThrow('invalid instruction index: undefined');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: check(10, 10),
      });
    })
      .toThrow('next instruction indexes for this command must be unique');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: check(10, 20),
        20: stop,
      });
    })
      .toThrow('potential infinite loop at instruction 10');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: check(20, 10),
        20: stop,
      });
    })
      .toThrow('potential infinite loop at instruction 10');

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        10: stop(),
      });
    })
      .toThrow('invalid \'stop\' command usage');
  });
});

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

    const exactStepCount = 49;

    machine.run({ stepsLimit: exactStepCount, onStep: () => onStepMock() });

    expect(machine.tape.symbolList.join('').trim()).toBe('****');
    expect(onStepMock.mock.calls.length).toBe(exactStepCount);
  });

  test('last and next command', () => {
    [left, right, mark, erase].forEach((fn) => {
      const machine1 = new PostMachine({
        10: fn,
      });
      const machine2 = new PostMachine({
        10: fn(20),
        20: stop,
      });
      const machine3 = new PostMachine({
        10: fn,
        20: stop,
      });

      const onStepMock1 = jest.fn();
      const onStepMock2 = jest.fn();
      const onStepMock3 = jest.fn();

      expect(() => {
        machine1.run({ stepsLimit: 1, onStep: (stepData) => onStepMock1(stepData) });
      })
        .not.toThrow();
      expect(() => {
        machine2.run({ stepsLimit: 1, onStep: (stepData) => onStepMock2(stepData) });
      })
        .not.toThrow();
      expect(() => {
        machine3.run({ stepsLimit: 1, onStep: (stepData) => onStepMock3(stepData) });
      })
        .not.toThrow();
      expect(onStepMock1.mock.calls.length).toBe(1);
      expect(onStepMock2.mock.calls.length).toBe(1);
      expect(onStepMock3.mock.calls.length).toBe(1);
      expect(onStepMock1.mock.calls).toEqual(onStepMock2.mock.calls);
      expect(onStepMock2.mock.calls).toEqual(onStepMock3.mock.calls);
    });
  });
});
