import { describe, expect, test } from 'vitest';
import {
  PostMachine,
  State,
  check, mark, right, stop,
} from '../src/index';

describe('pm.stateAt — happy paths', () => {
  test('top-level instruction by string', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    const s = pm.stateAt('10');
    expect(s).toBeInstanceOf(State);
    expect(s.name).toBe('10');
  });

  test('top-level instruction by object', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    const s = pm.stateAt({ instructionIndex: 10 });
    expect(s.name).toBe('10');
  });

  test('subroutine instruction by string', () => {
    const pm = new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: stop,
      sub: { 1: mark, 2: stop },
    });
    const s = pm.stateAt('sub::1');
    expect(s.name).toBe('sub::1');
  });

  test('subroutine instruction by object with scope string', () => {
    const pm = new PostMachine({
      10: stop,
      sub: { 1: mark, 2: stop },
    });
    const s = pm.stateAt({ scope: 'sub', instructionIndex: 1 });
    expect(s.name).toBe('sub::1');
  });

  test('subroutine instruction by object with scope array', () => {
    const pm = new PostMachine({
      10: stop,
      sub: { 1: mark, 2: stop },
    });
    const s = pm.stateAt({ scope: ['sub'], instructionIndex: 1 });
    expect(s.name).toBe('sub::1');
  });
});

describe('pm.stateAt — wrapped Proxy semantics', () => {
  test('returned object satisfies instanceof State', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.stateAt('10')).toBeInstanceOf(State);
  });

  test('debug write on an un-shared State redirects to setBreakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.stateAt('10').debug = { before: true };
    expect(pm.listBreakpoints()).toEqual([
      { kind: 'instruction', path: { instructionIndex: 10 }, filter: { before: true } },
    ]);
  });

  test('debug write of null clears the registered breakpoint', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.setBreakpoint('10', { before: true });
    pm.stateAt('10').debug = null;
    expect(pm.listBreakpoints()).toEqual([]);
  });

  test('debug write on a shared State throws with the candidate list', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    expect(() => {
      pm.stateAt('10').debug = { before: true };
    }).toThrow(/ambiguous.*'10'.*'30'/);
  });

  test('repeated stateAt returns the same bare State', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.stateAt('10')).toBe(pm.stateAt('10'));
  });

  test('shared-state paths return the same bare State', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    expect(pm.stateAt('10')).toBe(pm.stateAt('30'));
  });
});

describe('pm.stateAt — rejections', () => {
  test('unresolved top-level instruction throws', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('999')).toThrow(/unknown instruction|does not resolve/i);
  });

  test('unknown subroutine throws', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('foo::1')).toThrow(/unknown subroutine|does not resolve/i);
  });

  test("'halt' is rejected (not an instruction path)", () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('halt')).toThrow(/halt|not an instruction path/i);
  });

  test('wrapper composite (contains >) is rejected', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('foo>10~20')).toThrow();
  });

  test('continuation state (contains ~) is rejected', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt('10~30')).toThrow();
  });

  test('zero instruction index is rejected by parsePath', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt({ instructionIndex: 0 })).toThrow(/positive integer/i);
  });

  test('zero groupInstructionIndex on object form is rejected', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt({ instructionIndex: 10, groupInstructionIndex: 0 }))
      .toThrow(/groupInstructionIndex must be a positive integer/i);
  });

  test('invalid scope segment on object form is rejected', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.stateAt({ scope: '1invalid', instructionIndex: 1 }))
      .toThrow(/not a valid subroutine name/i);
  });
});

describe('pm.hasState', () => {
  test('returns true for a resolved path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('10')).toBe(true);
  });

  test('returns false for an unresolved well-formed path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('999')).toBe(false);
  });

  test('returns false for a malformed string', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('halt')).toBe(false);
  });

  test('returns false for an unknown subroutine path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.hasState('foo::1')).toBe(false);
  });
});

describe('pm.candidatesFor', () => {
  test('un-shared state returns a single-element list', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.candidatesFor('10')).toEqual([{ instructionIndex: 10 }]);
  });

  test('shared state returns all candidates in canonical order', () => {
    const pm = new PostMachine({ 10: mark(40), 20: stop, 30: mark(40), 40: stop });
    expect(pm.candidatesFor('10')).toEqual([
      { instructionIndex: 10 },
      { instructionIndex: 30 },
    ]);
    expect(pm.candidatesFor('30')).toEqual(pm.candidatesFor('10'));
  });

  test('throws on unresolved path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.candidatesFor('999')).toThrow();
  });
});

