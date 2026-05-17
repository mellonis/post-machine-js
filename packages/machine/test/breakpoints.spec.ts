import { describe, expect, test } from 'vitest';
import { haltState as engineHaltState } from '@turing-machine-js/machine';
import {
  PostMachine,
  haltState,
  mark, right, check, stop,
} from '../src/index';
import {
  mergeBreakpointFilters,
  validateBreakpointFilter,
  type BreakpointFilter,
} from '../src/breakpoints';

describe('mergeBreakpointFilters', () => {
  test('two `before: true` filters merge to `before: true`', () => {
    expect(mergeBreakpointFilters([{ before: true }, { before: true }])).toEqual({ before: true });
  });

  test('`before: "*"` ∪ `before: " "` = `before: ["*", " "]`', () => {
    const out = mergeBreakpointFilters([{ before: '*' }, { before: ' ' }]);
    expect(out.before).toEqual(expect.arrayContaining(['*', ' ']));
  });

  test('`before: true` dominates `before: "*"`', () => {
    expect(mergeBreakpointFilters([{ before: true }, { before: '*' }])).toEqual({ before: true });
  });

  test('mixed before+after merges component-wise', () => {
    const out = mergeBreakpointFilters([{ before: '*' }, { after: ' ' }]);
    expect(out.before).toBe('*');
    expect(out.after).toBe(' ');
  });

  test('array-form filter contributes its symbols to the union', () => {
    const out = mergeBreakpointFilters([{ before: ['*', ' '] }, { before: '#' }]);
    expect(out.before).toEqual(expect.arrayContaining(['*', ' ', '#']));
  });

  test('single-symbol after-set collapses to the bare string', () => {
    expect(mergeBreakpointFilters([{ before: '*' }])).toEqual({ before: '*' });
  });

  test('empty input returns empty object', () => {
    expect(mergeBreakpointFilters([])).toEqual({});
  });
});

describe('validateBreakpointFilter', () => {
  test('accepts before: true', () => {
    expect(() => validateBreakpointFilter({ before: true })).not.toThrow();
  });

  test('accepts after: "*"', () => {
    expect(() => validateBreakpointFilter({ after: '*' })).not.toThrow();
  });

  test('rejects {} with instructional error', () => {
    expect(() => validateBreakpointFilter({} as BreakpointFilter))
      .toThrow(/at least one.*before.*after/i);
  });
});

describe('pm.setBreakpoint / listBreakpoints', () => {
  test('registers an instruction breakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    expect(pm.listBreakpoints()).toEqual([
      { kind: 'instruction', path: { instructionIndex: 10 }, filter: { before: true } },
    ]);
  });

  test('registers a halt breakpoint via the wrapped haltState re-export', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint(haltState, { before: true });
    expect(pm.listBreakpoints()).toEqual([{ kind: 'halt', filter: { before: true } }]);
    // Cleanup so the engine-singleton state doesn't leak to other tests.
    pm.clearBreakpoints();
  });

  test('registers a halt breakpoint via the bare engine singleton too', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint(engineHaltState, { before: true });
    expect(pm.listBreakpoints()).toEqual([{ kind: 'halt', filter: { before: true } }]);
    pm.clearBreakpoints();
  });

  test('rejects empty filter', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.setBreakpoint('10', {})).toThrow(/at least one/i);
  });

  test('rejects a non-halt State target', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    const some = pm.stateAt('10');
    expect(() => pm.setBreakpoint(some, { before: true }))
      .toThrow(/only for the haltState singleton/i);
  });

  test('a path that resolves to a stop instruction is treated as a halt breakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('20', { before: true });
    expect(pm.listBreakpoints()).toEqual([{ kind: 'halt', filter: { before: true } }]);
    pm.clearBreakpoints();
  });

  test('setBreakpoint enables state.debug on the underlying State', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    expect(pm.stateAt('10').debug?.before).toBe(true);
  });

  test('two registrations on a shared State produce a union filter (before + after)', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    pm.setBreakpoint('10', { before: true });
    pm.setBreakpoint('30', { after: true });
    const dbg = pm.stateAt('10').debug;
    expect(dbg?.before).toBe(true);
    expect(dbg?.after).toBe(true);
  });

  test('canonical Path shape regardless of input form', () => {
    const pm = new PostMachine({ 10: stop, sub: { 1: mark, 2: stop } });
    pm.setBreakpoint({ scope: 'sub', instructionIndex: 1 }, { before: true });
    const [bp] = pm.listBreakpoints();
    expect(bp).toEqual({
      kind: 'instruction',
      path: { scope: ['sub'], instructionIndex: 1 },
      filter: { before: true },
    });
  });

  test('listBreakpoints returns copies, not internal references', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    const list1 = pm.listBreakpoints();
    expect(list1[0].kind).toBe('instruction');
    if (list1[0].kind === 'instruction') {
      (list1[0].filter as { before?: boolean }).before = false;
    }
    const list2 = pm.listBreakpoints();
    expect((list2[0] as { filter: BreakpointFilter }).filter.before).toBe(true);
  });
});

describe('pm.clearBreakpoint / clearBreakpoints', () => {
  test('clearBreakpoint removes one entry and resets state.debug to null', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.clearBreakpoint('10');
    expect(pm.listBreakpoints()).toEqual([]);
    expect(pm.stateAt('10').debug).toBeNull();
  });

  test('clearBreakpoint on a shared State shrinks the union filter', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    pm.setBreakpoint('10', { before: true });
    pm.setBreakpoint('30', { after: true });
    pm.clearBreakpoint('10');
    const dbg = pm.stateAt('30').debug;
    expect(dbg?.before).toBeUndefined();
    expect(dbg?.after).toBe(true);
  });

  test('clearBreakpoint(haltState) removes only halt entries', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.setBreakpoint(haltState, { before: true });
    pm.clearBreakpoint(haltState);
    expect(pm.listBreakpoints()).toEqual([
      { kind: 'instruction', path: { instructionIndex: 10 }, filter: { before: true } },
    ]);
    pm.clearBreakpoints();
  });

  test('clearBreakpoints removes everything (instruction + halt)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.setBreakpoint(haltState, { before: true });
    pm.clearBreakpoints();
    expect(pm.listBreakpoints()).toEqual([]);
    expect(pm.stateAt('10').debug).toBeNull();
  });
});

describe('lockdown redirect — direct state.debug writes', () => {
  test('un-shared State debug write redirects to setBreakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.initialState.debug = { before: true };
    expect(pm.listBreakpoints()).toEqual([
      { kind: 'instruction', path: { instructionIndex: 10 }, filter: { before: true } },
    ]);
  });

  test('un-shared State debug = null redirects to clearBreakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.initialState.debug = null;
    expect(pm.listBreakpoints()).toEqual([]);
  });

  test('shared State debug write throws with candidate paths', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    expect(() => {
      pm.stateAt('10').debug = { before: true };
    }).toThrow(/ambiguous.*'10'.*'30'/);
  });

  test('haltState debug write throws (no PostMachine context for redirect)', () => {
    expect(() => {
      haltState.debug = { before: true };
    }).toThrow(/setBreakpoint\(haltState/);
  });
});
