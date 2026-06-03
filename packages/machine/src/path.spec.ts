import { describe, expect, test } from 'vitest';
import { parsePath, formatPath, comparePathsCanonically } from './path';

describe('parsePath — happy paths', () => {
  test('top-level instruction', () => {
    expect(parsePath('10')).toEqual({ instructionIndex: 10 });
  });

  test('top-level group inner', () => {
    expect(parsePath('10.2')).toEqual({ instructionIndex: 10, groupInstructionIndex: 2 });
  });

  test('subroutine body instruction', () => {
    expect(parsePath('foo::1')).toEqual({ scope: ['foo'], instructionIndex: 1 });
  });

  test('nested subroutine', () => {
    expect(parsePath('outer::inner::1')).toEqual({ scope: ['outer', 'inner'], instructionIndex: 1 });
  });

  test('group inner inside subroutine', () => {
    expect(parsePath('foo::10.2')).toEqual({
      scope: ['foo'],
      instructionIndex: 10,
      groupInstructionIndex: 2,
    });
  });

  test('group inner inside nested subroutine', () => {
    expect(parsePath('outer::inner::10.2')).toEqual({
      scope: ['outer', 'inner'],
      instructionIndex: 10,
      groupInstructionIndex: 2,
    });
  });
});

describe('parsePath — rejections', () => {
  test('wrapper composite (contains parens)', () => {
    expect(() => parsePath('foo(10~30)')).toThrow(/wrapper composite|not an instruction path/i);
  });

  test('group wrapper composite', () => {
    expect(() => parsePath('50.1(50~60)')).toThrow(/wrapper composite|not an instruction path/i);
  });

  test('continuation state (contains ~)', () => {
    expect(() => parsePath('10~30')).toThrow(/continuation|not an instruction path/i);
  });

  test('continuation to halt', () => {
    expect(() => parsePath('foo::10~halt')).toThrow(/continuation|not an instruction path/i);
  });

  test('halt literal', () => {
    expect(() => parsePath('halt')).toThrow(/halt|not an instruction path/i);
  });

  test('leading :: prefix', () => {
    expect(() => parsePath('::10')).toThrow(/leading|invalid scope|empty/i);
  });

  test('empty scope segment', () => {
    expect(() => parsePath('foo::::1')).toThrow(/empty scope segment|invalid scope/i);
  });

  test('non-identifier scope segment', () => {
    expect(() => parsePath('foo.bar::1')).toThrow(/invalid scope|identifier/i);
  });

  test('group inner index of zero', () => {
    expect(() => parsePath('10.0')).toThrow(/group.*index|positive integer/i);
  });

  test('multiple "." in final segment', () => {
    expect(() => parsePath('10.1.2')).toThrow(/multiple '\.'|invalid path/i);
  });

  test('non-numeric instruction index', () => {
    expect(() => parsePath('foo::abc')).toThrow(/instruction index|integer/i);
  });

  test('empty string', () => {
    expect(() => parsePath('')).toThrow(/empty|invalid path/i);
  });
});

describe('formatPath', () => {
  test('top-level', () => {
    expect(formatPath({ instructionIndex: 10 })).toBe('10');
  });

  test('top-level group inner', () => {
    expect(formatPath({ instructionIndex: 10, groupInstructionIndex: 2 })).toBe('10.2');
  });

  test('with scope as array', () => {
    expect(formatPath({ scope: ['foo'], instructionIndex: 1 })).toBe('foo::1');
  });

  test('with scope as dotted string', () => {
    expect(formatPath({ scope: 'foo', instructionIndex: 1 })).toBe('foo::1');
  });

  test('nested scope as array', () => {
    expect(formatPath({ scope: ['outer', 'inner'], instructionIndex: 1 })).toBe('outer::inner::1');
  });

  test('nested scope as dotted string', () => {
    expect(formatPath({ scope: 'outer::inner', instructionIndex: 1 })).toBe('outer::inner::1');
  });

  test('with scope and group inner', () => {
    expect(formatPath({ scope: ['foo'], instructionIndex: 10, groupInstructionIndex: 2 })).toBe('foo::10.2');
  });

  test('empty scope normalizes to top-level', () => {
    expect(formatPath({ scope: [], instructionIndex: 10 })).toBe('10');
    expect(formatPath({ scope: '', instructionIndex: 10 })).toBe('10');
    expect(formatPath({ scope: undefined, instructionIndex: 10 })).toBe('10');
  });
});

describe('roundtrip parsePath ↔ formatPath', () => {
  const cases = ['10', '10.2', 'foo::1', 'foo::10.2', 'outer::inner::1', 'outer::inner::10.2'];
  for (const s of cases) {
    test(`'${s}' roundtrips`, () => {
      expect(formatPath(parsePath(s))).toBe(s);
    });
  }
});

describe('comparePathsCanonically', () => {
  test('sorts by groupInstructionIndex when scope and instructionIndex match', () => {
    const a = { instructionIndex: 50, groupInstructionIndex: 2 };
    const b = { instructionIndex: 50, groupInstructionIndex: 1 };
    expect(comparePathsCanonically(a, b)).toBeGreaterThan(0);
    expect(comparePathsCanonically(b, a)).toBeLessThan(0);
    expect(comparePathsCanonically(a, a)).toBe(0);
  });

  test('sorts undefined groupInstructionIndex before any number', () => {
    const a = { instructionIndex: 10 };
    const b = { instructionIndex: 10, groupInstructionIndex: 1 };
    expect(comparePathsCanonically(a, b)).toBeLessThan(0);
    expect(comparePathsCanonically(b, a)).toBeGreaterThan(0);
  });
});
