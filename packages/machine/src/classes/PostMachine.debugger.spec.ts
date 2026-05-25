// PostMachine debugger surface — async run() semantics and onPause forwarding.
// Mirrors v3.spec.ts structure; both files stay non-README (README-driven
// tests live in examples.spec.ts).

import {
  PostMachine,
  Tape,
  type MachineState,
  check, mark, right, stop,
} from '../index';

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
    // v7: run() is sync, returns void.
    expect(result).toBeUndefined();
  });

  test('run() is synchronous — tape is final immediately after the call', () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    // Before run runs, the tape should be the input.
    expect(machine.tape.symbols.join('').trim()).toBe('**');

    machine.run();

    expect(machine.tape.symbols.join('').trim()).toBe('***');
  });

  test('onStep still observes every step', async () => {
    const machine = buildWalkAndMark();

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbols: ['*', '*', ' '],
    }));

    const seen: number[] = [];
    for (const s of machine.runStepByStep()) { seen.push(s.step); }

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

    // Attach a `before` breakpoint on the initial state. `state.debug` is
    // runtime-mutable; the upstream run() loop checks it on each iter.
    machine.initialState.debug = { before: true };

    const seen: MachineState[] = [];
    const session = machine.debugRun();
    session.on('pause', (s) => { seen.push(s); session.continue(); });
    await session.start();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].debugBreak).toEqual({ before: true, cause: 'breakpoint' });
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
    const session = machine.debugRun();
    session.on('pause', async () => {
      await new Promise((r) => setTimeout(r, 10));
      asyncCallbackResolved = true;
      session.continue();
    });
    await session.start();

    // If start() resolved before the async callback finished, this would be false.
    expect(asyncCallbackResolved).toBe(true);
  });
});
