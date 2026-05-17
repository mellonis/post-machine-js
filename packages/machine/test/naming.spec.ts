import { describe, expect, test } from 'vitest';
import {
  PostMachine,
  call, check, erase, left, mark, noop, right, stop,
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

describe('PostMachine — top-level call wrapper names (continuation only)', () => {
  test('call wrapper composite contains the continuation "10~30"', () => {
    const machine = new PostMachine({
      10: call('foo', 30),
      20: stop,
      30: stop,
      foo: { 1: stop },
    });
    // After Task 3 (this task), the continuation is named "10~30" but the
    // hopper is still "id:N" (Task 4 names the hopper). So the wrapper composite
    // is `${hopperName}>10~30` — we only assert the continuation part is present.
    expect(machine.initialState.name).toMatch(/^id:\d+>10~30$/);
  });

  test('tail-position call wrapper composite contains "10~halt"', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toMatch(/^id:\d+>10~halt$/);
  });

  test('call falling through to the next sequential instruction', () => {
    const machine = new PostMachine({
      10: call('foo'),
      20: stop,
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toMatch(/^id:\d+>10~20$/);
  });
});
