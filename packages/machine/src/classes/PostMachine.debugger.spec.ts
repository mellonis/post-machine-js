// PostMachine debugger surface — async run() semantics and onPause forwarding.
// Mirrors v3.spec.ts structure; both files stay non-README (README-driven
// tests live in examples.spec.ts).

import {
  PostMachine,
  Tape,
  haltState,
  call, check, mark, right, stop,
  formatPath,
  type Path,
} from '../index';

function formatArrival(p: Path): string {
  return formatPath(p);
}

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

    const seen: Array<{side: string; cause: string}> = [];
    const session = machine.debugRun();
    session.on('pause', (s) => { seen.push({side: s.pause.side, cause: s.pause.cause}); session.continue(); });
    await session.start();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual({ side: 'before', cause: 'breakpoint' });
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

describe('PostDebugSession — step controls and lifecycle', () => {
  test('stepIn() forces a step-cause pause on the next instruction', async () => {
    const machine = new PostMachine({ 10: mark, 20: mark, 30: stop });
    machine.setBreakpoint('10', { before: true });

    const causes: string[] = [];
    const session = machine.debugRun();
    let first = true;
    session.on('pause', (m) => {
      causes.push(m.pause.cause);
      if (first) { first = false; session.stepIn(); } else { session.continue(); }
    });
    await session.start();

    expect(causes[0]).toBe('breakpoint');
    expect(causes[1]).toBe('step');
  });

  test('stepOver() runs a called subroutine to completion, then pauses (cause: step)', async () => {
    const machine = new PostMachine({
      10: call('foo'),
      20: mark,
      30: stop,
      foo: { 1: mark, 2: stop },
    });
    machine.setBreakpoint('10', { before: true });

    const causes: string[] = [];
    const session = machine.debugRun();
    let first = true;
    session.on('pause', (m) => {
      causes.push(m.pause.cause);
      if (first) { first = false; session.stepOver(); } else { session.continue(); }
    });
    await session.start();

    expect(causes[0]).toBe('breakpoint');
    expect(causes).toContain('step');
  });

  test('stepOut() from inside a subroutine pops the frame back to the caller level', async () => {
    const machine = new PostMachine({
      10: call('foo'),
      20: mark,
      30: stop,
      foo: { 1: mark, 2: mark, 3: stop },
    });
    machine.setBreakpoint('10', { before: true });

    const causes: string[] = [];
    let phase = 0;
    const session = machine.debugRun();
    session.on('pause', (m) => {
      causes.push(m.pause.cause);
      if (phase === 0) { phase = 1; session.stepIn(); }        // descend into foo (depth >= 1)
      else if (phase === 1) { phase = 2; session.stepOut(); }  // pop foo's frame back to the caller
      else { session.continue(); }
    });
    await session.start();

    expect(causes[0]).toBe('breakpoint');
    expect(causes.length).toBeGreaterThanOrEqual(2);
    expect(causes.slice(1)).toContain('step');
  });

  describe('stepInstruction() — next-numbered-instruction in current scope (#101)', () => {
    test('atomic → next numbered atomic in same scope', async () => {
      const machine = new PostMachine({ 10: mark, 20: mark, 30: stop });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (paths.length === 1) session.stepInstruction();
        else session.continue();
      });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('20');
    });

    test('at a call(…) entry, stepInstruction runs the call to completion and lands on caller’s next instruction', async () => {
      const machine = new PostMachine({
        10: call('foo'),
        20: mark,
        30: stop,
        foo: { 1: mark, 2: stop },
      });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (paths.length === 1) session.stepInstruction();
        else session.continue();
      });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('20');
    });

    test('inside a callee → next numbered in callee’s scope', async () => {
      // stepIn from a call site executes the wrapper’s iter (which IS the
      // bare’s first instruction) and lands BEFORE the callee’s second
      // numbered instruction; from there, stepInstruction advances by one
      // numbered index in the callee’s scope.
      const machine = new PostMachine({
        10: call('foo'),
        20: stop,
        foo: { 1: mark, 2: mark, 3: stop },
      });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      let phase = 0;
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (phase === 0) { phase = 1; session.stepIn(); }            // descend into foo (lands at foo::2)
        else if (phase === 1) { phase = 2; session.stepInstruction(); } // foo::2 → foo::3
        else session.continue();
      });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('foo::2');
      expect(paths[2]).toBe('foo::3');
    });

    test('inside a callee at last numbered → returns to caller’s continuation', async () => {
      const machine = new PostMachine({
        10: call('foo'),
        20: mark,
        30: stop,
        foo: { 1: mark, 2: stop },
      });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      let phase = 0;
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (phase === 0) { phase = 1; session.stepIn(); }            // descend into foo (lands at foo::2 = stop)
        else if (phase === 1) { phase = 2; session.stepInstruction(); } // pops foo back to caller's 20
        else session.continue();
      });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('foo::2');
      expect(paths[2]).toBe('20');
    });

    test('stepInstruction when next numbered is a terminal stop → halts', async () => {
      // Engine doesn't pause before `stop` (it transitions to haltState
      // directly, no before-iter pause point), so stepInstruction's
      // "advance to next numbered" naturally falls through to halt when
      // the next numbered is a stop at top level.
      const machine = new PostMachine({ 10: mark, 20: stop });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      let halted = false;
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        session.stepInstruction();
      });
      session.on('halt', () => { halted = true; });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths.length).toBe(1);
      expect(halted).toBe(true);
    });

    test('throws if called before any pause has fired', () => {
      const machine = new PostMachine({ 10: mark, 20: stop });
      const session = machine.debugRun();
      expect(() => session.stepInstruction()).toThrow(/no paused state/);
    });

    test('mid-group → next numbered (group sub-steps stay silent)', async () => {
      // stepInstruction from a group sub-step exercises the "same scope,
      // same instructionIndex" branch of #stillInClickTimeInstruction —
      // 10.2 → 10.3 has the same top-level index 10, so it stays silent;
      // the surface fires only when we land on 20. `20: right` (not stop)
      // because the engine doesn't pause before terminal stops.
      const machine = new PostMachine({ 10: [mark, right, mark], 20: right, 30: stop });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      let phase = 0;
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (phase === 0) { phase = 1; session.stepIn(); }            // descend into group, lands at 10.2
        else if (phase === 1) { phase = 2; session.stepInstruction(); } // walk through 10.3 silently → 20
        else session.continue();
      });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('10.2');
      expect(paths[2]).toBe('20');
    });

    test('nested call from non-main scope → silent descent stays inside the outer click scope', async () => {
      // stepInstruction from a non-main scope (foo) over a call('bar')
      // exercises the "descended into sub-scope" branch with a non-empty
      // click scope — every-callback fires, deeper-scope detection holds.
      const machine = new PostMachine({
        10: call('foo'),
        20: stop,
        foo: { 1: mark, 2: call('bar'), 3: stop },
        bar: { 1: mark, 2: stop },
      });
      machine.setBreakpoint('10', { before: true });
      const paths: string[] = [];
      let phase = 0;
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (phase === 0) { phase = 1; session.stepIn(); }            // main → lands at foo::2 (the call to bar)
        else if (phase === 1) { phase = 2; session.stepInstruction(); } // walk through bar silently → foo::3
        else session.continue();
      });
      await session.start();
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('foo::2');
      expect(paths[2]).toBe('foo::3');
    });

    test('a registered breakpoint mid-advance interrupts stepInstruction and surfaces normally', async () => {
      const machine = new PostMachine({
        10: call('foo'),
        20: mark,
        30: stop,
        foo: { 1: mark, 2: mark, 3: stop },
      });
      machine.setBreakpoint('10', { before: true });
      machine.setBreakpoint('foo::2', { before: true });
      const paths: string[] = [];
      const session = machine.debugRun();
      session.on('pause', (m) => {
        paths.push(formatArrival(m.arrivalPath));
        if (paths.length === 1) session.stepInstruction();
        else session.continue();
      });
      await session.start();
      // First pause at the initial breakpoint on 10; stepInstruction tries
      // to advance past 10's call('foo'), but the foo::2 breakpoint fires
      // mid-advance and surfaces.
      expect(paths[0]).toBe('10');
      expect(paths[1]).toBe('foo::2');
    });
  });

  test('external pause() fires a manual-cause pause; setRunInterval throttles the run', async () => {
    const machine = new PostMachine({ 10: mark, 20: mark, 30: mark, 40: stop });
    const session = machine.debugRun();
    session.setRunInterval(2);  // slow enough to request a pause mid-run

    let requested = false;
    const causes: string[] = [];
    session.on('iter', (m) => {
      if (m.step === 1 && !requested) { requested = true; session.pause(); }
    });
    session.on('pause', (m) => {
      causes.push(m.pause.cause);
      session.continue();
    });
    await session.start();

    expect(causes).toEqual(['manual']);
  });

  test('stop() from an iter listener terminates without firing halt', async () => {
    const machine = new PostMachine({ 10: mark, 20: mark, 30: mark, 40: stop });
    const session = machine.debugRun();

    let haltFired = false;
    let stopped = false;
    session.on('halt', () => { haltFired = true; });
    session.on('iter', () => { if (!stopped) { stopped = true; session.stop(); } });
    await session.start();

    expect(haltFired).toBe(false);
  });

  test('off() removes a previously registered listener (and is a no-op for an unregistered one)', async () => {
    const machine = new PostMachine({ 10: mark, 20: stop });
    const session = machine.debugRun();

    let called = false;
    const handler = () => { called = true; };
    session.on('halt', handler);
    session.off('halt', handler);
    // Removing a listener that was never registered is a no-op, not an error.
    session.off('halt', () => { /* never registered */ });
    await session.start();

    expect(called).toBe(false);
  });

  test('a halt breakpoint surfaces a breakpoint-cause pause', async () => {
    const machine = new PostMachine({ 10: mark, 20: stop });
    machine.setBreakpoint(haltState, { before: true });

    const causes: string[] = [];
    const session = machine.debugRun();
    session.on('pause', (m) => { causes.push(m.pause.cause); session.continue(); });
    await session.start();

    expect(causes).toContain('breakpoint');
  });

  test('step and halt listeners fire during an uninterrupted run', async () => {
    const machine = new PostMachine({ 10: mark, 20: stop });
    const session = machine.debugRun();

    let steps = 0;
    let halted = false;
    session.on('step', () => { steps += 1; });
    session.on('halt', () => { halted = true; });
    await session.start();

    expect(steps).toBeGreaterThan(0);
    expect(halted).toBe(true);
  });
});
