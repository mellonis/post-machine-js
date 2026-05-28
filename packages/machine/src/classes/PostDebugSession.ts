import {
  DebugSession as EngineDebugSession,
  type MachineState as EngineMachineState,
  type PauseInfo,
  type PausedMachineState as EnginePausedMachineState,
  State,
  haltState,
} from '@turing-machine-js/machine';
import { formatPath, type Path } from '../path';
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

  setRunInterval(ms: number): void {
    this.#engineSession.setRunInterval(ms);
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
