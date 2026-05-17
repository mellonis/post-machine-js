import { describe, expect, test } from 'vitest';
import { PostMachine, mark, right, stop, call, parsePath } from '../src/index';
import type { MachineState } from '../src/index';

describe('PostMachine — wrapped MachineState', () => {
  test('onStep receives arrivalPath and candidatePaths', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.arrivalPath).toBeDefined();
      expect(Array.isArray(s.candidatePaths)).toBe(true);
    }
  });

  test('first-step arrivalPath is the entry instruction', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen[0].arrivalPath).toEqual(parsePath('10'));
  });

  test('un-shared state has single candidatePath', async () => {
    const m = new PostMachine({
      10: mark,
      20: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen[0].candidatePaths).toEqual([parsePath('10')]);
  });

  test('shared state has multiple candidatePaths', async () => {
    // Both 10 and 20 produce identical mark-then-30 transitions.
    // The hash cache dedupes them; their candidatePaths reflect the sharing.
    const m = new PostMachine({
      10: mark(30),
      20: mark(30),
      30: stop,
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    expect(seen[0].candidatePaths.length).toBe(2);
    expect(seen[0].candidatePaths.map(p => p.instructionIndex)).toEqual([10, 20]);
  });

  test('subroutine body instruction has fully-qualified arrivalPath', async () => {
    const m = new PostMachine({
      10: call('foo'),
      foo: { 1: mark },
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    // After the call wrapper, control reaches foo::1.
    const fooStep = seen.find(s => {
      const scope = s.arrivalPath.scope;
      return Array.isArray(scope) && scope.join('::') === 'foo' && s.arrivalPath.instructionIndex === 1;
    });
    expect(fooStep).toBeDefined();
  });

  test('group inner has arrivalPath with groupInstructionIndex', async () => {
    const m = new PostMachine({
      50: [right, mark],
    });
    const seen: MachineState[] = [];
    await m.run({ onStep: (s) => { seen.push(s); } });
    // The second inner (mark) fires at 50.2 — the first inner (right) is wrapped
    // by withOverrodeHaltState and therefore resolves to the outer group path {50}
    // rather than {50.1}. The second inner state is unambiguously tagged 50.2.
    const groupInner = seen.find(s =>
      s.arrivalPath.instructionIndex === 50 && s.arrivalPath.groupInstructionIndex === 2
    );
    expect(groupInner).toBeDefined();
  });
});
