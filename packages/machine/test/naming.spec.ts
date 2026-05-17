import { describe, expect, test } from 'vitest';
import {
  PostMachine,
  check, erase, left, mark, noop, right, stop,
} from '../src/index';

describe('PostMachine — top-level atomic-command names', () => {
  test('initialState has instruction-derived name "10"', () => {
    const machine = new PostMachine({ 10: mark, 20: stop });
    expect(machine.initialState.name).toBe('10');
  });

  test('check state at instruction 10 named "10"', () => {
    const machine = new PostMachine({
      10: check(20, 30),
      20: mark,
      30: stop,
    });
    expect(machine.initialState.name).toBe('10');
  });

  test('right, erase, left, noop states all named by instruction index', () => {
    const machine = new PostMachine({
      10: right,
      20: erase,
      30: left,
      40: noop,
      50: mark,
      60: stop,
    });
    expect(machine.initialState.name).toBe('10');
  });
});
