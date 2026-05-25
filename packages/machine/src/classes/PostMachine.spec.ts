import {
  PostMachine, call, check, erase, left, mark, noop, right, stop, Tape,
} from '../index';
import { subroutineNameValidator } from '../validators';
import { getIxRange, getRandomInstructionIndex } from './PostMachine.test-helpers';

// matchedTransition.id embeds process-global stateIds (turing-machine-js#205)
// — strip it for cross-machine call-record equality.
function stripMatchedTransition(calls: unknown[][]): unknown[][] {
  return calls.map((args) => args.map((arg) => {
    if (arg && typeof arg === 'object' && 'matchedTransition' in arg) {
      const { matchedTransition, ...rest } = arg as Record<string, unknown>;
      void matchedTransition;
      return rest;
    }
    return arg;
  }));
}

describe('constructor', () => {
  test('no instructions', () => {
    expect(() => {
      new PostMachine();
    })
      .toThrow('there is no instructions');

    expect(() => {
      new PostMachine({});
    })
      .toThrow('there is no instructions');

    expect(() => {
      new PostMachine({
        a: null as never, // not integer index
      });
    })
      .toThrow('there is no instructions');
  });

  test('invalid instructions indexes', () => {
    expect(() => {
      new PostMachine({
        [Symbol('a')]: null, // symbol index
      });
    })
      .toThrow('invalid instruction index(es)');
  });

  describe('invalid next instruction index', () => {
    [erase, left, mark, noop, right].forEach((fn) => {
      test(fn.name, () => {
        const ix = getRandomInstructionIndex();
        const nextIx = ix + 1;

        expect(() => {
          new PostMachine({
            [ix]: fn(),
          });
        })
          .toThrow('invalid next instruction index: undefined');

        [undefined, null, ' ', Math.random()].forEach((invalidIx) => {
          expect(() => {
          new PostMachine({
              [ix]: fn(invalidIx as number | symbol),
            });
          })
            .toThrow(`invalid next instruction index: ${invalidIx}`);
        });

        expect(() => {
          new PostMachine({
            [ix]: fn(nextIx),
          });
        })
          .toThrow(`invalid next instruction index: ${nextIx}`);

        expect(() => {
          new PostMachine({
            [ix]: fn(ix),
          });
        })
          .toThrow(`infinite loop at instruction ${ix}`);
      });
    });

    test(call.name, () => {
      const ix = getRandomInstructionIndex();
      const nextIx = ix + 1;
      const subroutineName = `subroutine${ix + 2}`;

      [undefined, null, ' ', Math.random()].forEach((invalidIx) => {
        expect(() => {
          new PostMachine({
            [subroutineName]: {
              [ix]: noop,
            },
            [ix]: call(subroutineName, invalidIx as number),
          });
        })
          .toThrow(`invalid next instruction index: ${invalidIx}`);
      });

      expect(() => {
          new PostMachine({
          [subroutineName]: {
            [ix]: noop,
          },
          [ix]: call(subroutineName, nextIx),
        });
      })
        .toThrow(`invalid next instruction index: ${nextIx}`);

      expect(() => {
          new PostMachine({
          [subroutineName]: {
            [ix]: noop,
          },
          [ix]: call(subroutineName, ix),
        });
      })
        .toThrow(`infinite loop at instruction ${ix}`);
    });

    test(check.name, () => {
      const ix = getRandomInstructionIndex();
      const nextIx = ix + 1;

      expect(() => {
          new PostMachine({
          [ix]: (check as (...args: unknown[]) => unknown)() as never,
        });
      })
        .toThrow('invalid next instruction index: undefined');

      expect(() => {
          new PostMachine({
          [ix]: (check as (...args: unknown[]) => unknown)(ix) as never,
        });
      })
        .toThrow('invalid next instruction index: undefined');

      expect(() => {
          new PostMachine({
          [ix]: (check as (...args: unknown[]) => unknown)(undefined, ix) as never,
        });
      })
        .toThrow('invalid next instruction index: undefined');

      expect(() => {
          new PostMachine({
          [ix]: check(ix, ix),
        });
      })
        .toThrow('next instruction indexes for this command must be unique');

      [' ', Math.random()].forEach((invalidIx) => {
        expect(() => {
          new PostMachine({
            [ix]: check(nextIx, invalidIx as number),
            [nextIx]: noop,
          });
        })
          .toThrow(`invalid next instruction index: ${invalidIx}`);

        expect(() => {
          new PostMachine({
            [ix]: check(invalidIx as number, nextIx),
            [nextIx]: noop,
          });
        })
          .toThrow(`invalid next instruction index: ${invalidIx}`);
      });

      expect(() => {
          new PostMachine({
          [ix]: check(ix, nextIx),
        });
      })
        .toThrow(`invalid next instruction index: ${nextIx}`);

      expect(() => {
          new PostMachine({
          [ix]: check(nextIx, ix),
        });
      })
        .toThrow(`invalid next instruction index: ${nextIx}`);

      expect(() => {
          new PostMachine({
          [ix]: check(ix, nextIx),
          [nextIx]: noop,
        });
      })
        .toThrow(`potential infinite loop at instruction ${ix}`);

      expect(() => {
          new PostMachine({
          [ix]: check(nextIx, ix),
          [nextIx]: noop,
        });
      })
        .toThrow(`potential infinite loop at instruction ${ix}`);
    });
  });

  describe('invalid instruction', () => {
    [undefined, null, 'a string', Math.random(), Symbol('for test purpose'), {}, function aFunction() {}].forEach((command) => {
      test(String(command), () => {
        expect(() => {
          new PostMachine({
            10: command as never,
          });
        })
          .toThrow('invalid instruction');
      });
    });
  });

  test(`invalid '${call.name}' command subroutine name`, () => {
    const ix = getRandomInstructionIndex();
    const invalidSubroutineName = String(ix);

    expect(subroutineNameValidator(invalidSubroutineName))
      .toBe(false);

    expect(() => {
      new PostMachine({
        [ix]: call(invalidSubroutineName),
      });
    })
      .toThrow(`invalid subroutine name: '${invalidSubroutineName}'`);
  });

  // Regression: subroutine-name regex must be fully anchored — reject
  // leading-digit and embedded-space names.
  describe('subroutineNameValidator anchor regression', () => {
    ['1abc', 'foo bar', '$$ x', 'a/b', '!name'].forEach((name) => {
      test(`rejects ${JSON.stringify(name)}`, () => {
        expect(subroutineNameValidator(name)).toBe(false);
      });
    });

    ['foo', '_foo', '$foo', 'F_2', '$_$_'].forEach((name) => {
      test(`accepts ${JSON.stringify(name)}`, () => {
        expect(subroutineNameValidator(name)).toBe(true);
      });
    });
  });

  describe('inappropriate command usage', () => {
    [call, check].forEach((fn) => {
      test(fn.name, () => {
        // using 'call' or 'check' without parenthesis
        const ix = getRandomInstructionIndex();

        expect(() => {
          new PostMachine({
            [ix]: fn as never,
          });
        })
          .toThrow(`inappropriate '${fn.name}' command usage at instruction ${ix}`);
      });
    });

    test('stop', () => {
      // using 'stop' with parenthesis
      const ix = getRandomInstructionIndex();
      const nextIx = ix + 1;

      expect(() => {
          new PostMachine({
          [ix]: stop(),
        });
      })
        .toThrow('inappropriate \'stop\' command usage');

      expect(() => {
          new PostMachine({
          [ix]: stop(nextIx),
        });
      })
        .toThrow('inappropriate \'stop\' command usage');

      expect(() => {
          new PostMachine({
          [ix]: stop(ix),
        });
      })
        .toThrow('inappropriate \'stop\' command usage');
    });
  });

  describe('subroutines', () => {
    const ix = getRandomInstructionIndex();

    test('non integer keys are valid', () => {
      expect(() => {
          new PostMachine({
          subroutine: {
            [ix]: noop,
          },
          [ix]: noop,
        });
      })
        .not.toThrow();

      expect(() => {
          new PostMachine({
          subroutine: {
            subSubroutine: {
              [ix]: noop,
            },
            [ix]: noop,
          },
          [ix]: noop,
        });
      })
        .not.toThrow('invalid instruction index(es)');
    });

    test('invalid subroutine name', () => {
      [' ', Math.random()].forEach((subRoutineName) => {
        expect(() => {
          new PostMachine({
            [subRoutineName]: {
              [ix]: noop,
            },
            [ix]: noop,
          });
        })
          .toThrow(`invalid subroutine name: '${subRoutineName}'`);
      });
    });

    test('\'undefined\' subroutine name', () => {
      expect(() => {
          new PostMachine({
          [undefined as unknown as string]: {
            [ix]: noop,
          },
          [ix]: call('undefined'),
        });
      })
        .toThrow('invalid subroutine name: \'undefined\'');
    });

    test('an undefined subroutine call', () => {
      expect(() => {
          new PostMachine({
          subroutine: {
            [ix]: noop,
          },
          [ix]: call('undefinedSubroutine'),
        });
      })
        .toThrow(/^undefined '.*?' subroutine$/);
    });
  });
});

describe('run tests', () => {
  test('run', async () => {
    const ixList = getIxRange(11);
    const machine = new PostMachine({
      [ixList[1]]: erase,
      [ixList[2]]: right,
      [ixList[3]]: check(ixList[2], ixList[4]),
      [ixList[4]]: mark,
      [ixList[5]]: right,
      [ixList[6]]: check(ixList[7], ixList[9]),
      [ixList[7]]: left,
      [ixList[8]]: stop,
      [ixList[9]]: left,
      [ixList[10]]: check(ixList[9], ixList[11]),
      [ixList[11]]: right(ixList[1]),
    });

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', '*', ' ', ' ', ' ', '*'],
    }));

    const onStepMock = vi.fn();

    const exactStepCount = 49;

    await machine.run({ stepsLimit: exactStepCount, onStep: () => onStepMock() });

    expect(machine.tape.symbols.join('').trim()).toBe('****');
    expect(onStepMock).toHaveBeenCalledTimes(exactStepCount);
  });

  describe('last and next command', () => {
    [erase, left, mark, noop, right].forEach((fn) => {
      test(fn.name, async () => {
        const ixList = getIxRange(2);
        const machine1 = new PostMachine({
          [ixList[1]]: fn,
        });
        const machine2 = new PostMachine({
          [ixList[1]]: fn(ixList[2]),
          [ixList[2]]: stop,
        });
        const machine3 = new PostMachine({
          [ixList[1]]: fn,
          [ixList[2]]: stop,
        });

        const onStepMock1 = vi.fn();
        const onStepMock2 = vi.fn();
        const onStepMock3 = vi.fn();

        await expect(machine1.run({ stepsLimit: 1, onStep: (stepData) => onStepMock1(stepData) })).resolves.toBeUndefined();
        await expect(machine2.run({ stepsLimit: 1, onStep: (stepData) => onStepMock2(stepData) })).resolves.toBeUndefined();
        await expect(machine3.run({ stepsLimit: 1, onStep: (stepData) => onStepMock3(stepData) })).resolves.toBeUndefined();
        expect(onStepMock1).toHaveBeenCalledTimes(1);
        expect(onStepMock2).toHaveBeenCalledTimes(1);
        expect(onStepMock3).toHaveBeenCalledTimes(1);
        expect(stripMatchedTransition(onStepMock1.mock.calls))
          .toEqual(stripMatchedTransition(onStepMock2.mock.calls));
        expect(stripMatchedTransition(onStepMock2.mock.calls))
          .toEqual(stripMatchedTransition(onStepMock3.mock.calls));
      });
    });

    test(call.name, async () => {
      const ixList = getIxRange(2);
      const subroutineName = `subroutine${ixList[1]}`;
      const subroutines = {
        [subroutineName]: {
          [ixList[1]]: noop,
        },
      };
      const machine1 = new PostMachine({
        ...subroutines,
        [ixList[1]]: call(subroutineName),
      });
      const machine2 = new PostMachine({
        ...subroutines,
        [ixList[1]]: call(subroutineName, ixList[2]),
        [ixList[2]]: stop,
      });
      const machine3 = new PostMachine({
        ...subroutines,
        [ixList[1]]: call(subroutineName),
        [ixList[2]]: stop,
      });

      const onStepMock1 = vi.fn();
      const onStepMock2 = vi.fn();
      const onStepMock3 = vi.fn();

      await expect(machine1.run({
        stepsLimit: 3,
        onStep: (...args) => onStepMock1(...args),
      })).resolves.toBeUndefined();
      await expect(machine2.run({
        stepsLimit: 3,
        onStep: (...args) => onStepMock2(...args),
      })).resolves.toBeUndefined();
      await expect(machine3.run({
        stepsLimit: 3,
        onStep: (...args) => onStepMock3(...args),
      })).resolves.toBeUndefined();
      // 2 iters: wrapper-of-noop fires once, then post-iter halt dispatch.
      // (Acyclic + plain-first-instruction subroutine wraps the body directly,
      // no hopper iter.)
      expect(onStepMock1).toHaveBeenCalledTimes(2);
      expect(onStepMock2).toHaveBeenCalledTimes(2);
      expect(onStepMock3).toHaveBeenCalledTimes(2);
      expect(stripMatchedTransition(onStepMock1.mock.calls))
        .toEqual(stripMatchedTransition(onStepMock2.mock.calls));
      expect(stripMatchedTransition(onStepMock2.mock.calls))
        .toEqual(stripMatchedTransition(onStepMock3.mock.calls));
    });
  });

  describe(`the '${call.name}' command`, () => {
    test('a subroutine call', async () => {
      const ixList = getIxRange(3);
      const subroutineName = `ToRightAndMark${ixList[0]}`;
      const machine = new PostMachine({
        [subroutineName]: {
          [ixList[1]]: right,
          [ixList[2]]: mark,
        },
        [ixList[1]]: call(subroutineName),
        [ixList[2]]: call(subroutineName),
        [ixList[3]]: call(subroutineName),
      });

      await expect(machine.run()).resolves.toBeUndefined();

      expect(machine.tape.symbols.join('').trim())
        .toBe('***');
    });

    test('subroutine call order', async () => {
      const ixList = getIxRange(4);
      const toBeginSubroutineName = `ToBegin${ixList[0]}`;
      const toEndSubroutineName = `ToEnd${ixList[0]}`;

      const subroutines = {
        [toBeginSubroutineName]: {
          [ixList[1]]: left,
          [ixList[2]]: check(ixList[1], ixList[3]),
          [ixList[3]]: right,
        },
        [toEndSubroutineName]: {
          [ixList[1]]: right,
          [ixList[2]]: check(ixList[1], ixList[3]),
          [ixList[3]]: left,
        },
      };

      const machineList = [
        new PostMachine({
          ...subroutines,
          [ixList[1]]: call(toBeginSubroutineName),
          [ixList[2]]: call(toEndSubroutineName),
          [ixList[3]]: erase,
        }),
        new PostMachine({
          ...subroutines,
          [ixList[1]]: call(toEndSubroutineName),
          [ixList[2]]: call(toBeginSubroutineName),
          [ixList[3]]: erase,
        }),
        new PostMachine({
          ...subroutines,
          [ixList[1]]: noop(ixList[3]),
          [ixList[2]]: call(toEndSubroutineName, ixList[4]),
          [ixList[3]]: call(toBeginSubroutineName, ixList[2]),
          [ixList[4]]: erase,
        }),
        new PostMachine({
          ...subroutines,
          [ixList[1]]: noop(ixList[3]),
          [ixList[2]]: call(toBeginSubroutineName, ixList[4]),
          [ixList[3]]: call(toEndSubroutineName, ixList[2]),
          [ixList[4]]: erase,
        }),
      ];

      for (const machine of machineList) {
        machine.replaceTapeWith(new Tape({
          alphabet: machine.tape.alphabet,
          symbols: '***  *'.split(''),
        }));
        await expect(machine.run()).resolves.toBeUndefined();
      }
      expect(machineList.map((machine) => machine.tape.symbols.join('').trim()))
        .toEqual(machineList.map((_, ix) => (
          ix % 2 === 0
            ? '**   *'
            : '**  *'
        )));
    });
  });

  test('sub-subroutines', async () => {
    const ixList = getIxRange(2);
    const subroutineNameList = [...Array(2)].map((_, ix) => `sr${ixList[0] + ix}`);
    const machine = new PostMachine({
      [subroutineNameList[0]]: {
        [subroutineNameList[0]]: {
          [ixList[1]]: erase,
        },
        [ixList[1]]: call(subroutineNameList[1]),
        [ixList[2]]: call(subroutineNameList[0]),
      },
      [subroutineNameList[1]]: {
        [ixList[1]]: mark,
      },
      [ixList[1]]: call(subroutineNameList[0]),
    });

    const onStepMock = vi.fn();

    await expect(machine.run({
      onStep: (...args) => onStepMock(...args),
    })).resolves.toBeUndefined();

    // Outer `subroutineNameList[0]` keeps its hopper — the static analyzer
    // sees its body calling 'sub0' as a lexical self-reference and
    // conservatively classifies it as cyclic (runtime would resolve through
    // shadowing, but the analyzer doesn't model scope shadowing).
    // The other two subs are acyclic + plain-first-instruction → no hopper.
    expect(onStepMock).toHaveBeenCalledTimes(6);
    expect(machine.tape.viewport[0]).toEqual(' ');

    const nextSymbolHistory = onStepMock.mock.calls.map((aCall) => aCall[0].nextSymbols[0]);

    expect(nextSymbolHistory.filter((symbol, ix, list) => list.indexOf(symbol) === ix)).toEqual([' ', '*']);
  });

  describe('states count minification', () => {
    [erase, left, mark, noop, right].forEach((fn) => {
      test(fn.name, async () => {
        const ix1 = getRandomInstructionIndex();
        const ix2 = ix1 + 1;
        const ix3 = ix2 + 1;

        const machine1 = new PostMachine({
          [ix1]: fn,
          [ix2]: noop,
          [ix3]: fn(ix2),
        });
        const machine2 = new PostMachine({
          [ix1]: fn(ix2),
          [ix2]: noop,
          [ix3]: fn(ix2),
        });
        const machine1OnStepMock = vi.fn();
        const machine2OnStepMock = vi.fn();

        await expect(machine1.run({
          stepsLimit: 3,
          onStep: (...args) => machine1OnStepMock(...args),
        })).rejects.toThrow('Long execution');

        await expect(machine2.run({
          stepsLimit: 3,
          onStep: (...args) => machine2OnStepMock(...args),
        })).rejects.toThrow('Long execution');

        const machine1StateIdList = machine1OnStepMock.mock.calls.map((args) => args[0].state.id);
        const machine2StateIdList = machine2OnStepMock.mock.calls.map((args) => args[0].state.id);

        expect(machine1StateIdList[0]).not.toBe(machine1StateIdList[1]);
        expect(machine1StateIdList[0]).toBe(machine1StateIdList[2]);
        expect(machine2StateIdList[0]).not.toBe(machine2StateIdList[1]);
        expect(machine2StateIdList[0]).toBe(machine2StateIdList[2]);
      });
    });

    test(call.name, async () => {
      const ix1 = getRandomInstructionIndex();
      const ix2 = ix1 + 1;
      const ix3 = ix2 + 1;
      const subroutineName = `subroutine${ix1}`;

      const machine1 = new PostMachine({
        [subroutineName]: {
          [ix1]: noop,
        },
        [ix1]: call(subroutineName),
        [ix2]: noop,
        [ix3]: call(subroutineName, ix2),
      });
      const machine2 = new PostMachine({
        [subroutineName]: {
          [ix1]: noop,
        },
        [ix1]: call(subroutineName, ix2),
        [ix2]: noop,
        [ix3]: call(subroutineName, ix2),
      });
      const machine1OnStepMock = vi.fn();
      const machine2OnStepMock = vi.fn();

      await expect(machine1.run({
        stepsLimit: 10,
        onStep: (...args) => machine1OnStepMock(...args),
      })).rejects.toThrow('Long execution');

      await expect(machine2.run({
        stepsLimit: 10,
        onStep: (...args) => machine2OnStepMock(...args),
      })).rejects.toThrow('Long execution');

      const regExp = /\(/;
      const machine1StateIdList = machine1OnStepMock.mock.calls
        .map((args) => args[0].state.name)
        .filter((name) => regExp.test(name))
        .filter((name, ix, list) => list.indexOf(name) === ix);
      const machine2StateIdList = machine2OnStepMock.mock.calls
        .map((args) => args[0].state.name)
        .filter((name) => regExp.test(name))
        .filter((name, ix, list) => list.indexOf(name) === ix);

      expect(machine1StateIdList.length).toBe(1);
      expect(machine2StateIdList.length).toBe(1);
    });

    test(check.name, async () => {
      const ix1 = getRandomInstructionIndex();
      const ix2 = ix1 + 1;
      const ix3 = ix2 + 1;
      const ix4 = ix3 + 1;

      const machine = new PostMachine({
        [ix1]: check(ix3, ix4),
        [ix2]: check(ix3, ix4),
        [ix3]: noop(ix2),
        [ix4]: noop(ix2),
      });
      const machineOnStepMock = vi.fn();

      await expect(machine.run({
        stepsLimit: 10,
        onStep: (...args) => machineOnStepMock(...args),
      })).rejects.toThrow('Long execution');

      const machine1StateIdList = machineOnStepMock.mock.calls
        .map((args) => args[0].state.id);

      expect(machine1StateIdList[0]).toEqual(machine1StateIdList[2]);
    });
  });

  describe('commands groups', () => {
    const ixList = getIxRange(3);
    const subroutineName = `subroutine${ixList[0]}`;

    test('empty group', () => {
      expect(() => {
          new PostMachine({
          [ixList[1]]: [],
        });
      })
        .toThrow('empty group');
    });

    describe('invalid command in the group', () => {
      [undefined, null, 'a string', Math.random(), Symbol('for test purpose'), {}, ['an', 'array'], function aFunction() {}].forEach((command) => {
        test(String(command), () => {
          expect(() => {
          new PostMachine({
              [ixList[1]]: [
                command as never,
              ],
            });
          })
            .toThrow('invalid command in the group');
        });
      });

      test(check.name, () => {
        expect(() => {
          new PostMachine({
            [ixList[1]]: [
              check(2, 3),
              noop,
              noop,
            ],
            [ixList[2]]: noop,
            [ixList[3]]: noop,
          });
        })
          .toThrow('the \'check\' command cannot be used in a group');
      });

      test(stop.name, () => {
        expect(() => {
          new PostMachine({
            [ixList[1]]: mark,
            [ixList[2]]: [
              stop,
            ],
            [ixList[3]]: erase,
          });
        })
          .toThrow('the \'stop\' command cannot be used in a group');
      });
    });

    describe('command without the next instruction index', () => {
      [erase, left, mark, noop, right].forEach((fn) => {
        test(fn.name, () => {
          expect(() => {
          new PostMachine({
              [ixList[1]]: [
                fn,
              ],
            });
          })
            .not.toThrow();
        });
      });

      test(call.name, () => {
        expect(() => {
          new PostMachine({
            [subroutineName]: {
              [ixList[1]]: noop,
            },
            [ixList[1]]: [
              call(subroutineName),
            ],
          });
        })
          .not.toThrow();
      });
    });

    describe('command with the next instruction index', () => {
      [erase, left, mark, noop, right].forEach((fn) => {
        test(fn.name, () => {
          expect(() => {
          new PostMachine({
              [ixList[1]]: [
                fn(ixList[2]),
                noop,
              ],
              [ixList[2]]: noop,
            });
          })
            .toThrow('inappropriate command usage in a group');
        });
      });

      test(call.name, () => {
        expect(() => {
          new PostMachine({
            [subroutineName]: {
              [ixList[1]]: noop,
            },
            [ixList[1]]: [
              call(subroutineName, ixList[2]),
              noop,
            ],
            [ixList[2]]: noop,
          });
        })
          .toThrow('inappropriate command usage in a group');
      });
    });

    test('the next instruction was executed', async () => {
      const machine = new PostMachine({
        [ixList[1]]: [
          mark,
          right,
          mark,
          right,
          mark,
        ],
        [ixList[2]]: erase,
      });

      await expect(machine.run()).resolves.toBeUndefined();

      expect(machine.tape.symbols.join('').trim())
        .toBe('**');
    });

    test('call works', async () => {
      const machine = new PostMachine({
        [subroutineName]: {
          [ixList[1]]: erase,
        },
        [ixList[1]]: [
          mark,
          right,
          mark,
          call(subroutineName),
          right,
          mark,
        ],
      });

      await expect(machine.run()).resolves.toBeUndefined();

      expect(machine.tape.symbols.join('').trim())
        .toBe('* *');
    });
  });

  test('stepByStep', () => {
    const ixList = getIxRange(2);
    const machine = new PostMachine({
      [ixList[1]]: noop,
      [ixList[2]]: noop,
    });

    expect([...machine.runStepByStep()].length)
      .toBe(2);
  });
});
