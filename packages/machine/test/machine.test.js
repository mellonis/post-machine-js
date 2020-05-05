import PostMachine, {
  call, check, erase, left, mark, noop, right, stop, Tape,
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

    expect(() => {
      // eslint-disable-next-line no-new
      new PostMachine({
        a: null, // not integer index
      });
    })
      .toThrow('there is no instructions');
  });

  test('invalid indexes', () => {
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
    [left, right, mark, erase, noop].forEach((fn) => {
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

  describe('the \'call\' command', () => {
    test('non integer keys', () => {
      expect(() => {
        // eslint-disable-next-line no-new
        new PostMachine({
          subroutine: {
            10: stop,
          },
          10: stop,
        });
      })
        .not.toThrow();

      expect(() => {
        // eslint-disable-next-line no-new
        new PostMachine({
          subroutine: {
            subSubroutine: {
              10: stop,
            },
            10: stop,
          },
          10: stop,
        });
      })
        .toThrow('invalid instruction index(es)');
    });

    test('an undefined subroutine call', () => {
      expect(() => {
        // eslint-disable-next-line no-new
        new PostMachine({
          subroutine: {
            10: stop,
          },
          10: call('undefinedSubroutine'),
        });
      })
        .toThrow(/^undefined '.*?' subroutine$/);
    });

    test('a subroutine call', () => {
      const machine = new PostMachine({
        ToRightAndMark: {
          10: right,
          20: mark,
        },
        10: call('ToRightAndMark'),
        20: call('ToRightAndMark'),
        30: call('ToRightAndMark'),
      });

      expect(() => {
        machine.run();
      })
        .not.toThrow();

      expect(machine.tape.symbolList.join('').trim())
        .toBe('***');
    });

    test('subroutine call order', () => {
      const subroutines = {
        ToBegin: {
          10: left,
          20: check(10, 30),
          30: right,
        },
        ToEnd: {
          10: right,
          20: check(10, 30),
          30: left,
        },
      };

      const machineList = [
        new PostMachine({
          ...subroutines,
          10: call('ToBegin'),
          20: call('ToEnd'),
          30: erase,
        }),
        new PostMachine({
          ...subroutines,
          10: call('ToEnd'),
          20: call('ToBegin'),
          30: erase,
        }),
        new PostMachine({
          ...subroutines,
          10: noop(30),
          20: call('ToEnd', 40),
          30: call('ToBegin', 20),
          40: erase,
        }),
        new PostMachine({
          ...subroutines,
          10: noop(30),
          20: call('ToBegin', 40),
          30: call('ToEnd', 20),
          40: erase,
        }),
      ];

      expect(() => {
        machineList.forEach((machine) => {
          // eslint-disable-next-line no-param-reassign
          machine.tape = new Tape({
            alphabet: machine.tape.alphabet,
            symbolList: '***  *'.split(''),
          });
          machine.run();
        });
      })
        .not.toThrow();
      expect(machineList.map((machine) => machine.tape.symbolList.join('').trim()))
        .toEqual(machineList.map((_, ix) => (
          ix % 2 === 0
            ? '**   *'
            : '**  *'
        )));
    });
  });
});
