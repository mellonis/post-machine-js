import { describe, expect, test } from 'vitest';
import { State, ifOtherSymbol, haltState } from '@turing-machine-js/machine';
import {
  installStateLockdown,
  withLockdownEscape,
} from './lockdown';

describe('installStateLockdown', () => {
  function makeState(): State {
    return new State({ [ifOtherSymbol]: { nextState: haltState } }, 'test-state');
  }

  test('blocks direct writes outside the escape, invoking the redirect handler', () => {
    const s = makeState();
    let received: unknown = undefined;
    installStateLockdown(s, (v) => { received = v; });
    s.debug = { before: true };
    expect(received).toEqual({ before: true });
  });

  test('redirect handler receives null on clear', () => {
    const s = makeState();
    let received: unknown = 'unset';
    installStateLockdown(s, (v) => { received = v; });
    s.debug = null;
    expect(received).toBeNull();
  });

  test('redirect handler can throw to reject ambiguous shared-state writes', () => {
    const s = makeState();
    installStateLockdown(s, () => {
      throw new Error('ambiguous');
    });
    expect(() => {
      s.debug = { before: true };
    }).toThrow(/ambiguous/);
  });

  test('writes inside withLockdownEscape delegate to the engine setter', () => {
    const s = makeState();
    installStateLockdown(s, () => {
      throw new Error('should not be called');
    });
    withLockdownEscape(() => {
      s.debug = { before: true };
    });
    expect(s.debug?.before).toBe(true);
  });

  test('reads always pass through to the engine', () => {
    const s = makeState();
    installStateLockdown(s, () => undefined);
    withLockdownEscape(() => {
      s.debug = { before: true };
    });
    expect(s.debug?.before).toBe(true);
  });

  test('non-debug fields are unaffected', () => {
    const s = makeState();
    installStateLockdown(s, () => undefined);
    expect(s.name).toBe('test-state');
    expect(typeof s.id).toBe('number');
    expect(s).toBeInstanceOf(State);
  });

  test('escape nests correctly', () => {
    const s = makeState();
    installStateLockdown(s, () => {
      throw new Error('should not be called');
    });
    withLockdownEscape(() => {
      withLockdownEscape(() => {
        s.debug = { before: true };
      });
      // After the inner escape ends, the outer is still active.
      s.debug = null;
    });
    // Engine v6.1+ (#150) returns an empty `DebugConfig` after `state.debug = null`
    // (filters cleared) rather than literal `null`. Check the public getters
    // directly — `undefined` is the "no filter set" sentinel.
    expect(s.debug.before).toBeUndefined();
    expect(s.debug.after).toBeUndefined();
  });
});

describe('haltState writes — no lockdown', () => {
  test('boolean writes pass through to the engine setter', () => {
    haltState.debug = true;
    expect(haltState.debug).toBe(true);
    haltState.debug = false;
    expect(haltState.debug).toBe(false);
    haltState.debug = null;
    expect(haltState.debug).toBe(false);
  });

  test('object writes throw the engine-level error, not a lockdown error', () => {
    expect(() => {
      // @ts-expect-error — HaltState typed alias only accepts boolean | null
      haltState.debug = { before: true };
    }).toThrow(/haltState\.debug only accepts boolean/);
  });
});
