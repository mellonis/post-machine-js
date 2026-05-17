import { describe, expect, test } from 'vitest';
import { State, ifOtherSymbol, haltState } from '@turing-machine-js/machine';
import { wrapStateForLockdown } from '../src/lockdown';

describe('wrapStateForLockdown', () => {
  function makeState(): State {
    return new State({ [ifOtherSymbol]: { nextState: haltState } }, 'test-state');
  }

  test('reads pass through to the underlying State', () => {
    const s = makeState();
    const cache = new Map<State, State>();
    const wrapped = wrapStateForLockdown(s, cache);
    expect(wrapped.name).toBe('test-state');
    expect(wrapped.id).toBe(s.id);
  });

  test('preserves instanceof State', () => {
    const s = makeState();
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(wrapped).toBeInstanceOf(State);
  });

  test('cache returns the same Proxy for the same underlying State', () => {
    const s = makeState();
    const cache = new Map<State, State>();
    const w1 = wrapStateForLockdown(s, cache);
    const w2 = wrapStateForLockdown(s, cache);
    expect(w1).toBe(w2);
  });

  test('setting .debug throws with instructional error', () => {
    const wrapped = wrapStateForLockdown(makeState(), new Map());
    expect(() => {
      (wrapped as unknown as { debug: unknown }).debug = { before: true };
    }).toThrow(/setBreakpoint/);
  });

  test('setting .debug.before throws with instructional error', () => {
    const s = makeState();
    s.debug = { before: true };
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(() => {
      (wrapped.debug as unknown as { before: boolean }).before = false;
    }).toThrow(/setBreakpoint/);
  });

  test('setting .debug.after throws with instructional error', () => {
    const s = makeState();
    s.debug = { after: true };
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(() => {
      (wrapped.debug as unknown as { after: boolean }).after = false;
    }).toThrow(/setBreakpoint/);
  });

  test('reading .debug returns a Proxy that allows reads', () => {
    const s = makeState();
    s.debug = { before: true };
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(wrapped.debug?.before).toBe(true);
  });

  test('reading .debug twice returns the same DebugConfig Proxy', () => {
    const s = makeState();
    s.debug = { before: true };
    const wrapped = wrapStateForLockdown(s, new Map());
    expect(wrapped.debug).toBe(wrapped.debug);
  });

  test('reading .debug returns null when underlying debug is null', () => {
    // Covers the falsy branch of the get trap's `value && typeof value === 'object'` guard,
    // which the breakpoints suite exercises only indirectly.
    const wrapped = wrapStateForLockdown(makeState(), new Map());
    expect(wrapped.debug).toBeNull();
  });

  test('writes to non-debug fields forward to the underlying State', () => {
    const s = makeState();
    const wrapped = wrapStateForLockdown(s, new Map());
    (wrapped as unknown as Record<string, unknown>)['custom'] = 42;
    expect((s as unknown as Record<string, unknown>)['custom']).toBe(42);
  });
});
