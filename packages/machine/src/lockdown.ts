import type { State } from '@turing-machine-js/machine';

const LOCKDOWN_ERROR =
  'Use pm.setBreakpoint(target, filter) to enable breakpoints. '
  + 'Direct state.debug assignment is disabled on objects returned by PostMachine.';

function wrapDebugConfig<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop) {
      return Reflect.get(t, prop, t);
    },
    set() {
      throw new Error(LOCKDOWN_ERROR);
    },
  });
}

export function wrapStateForLockdown(
  state: State,
  cache: Map<State, State>,
): State {
  const cached = cache.get(state);
  if (cached) return cached;

  const debugCache = new WeakMap<object, object>();

  const wrapped = new Proxy(state, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === 'debug' && value && typeof value === 'object') {
        const existing = debugCache.get(value);
        if (existing) return existing;
        const dbgProxy = wrapDebugConfig(value);
        debugCache.set(value, dbgProxy);
        return dbgProxy;
      }
      return value;
    },
    set(target, prop, value) {
      if (prop === 'debug') {
        throw new Error(LOCKDOWN_ERROR);
      }
      return Reflect.set(target, prop, value, target);
    },
  });

  cache.set(state, wrapped);
  return wrapped;
}
