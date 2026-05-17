// PostMachine debugger surface — async run() semantics and the experimental
// onPause forwarding. Mirrors v3.spec.ts structure; both files
// stay non-README (README-driven tests live in examples.spec.ts).

import {
  PostMachine,
  Tape,
  type MachineState,
  check, mark, right, stop,
} from '../src/index';

describe('PostMachine — async run', () => {
  function buildWalkAndMark(): PostMachine {
    return new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: mark,
      40: stop,
    });
  }

  test('run() returns a Promise', () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    const result = machine.run();
    expect(result).toBeInstanceOf(Promise);
    return result; // ensure jest waits for halt
  });

  test('run() resolves only after the machine halts', async () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    // Before run resolves, the tape should be the input.
    expect(machine.tape.symbols.join('').trim()).toBe('**');

    await machine.run();

    expect(machine.tape.symbols.join('').trim()).toBe('***');
  });

  test('onStep still observes every step', async () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    const seen: number[] = [];
    await machine.run({
      onStep: (s: MachineState) => { seen.push(s.step); },
    });

    expect(seen.length).toBeGreaterThan(0);
    // Steps are 1-indexed and monotonically increasing.
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(seen.length);
  });
});

describe('PostMachine — onPause forwarding', () => {
  test('onPause fires when state.debug is set on a reachable state', async () => {
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

    // Attach a `before` breakpoint on the initial state. Per turing v4,
    // setting `state.debug` is runtime-mutable; the upstream run() loop
    // checks it on each iteration boundary.
    machine.initialState.debug = { before: true };

    const seen: MachineState[] = [];
    await machine.run({
      onPause: (s) => { seen.push(s); },
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].debugBreak).toEqual({ before: true });
  });

  test('run() awaits an async onPause before resolving', async () => {
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

    machine.initialState.debug = { before: true };

    let asyncCallbackResolved = false;
    await machine.run({
      onPause: async () => {
        await new Promise((r) => setTimeout(r, 10));
        asyncCallbackResolved = true;
      },
    });

    // If run() resolved before the async callback finished, this would be false.
    expect(asyncCallbackResolved).toBe(true);
  });
});
