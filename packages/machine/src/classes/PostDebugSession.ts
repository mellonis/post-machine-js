import {
  DebugSession as EngineDebugSession,
  type MachineState as EngineMachineState,
  type PauseInfo,
  type PausedMachineState as EnginePausedMachineState,
  State,
  haltState,
} from '@turing-machine-js/machine';
import { formatPath, normalizeScope, type Path } from '../path';
import type { MachineState } from '../index';
import type { Breakpoint } from '../breakpoints';
import type { PostMachine } from './PostMachine';

export type PostDebugSessionEvent = 'pause' | 'step' | 'iter' | 'halt';

/** A post-wrapped `MachineState` (arrivalPath / candidatePaths) plus the
 *  engine's one-sided pause descriptor — the payload of a `pause` event. */
export type PostPausedMachineState = MachineState & { pause: PauseInfo };

export type PostDebugSessionListener<E extends PostDebugSessionEvent> =
  E extends 'halt'
    ? () => void | Promise<void>
    : E extends 'pause'
      ? (machineState: PostPausedMachineState) => void | Promise<void>
      : (machineState: MachineState) => void | Promise<void>;

type ListenerMap = {
  pause: Array<(m: PostPausedMachineState) => void | Promise<void>>;
  step: Array<(m: MachineState) => void | Promise<void>>;
  iter: Array<(m: MachineState) => void | Promise<void>>;
  halt: Array<() => void | Promise<void>>;
};

export type PostDebugSessionParameter = {
  stepsLimit?: number;
};

/**
 * Interactive debugger session for `PostMachine`. Wraps the upstream engine
 * `DebugSession`, adds post-specific MachineState wrapping (`arrivalPath`,
 * `candidatePaths`), and applies the PostMachine's breakpoint registry as a
 * filter before forwarding pause events.
 *
 * Construct via `pm.debugRun()` rather than instantiating directly — the
 * factory wires up the prev-state tracking and registry reference.
 */
export class PostDebugSession {
  readonly #postMachine: PostMachine;
  readonly #engineSession: EngineDebugSession;
  readonly #listeners: ListenerMap = {
    pause: [],
    step: [],
    iter: [],
    halt: [],
  };
  #prevState: State | null = null;
  #prevJsSymbol: symbol | null = null;
  /** Latest pause's `arrivalPath`. Read by `stepInstruction()` to anchor the
   *  click-time `(scope, instructionIndex)` it must advance past. */
  #lastPausedPath: Path | null = null;
  /** When set, the session is mid-`stepInstruction()` — the engine is being
   *  driven via repeated `stepIn` until the path's `(scope, instructionIndex)`
   *  differs from this anchor (sub-step transitions and descents into a
   *  sub-scope are silently passed through). Cleared on landing, halt, or
   *  any non-step interrupt. */
  #pendingStepInstruction: { scope: string[]; instructionIndex: number } | null = null;
  readonly #entryPath: Path;
  readonly #wrap: (raw: EngineMachineState, prev: State | null, prevSym: symbol | null) => MachineState;
  readonly #getBreakpoints: () => readonly Breakpoint[];
  readonly #tapeBlockSymbol: (pattern: [string]) => symbol;

  constructor(args: {
    postMachine: PostMachine;
    engineSession: EngineDebugSession;
    entryPath: Path;
    wrap: (raw: EngineMachineState, prev: State | null, prevSym: symbol | null) => MachineState;
    getBreakpoints: () => readonly Breakpoint[];
    tapeBlockSymbol: (pattern: [string]) => symbol;
  }) {
    this.#postMachine = args.postMachine;
    this.#engineSession = args.engineSession;
    this.#entryPath = args.entryPath;
    this.#wrap = args.wrap;
    this.#getBreakpoints = args.getBreakpoints;
    this.#tapeBlockSymbol = args.tapeBlockSymbol;

    // Wire engine events to wrap + dispatch via our own listener registry.
    this.#engineSession.on('step', (raw) => {
      const wrapped = this.#wrap(raw, this.#prevState, this.#prevJsSymbol);
      for (const fn of this.#listeners.step) void fn(wrapped);
    });
    this.#engineSession.on('pause', (raw) => {
      // raw is the engine's PausedMachineState — carry its `pause` descriptor
      // onto the post-wrapped state so post pause listeners see {side, cause}.
      const wrapped: PostPausedMachineState = {
        ...this.#wrap(raw, this.#prevState, this.#prevJsSymbol),
        pause: raw.pause,
      };
      this.#lastPausedPath = wrapped.arrivalPath;

      // stepInstruction internal filter — only on step-cause pauses (the
      // kind our own stepInstruction() drives via repeated engine.stepIn).
      // Other causes (breakpoint, manual) interrupt stepInstruction and
      // surface through the normal path below.
      if (this.#pendingStepInstruction !== null && raw.pause.cause === 'step') {
        if (this.#stillInClickTimeInstruction(wrapped.arrivalPath, this.#pendingStepInstruction)) {
          // Either a sub-step transition (same scope+index, group sub-step)
          // or a descent into a sub-scope (call/group body) — keep stepping.
          this.#engineSession.stepIn();
          return;
        }
        // Landed on a different (scope, instructionIndex) pair → surface.
        this.#pendingStepInstruction = null;
      } else if (this.#pendingStepInstruction !== null) {
        // Non-step pause during stepInstruction — surfaces normally; the
        // user sees the breakpoint / manual pause and the stepInstruction
        // intent is consumed.
        this.#pendingStepInstruction = null;
      }

      // Apply post-machine breakpoint registry filter — fire only when the
      // engine pause was triggered by a registered breakpoint (or by a
      // step-mode endpoint / manual pause).
      if (!this.#shouldFire(raw, wrapped)) {
        this.#engineSession.continue();
        return;
      }
      for (const fn of this.#listeners.pause) void fn(wrapped);
    });
    this.#engineSession.on('iter', (raw) => {
      const wrapped = this.#wrap(raw, this.#prevState, this.#prevJsSymbol);
      for (const fn of this.#listeners.iter) void fn(wrapped);
      // Advance prev for the NEXT iter's wrapping.
      this.#prevState = raw.state;
      this.#prevJsSymbol = this.#tapeBlockSymbol([raw.currentSymbols[0]]);
    });
    this.#engineSession.on('halt', () => {
      this.#pendingStepInstruction = null;
      this.#lastPausedPath = null;
      for (const fn of this.#listeners.halt) void fn();
    });

    // Touch unused fields to satisfy the noUnusedLocals heuristic — they exist
    // for future wrappers that need to read them.
    void this.#postMachine;
    void this.#entryPath;
  }

  on<E extends PostDebugSessionEvent>(event: E, listener: PostDebugSessionListener<E>): this {
    (this.#listeners[event] as Array<PostDebugSessionListener<E>>).push(listener);
    return this;
  }

  off<E extends PostDebugSessionEvent>(event: E, listener: PostDebugSessionListener<E>): this {
    const arr = this.#listeners[event] as Array<PostDebugSessionListener<E>>;
    const ix = arr.indexOf(listener);
    if (ix >= 0) arr.splice(ix, 1);
    return this;
  }

  start(): Promise<void> {
    return this.#engineSession.start();
  }

  stop(): void {
    this.#engineSession.stop();
  }

  pause(): void {
    this.#engineSession.pause();
  }

  continue(): void {
    this.#engineSession.continue();
  }

  stepIn(): void {
    this.#engineSession.stepIn();
  }

  stepOver(): void {
    this.#engineSession.stepOver();
  }

  stepOut(): void {
    this.#engineSession.stepOut();
  }

  /**
   * Advance to the next **numbered Post instruction** in the current scope.
   *
   * `stepInstruction()` is the Post-level program-counter step — it skips
   * sub-step transitions inside groups (`50.1` → `50.2`) and descents into
   * called scopes (`call('foo')` → `foo::1`) because those aren't numbered
   * instructions in the *current* scope's program. Two rules cover the
   * whole semantics:
   *
   * 1. Advance until the click-time `(scope, instructionIndex)` pair
   *    changes. Sub-step transitions and sub-scope descents stay silent.
   * 2. If there's no next numbered instruction in the current scope
   *    (you hit `stop` or fall through the end), the natural engine
   *    continuation fires — return to caller's continuation if inside
   *    a call/group, halt if at top level.
   *
   * Position-independent: same behavior whether you're at an atomic
   * instruction, a `call(...)` entry, a group entry, mid-group, or any
   * instruction inside a called scope. The "open question" about whether
   * to descend into a callee's body is resolved by rule 1 — different
   * scope = different "instruction" only when the scope is the current
   * one's, otherwise the descent is silent and we run until we exit the
   * call (which lands us on the caller's next numbered instruction).
   *
   * If a registered breakpoint or external `pause()` fires mid-advance,
   * it surfaces normally and consumes the stepInstruction intent.
   *
   * Implementation: drives the engine via repeated `stepIn` internally;
   * filters the resulting step-cause pauses via [[`Path`]] comparison
   * against the click-time anchor. Resolves
   * [post-machine-js#101](https://github.com/mellonis/post-machine-js/issues/101).
   */
  stepInstruction(): void {
    if (this.#lastPausedPath === null) {
      throw new Error('stepInstruction: no paused state to advance from');
    }
    this.#pendingStepInstruction = {
      scope: normalizeScope(this.#lastPausedPath.scope),
      instructionIndex: this.#lastPausedPath.instructionIndex,
    };
    this.#engineSession.stepIn();
  }

  setRunInterval(ms: number): void {
    this.#engineSession.setRunInterval(ms);
  }

  /** stepInstruction filter — is `current` still inside the click-time
   *  instruction (so we keep silent-stepping)? Two cases are silent:
   *  exact match on `(scope, instructionIndex)` (sub-step inside the same
   *  numbered instruction — e.g. group sub-step `50.2` after a click at
   *  `50.1`), and any descent into a sub-scope (call/group body — `foo::1`
   *  after a click at `50: call('foo')`). Sibling and shallower scopes,
   *  or same-scope different-index, mean we landed on a new instruction
   *  and the silent stepping ends. */
  #stillInClickTimeInstruction(
    current: Path,
    click: { scope: string[]; instructionIndex: number },
  ): boolean {
    const cur = normalizeScope(current.scope);
    // Descended into a sub-scope (current scope strictly extends click scope).
    if (cur.length > click.scope.length
        && click.scope.every((s, i) => cur[i] === s)) {
      return true;
    }
    // Same scope, same numbered index — sub-step within the same instruction.
    if (cur.length === click.scope.length
        && cur.every((s, i) => s === click.scope[i])
        && current.instructionIndex === click.instructionIndex) {
      return true;
    }
    return false;
  }

  // Decide whether a raw engine pause should surface to post-machine pause
  // listeners. Step-mode endpoints and manual pauses always pass through;
  // breakpoint-cause pauses are filtered against the registry so only
  // path-registered or halt-registered states fire.
  #shouldFire(raw: EnginePausedMachineState, wrapped: MachineState): boolean {
    const cause = raw.pause.cause;
    if (cause === 'step' || cause === 'manual') {
      return true;
    }
    // cause: 'breakpoint' — apply registry filter.
    const breakpoints = this.#getBreakpoints();
    const nextIsHalt = raw.nextState instanceof State && raw.nextState.isHalt;
    if (nextIsHalt && breakpoints.some((bp) => bp.kind === 'halt')) {
      return true;
    }
    const arrivalKey = formatPath(wrapped.arrivalPath);
    return breakpoints.some((bp) =>
      bp.kind === 'instruction' && formatPath(bp.path) === arrivalKey);
  }
}

// Re-exported to keep import surfaces tight at the package boundary.
export { haltState };
