import type { State } from '@turing-machine-js/machine';

const LOCKDOWN_ERROR =
  'Use pm.setBreakpoint(target, filter) to enable breakpoints. '
  + 'Direct state.debug assignment is disabled on objects returned by PostMachine.';

let escapeDepth = 0;

export function withLockdownEscape<T>(fn: () => T): T {
  escapeDepth += 1;
  try {
    return fn();
  } finally {
    escapeDepth -= 1;
  }
}

function captureProtoDebugAccessor(state: object): { get: () => unknown; set: (v: unknown) => void } {
  // State.prototype owns `get debug() / set debug()` — descriptor is on the
  // immediate prototype.
  const proto = Object.getPrototypeOf(state);
  const desc = Object.getOwnPropertyDescriptor(proto, 'debug')!;
  return { get: desc.get!.bind(state), set: desc.set!.bind(state) };
}

export type DebugRedirectHandler = (value: unknown) => void;

export function installStateLockdown(state: State, onUserWrite: DebugRedirectHandler): void {
  const proto = captureProtoDebugAccessor(state);
  Object.defineProperty(state, 'debug', {
    configurable: true,
    get() {
      return proto.get();
    },
    set(value: unknown) {
      if (escapeDepth > 0) {
        proto.set(value);
        return;
      }
      onUserWrite(value);
    },
  });
}

export { LOCKDOWN_ERROR };
