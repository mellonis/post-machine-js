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

  test('debug write throws with instructional error', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => {
      pm.stateAt('10').debug = { before: true };
    }).toThrow(/setBreakpoint/);
  });

  test('cache returns same Proxy across calls', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.stateAt('10')).toBe(pm.stateAt('10'));
  });

  test('shared-state paths return same Proxy', () => {
    // 10 and 30 share a State via hash dedup (both are `mark` with the same next).
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
});
