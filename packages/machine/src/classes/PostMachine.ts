import {
  Alphabet,
  type MachineState as EngineMachineState,
  Reference,
  State,
  Tape,
  TapeBlock,
  TuringMachine,
  ifOtherSymbol,
  haltState,
} from '@turing-machine-js/machine';
import {
  blankSymbol as defaultBlankSymbol,
  commandsSet,
  type CommandFn,
  defaultNextInstructionIndex,
  markSymbol as defaultMarkSymbol,
  originalTapeBlock,
} from '../consts';
import type { CommandContext, Instructions } from '../commands';
import {
  $tag, call, check, erase, left, mark, noop, right, stop,
} from '../commands';
import { instructionIndexValidator, subroutineNameValidator, validateSymbolPair } from '../validators';
import { installStateLockdown, withLockdownEscape } from '../lockdown';
import { analyzeLocalCallGraph } from '../callGraph';
import {
  type Breakpoint,
  type BreakpointFilter,
  type BreakpointTarget,
  mergeBreakpointFilters,
  validateBreakpointFilter,
} from '../breakpoints';
import { type Path, comparePathsCanonically, formatPath, parsePath } from '../path';
import type { MachineState } from '../index';

export type PostMachineOptions = {
  blankSymbol?: string;
  markSymbol?: string;
};

export class PostMachine extends TuringMachine {
  #initialState: State;
  #blankSymbol: string;
  #markSymbol: string;
  #stateToCandidatePaths: Map<State, Path[]> = new Map();
  #pathToState: Map<string, State> = new Map();
  #referenceToPath: Map<Reference, Path> = new Map();
  #breakpoints: Breakpoint[] = [];

  constructor(instructions: Instructions = {}, options: PostMachineOptions = {}) {
    const blankSymbol = options.blankSymbol ?? defaultBlankSymbol;
    const markSymbol = options.markSymbol ?? defaultMarkSymbol;

    validateSymbolPair(blankSymbol, markSymbol);

    const usesDefaultAlphabet = blankSymbol === defaultBlankSymbol && markSymbol === defaultMarkSymbol;
    const tapeBlock = usesDefaultAlphabet
      ? originalTapeBlock.clone()
      : TapeBlock.fromAlphabets([new Alphabet([blankSymbol, markSymbol])]);

    super({ tapeBlock });

    this.#blankSymbol = blankSymbol;
    this.#markSymbol = markSymbol;

    this.#initialState = this.#buildInitialState({
      instructions,
    });

    // Sort each candidate-path list deterministically for stable test assertions.
    for (const paths of this.#stateToCandidatePaths.values()) {
      paths.sort(comparePathsCanonically);
    }

    // Install the lockdown on every constructed State (except haltState — it's
    // a process-global singleton; installing a per-instance lockdown would block
    // other PostMachine instances and turing-only consumers from writing it.
    // Direct `haltState.debug = boolean` writes go to the engine setter, which
    // (turing-machine-js#207) accepts boolean and rejects object shapes).
    // Direct `state.debug = X` writes are redirected to setBreakpoint/clearBreakpoint
    // when the State has exactly one candidate path; ambiguous shared States throw.
    // Iterate over the unique-state keyspace so shared States aren't re-installed.
    for (const state of this.#stateToCandidatePaths.keys()) {
      if (state.isHalt) continue;
      installStateLockdown(state, (value) => this.#onUserDebugWrite(state, value));
    }
  }

  get tapeBlock(): TapeBlock {
    return super.tapeBlock;
  }

  get tape(): Tape {
    return this.tapeBlock.tapes[0];
  }

  get initialState(): State {
    return this.#initialState;
  }

  replaceTapeWith(newTape: Tape): void {
    this.tapeBlock.replaceTape(newTape);
  }

  override async run({
    stepsLimit = 1e5,
    onStep,
    onPause,
    onIter,
  }: {
    stepsLimit?: number;
    onStep?: (machineState: MachineState) => void;
    onPause?: (machineState: MachineState) => void | Promise<void>;
    onIter?: (machineState: MachineState) => void | Promise<void>;
  } = {}): Promise<void> {
    let prevState: State | null = null;
    let prevJsSymbol: symbol | null = null;
    const entryPath = this.#firstStepArrivalPath();

    // Tracking is owned by the internal onIter wrapper (engine v6.4.0+).
    // onIter fires at end-of-iter — after both onPause(before, K) and
    // onPause(after, K) have already read their iter-correct prev — so
    // advancing here doesn't race those reads. Previously this lived in
    // the internal onStep wrapper, which ran BETWEEN before- and after-
    // fires on the same yield, causing after-fire arrivalPath to resolve
    // against K's prev instead of K-1's. See tests/breakpoints.spec.ts
    // "arrivalPath in after-fire onPause" for the regression case.
    const advanceTracking = (raw: EngineMachineState): void => {
      prevState = raw.state;
      prevJsSymbol = this.tapeBlock.symbol([raw.currentSymbols[0]]);
    };

    // If the user provided any callback, our internal onIter wrapper must
    // be registered to keep `prev` advancing — every callback (including the
    // user's own onStep/onPause/onIter) receives the wrapped state which
    // depends on prev. If no user callback is provided, no one observes
    // wrapped state and we can skip the internal wrapper too, leaving the
    // run to halt with zero per-iter await overhead.
    const isAnyCallbackProvided = !!(onStep || onPause || onIter);

    return super.run({
      initialState: this.#initialState,
      stepsLimit,
      onStep: onStep ? (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        onStep(wrapped);
      } : undefined,
      onPause: onPause ? async (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        if (this.#shouldFireOnPause(raw, wrapped)) {
          await onPause(wrapped);
        }
      } : undefined,
      onIter: isAnyCallbackProvided ? async (raw) => {
        if (onIter) {
          // Wrap with PRE-advance prev so the user's onIter sees the same
          // arrivalPath as onPause(after, K) saw — both describing the
          // arrival at iter K.
          const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
          await onIter(wrapped);
        }
        advanceTracking(raw);
      } : undefined,
    });
  }

  #shouldFireOnPause(raw: EngineMachineState, wrapped: MachineState): boolean {
    // Halt-arrival: engine pauses on the iteration whose nextState is halt,
    // when haltState.debug is set. Yielded raw.state is the *previous* user
    // instruction (e.g., 30 in `30: mark; 40: stop`), never haltState itself.
    const nextIsHalt = raw.nextState instanceof State && raw.nextState.isHalt;
    if (nextIsHalt && this.#breakpoints.some((bp) => bp.kind === 'halt')) {
      return true;
    }
    const arrivalKey = formatPath(wrapped.arrivalPath);
    return this.#breakpoints.some((bp) =>
      bp.kind === 'instruction' && formatPath(bp.path) === arrivalKey);
  }

  override * runStepByStep({ stepsLimit = 1e5 }: { stepsLimit?: number } = {}): Generator<MachineState> {
    let prevState: State | null = null;
    let prevJsSymbol: symbol | null = null;
    const entryPath = this.#firstStepArrivalPath();

    for (const raw of super.runStepByStep({ initialState: this.#initialState, stepsLimit })) {
      const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
      prevState = raw.state;
      prevJsSymbol = this.tapeBlock.symbol([raw.currentSymbols[0]]);
      yield wrapped;
    }
  }

  #firstStepArrivalPath(): Path {
    // Construction guarantees the initial state is recorded in #stateToCandidatePaths
    // with at least one entry.
    return this.#stateToCandidatePaths.get(this.#initialState)![0];
  }

  #wrapMachineState(
    raw: EngineMachineState,
    prevState: State | null,
    prevJsSymbol: symbol | null,
    entryPath: Path,
  ): MachineState {
    let arrivalPath: Path;
    if (prevState === null || prevJsSymbol === null) {
      arrivalPath = entryPath;
    } else {
      // Some intermediate engine states (call wrappers, continuation states, subroutine
      // entry dispatchers) only register an ifOtherSymbol transition. Try the specific
      // symbol first; fall back to ifOtherSymbol. Engine guarantees: a state we just
      // arrived at must have had a matching transition, so one of the two succeeds.
      let followed: State | Reference;
      try {
        followed = prevState.getNextState(prevJsSymbol);
      } catch {
        followed = prevState.getNextState(ifOtherSymbol);
      }

      if (followed instanceof Reference) {
        // Either the followed Reference is recorded (instruction reference) → use its Path.
        // Or it's a subroutine-entry hopper reference (untracked) → raw.state is the
        // subroutine body's first instruction, which IS recorded.
        arrivalPath = this.#referenceToPath.get(followed) ?? this.#stateToCandidatePaths.get(raw.state)![0];
      } else {
        // followed is a State (haltState or inline continuation): raw.state may not
        // be recorded (continuation states aren't), so fall back to entryPath.
        arrivalPath = this.#stateToCandidatePaths.get(raw.state)?.[0] ?? entryPath;
      }
    }
    const candidatePaths = this.#stateToCandidatePaths.get(raw.state) ?? [];
    return { ...raw, arrivalPath, candidatePaths } as MachineState;
  }

  #buildInitialState({
    instructions,
    subroutinesDataFromUpperScope = {},
    subroutineInitialStatesFromUpperScope = {},
    calledFromGroup = false,
    instructionPrefix = '',
    scope = [],
    groupOuterInstructionIndex,
  }: {
    instructions: Instructions;
    subroutinesDataFromUpperScope?: Record<string, { reference: Reference; instructions: Instructions }>;
    subroutineInitialStatesFromUpperScope?: Record<string, State>;
    calledFromGroup?: boolean;
    instructionPrefix?: string;
    scope?: string[];
    groupOuterInstructionIndex?: number;
  }): State {
    const instructionsCopy = { ...instructions };

    const hasSymbolKeyProperties = Object.getOwnPropertySymbols(instructionsCopy).length > 0;

    if (hasSymbolKeyProperties) {
      throw new Error('invalid instruction index(es)');
    }

    const localSubroutinesData = Object.keys(instructionsCopy)
      .filter((instructionIndexStr) => !instructionIndexValidator(instructionIndexStr))
      .reduce<Record<string, { reference: Reference; instructions: Instructions }>>((result, subroutineName) => {
        if (!subroutineNameValidator(subroutineName)) {
          throw new Error(`invalid subroutine name: '${subroutineName}'`);
        }

        const instructionsForSubroutinesData = instructionsCopy[subroutineName] as Instructions;

        delete instructionsCopy[subroutineName];

        return {
          ...result,
          [subroutineName]: {
            reference: new Reference(),
            instructions: instructionsForSubroutinesData,
          },
        };
      }, {});
    const subroutinesData = {
      ...subroutinesDataFromUpperScope,
      ...localSubroutinesData,
    };
    // Cycle-aware hopper construction (#85).
    //
    // Static analysis of the local subroutine call graph identifies which
    // subroutines participate in cycles (mutual recursion or self-loop). For
    // those, we keep the v6.x hopper — a stub `State` that wraps a
    // `Reference` to the subroutine's first instruction, providing the
    // forward-declaration anchor that `withOverriddenHaltState` needs at the
    // moment `call(...)` invocations are processed.
    //
    // Acyclic subroutines (the common case) skip the hopper. We process them
    // in reverse-topological build order — sinks first — so by the time
    // `call('X')` runs for an acyclic X, X's first-instruction State already
    // exists and we wrap it directly. Net effect: -1 graph node per acyclic
    // subroutine; the wrapper composite name becomes `X::1(continuation)`
    // (accurately reflects the wrapped bare) instead of `X(continuation)`.
    const localSubroutineInstructions: Record<string, Instructions> = Object.fromEntries(
      Object.entries(localSubroutinesData).map(([name, data]) => [name, data.instructions]),
    );
    const {cyclicSet, buildOrder} = analyzeLocalCallGraph(localSubroutineInstructions);

    const subroutineInitialStates: Record<string, State> = {
      ...subroutineInitialStatesFromUpperScope,
    };

    // Create hoppers only for cyclic local subs. Acyclic entries are filled
    // in after each acyclic sub's body is recursively built (below).
    for (const subroutineName of Object.keys(localSubroutinesData)) {
      if (cyclicSet.has(subroutineName)) {
        subroutineInitialStates[subroutineName] = new State({
          [ifOtherSymbol]: {
            nextState: localSubroutinesData[subroutineName].reference,
          },
        }, `${instructionPrefix}${subroutineName}`);
      }
    }

    // Build subroutines in reverse-topological order. Tarjan's SCC output
    // (in `buildOrder`) starts with sinks — local subs with no outgoing
    // calls to other local subs — so each sub's local callees are built (and
    // present in `subroutineInitialStates`) before the sub itself is built.
    for (const subroutineName of buildOrder) {
      const {
        reference,
        instructions: subroutineInstructions,
      } = subroutinesData[subroutineName];

      const firstInstructionState = this.#buildInitialState({
        instructions: subroutineInstructions,
        subroutinesDataFromUpperScope: subroutinesData,
        subroutineInitialStatesFromUpperScope: subroutineInitialStates,
        instructionPrefix: `${instructionPrefix}${subroutineName}::`,
        scope: [...scope, subroutineName],
      });

      reference.bind(firstInstructionState);

      // Acyclic — install the first-instruction State as the subroutine's
      // entry point IF it's safe to wrap. Two cases force a hopper fallback:
      //
      //   1. `firstInstructionState === haltState` (degenerate `{ 1: stop }`
      //      body). Wrapping haltState produces a State with an empty
      //      `symbolToDataMap`; the engine throws at runtime trying to
      //      resolve a transition.
      //
      //   2. `firstInstructionState` is itself a wrapper (group `[…]` or
      //      `call('bar')` as the subroutine's first instruction). Engine
      //      #176 collapses nested `withOverriddenHaltState` chains — the
      //      inner wrapping (group's own continuation, or the inner `call`'s
      //      continuation) gets unwrapped and lost when this wrapper is
      //      applied. Subsequent body instructions become unreachable.
      //
      // Both cases are detected by checking whether the first-instruction
      // State is a plain bare (non-halt, no override). When it isn't, the
      // hopper restores the invariant — it's a fresh State whose single
      // `[ifOtherSymbol]` transition points at the first-instruction State,
      // and wrapping the hopper preserves both the call-site continuation
      // and any inner wrapping the first instruction already has.
      if (!cyclicSet.has(subroutineName)) {
        const canDropHopper = !firstInstructionState.isHalt
          && firstInstructionState.overriddenHaltState === null;

        if (canDropHopper) {
          subroutineInitialStates[subroutineName] = firstInstructionState;
        } else {
          subroutineInitialStates[subroutineName] = new State({
            [ifOtherSymbol]: {
              nextState: firstInstructionState,
            },
          }, `${instructionPrefix}${subroutineName}`);
        }
      }
    }

    const instructionIndexList = Object.keys(instructionsCopy);

    if (instructionIndexList.length === 0) {
      throw new Error('there is no instructions');
    }

    const references: Record<string, Reference> = instructionIndexList.reduce((result, instructionIndex) => ({
      ...result,
      [instructionIndex]: new Reference(),
    }), {});

    for (const indexKey of instructionIndexList) {
      const path: Path = groupOuterInstructionIndex !== undefined
        ? {
            ...(scope.length > 0 ? { scope: [...scope] } : {}),
            instructionIndex: groupOuterInstructionIndex,
            groupInstructionIndex: Number(indexKey),
          }
        : {
            ...(scope.length > 0 ? { scope: [...scope] } : {}),
            instructionIndex: Number(indexKey),
          };
      this.#referenceToPath.set(references[indexKey], path);
    }

    const states = new Map<string, State>();
    const list = instructionIndexList.map(Number);

    list.forEach((instructionIndex) => {
      // Widen to `unknown` for the switch — this block runtime-discriminates
      // on user-supplied values, including the bare `call` / `check` references
      // which don't fit `CommandConstructor`'s shape and are caught here.
      const cmd: unknown = instructionsCopy[String(instructionIndex)];
      switch (cmd) {
        case erase:
        case left:
        case mark:
        case noop:
        case right:
        case stop:
          (instructionsCopy as Record<string, unknown>)[String(instructionIndex)] = (cmd as (ix?: number | symbol) => unknown)(defaultNextInstructionIndex);
          break;
        case call:
        case check:
          throw new Error(`inappropriate '${(cmd as { name?: string }).name}' command usage at instruction ${instructionIndex}`);
        default:
          break;
      }
    });

    const builtStates = new Map<string, State>();

    list.forEach((instructionIndex, ix) => {
      const instruction = (instructionsCopy as Record<string, unknown>)[String(instructionIndex)];

      if (commandsSet.has(instruction as CommandFn)) {
        const context: CommandContext = {
          instructionIndex: Number(instructionIndex),
          nextInstructionIndex: list[ix + 1],
          tapeBlock: this.tapeBlock,
          references,
          states,
          subroutineInitialStates,
          calledFromGroup,
          blankSymbol: this.#blankSymbol,
          markSymbol: this.#markSymbol,
          instructionPrefix,
        };
        builtStates.set(String(instructionIndex), (instruction as (context: CommandContext) => State)(context));
      } else if (Array.isArray(instruction)) {
        if (instruction.length === 0) {
          throw new Error('empty group');
        }

        const areInstructionsInGroupValid = instruction
          .every((command) => commandsSet.has(command as CommandFn));

        if (!areInstructionsInGroupValid) {
          if (instruction.includes($tag as never)) {
            throw new Error(
              'bare `$tag` decorator in a group — `$tag` must be invoked, '
              + 'e.g. `[$tag(\'hot\', mark), right]`',
            );
          }
          throw new Error('invalid command in the group');
        }

        const groupState = this.#buildInitialState({
          instructions: instruction.reduce<Instructions>((result, command, commandIndexInTheGroup) => ({
            ...result,
            [commandIndexInTheGroup + 1]: command,
          }), {}),
          subroutinesDataFromUpperScope: subroutinesData,
          subroutineInitialStatesFromUpperScope: subroutineInitialStates,
          calledFromGroup: true,
          instructionPrefix: `${instructionPrefix}${instructionIndex}.`,
          scope,
          groupOuterInstructionIndex: instructionIndex,
        });

        let nextState: State | Reference;

        if (list[ix + 1] == null) {
          nextState = haltState;
        } else {
          nextState = references[String(list[ix + 1])];
        }

        const callerName = `${instructionPrefix}${instructionIndex}`;
        const targetName = nextState === haltState
          ? 'halt'
          : `${instructionPrefix}${list[ix + 1]}`;
        const continuationName = `${callerName}~${targetName}`;

        builtStates.set(String(instructionIndex), groupState.withOverriddenHaltState(new State({
          [ifOtherSymbol]: {
            nextState,
          },
        }, continuationName)));
      } else if (instruction === $tag) {
        throw new Error(
          'bare `$tag` decorator passed as an instruction — `$tag` must be '
          + 'invoked, e.g. `10: $tag(\'hot\', mark)`',
        );
      } else {
        throw new Error('invalid instruction');
      }
    });

    builtStates.forEach((state, instructionIndexStr) => {
      references[instructionIndexStr].bind(state);

      const path: Path = groupOuterInstructionIndex !== undefined
        ? {
            ...(scope.length > 0 ? { scope: [...scope] } : {}),
            instructionIndex: groupOuterInstructionIndex,
            groupInstructionIndex: Number(instructionIndexStr),
          }
        : {
            ...(scope.length > 0 ? { scope: [...scope] } : {}),
            instructionIndex: Number(instructionIndexStr),
          };

      this.#recordPath(state, path);

      // Auto-tag policy (#86). Only the ENTRY POINT of each program /
      // subroutine gets an auto-tag — `1` for main, `alg::1` for subroutine
      // `alg` — to keep diagrams uncluttered while still anchoring the
      // structural roles. Group inner states and halt-resolving paths are
      // skipped (halt is a globally-shared singleton and can't be safely
      // tagged).
      if (
        groupOuterInstructionIndex === undefined
        && !state.isHalt
        && Number(instructionIndexStr) === list[0]
      ) {
        const tagName = scope.length === 0
          ? 'main'
          : scope[scope.length - 1];
        state.tag(tagName);
      }
    });

    return references[instructionIndexList[0]].ref;
  }

  #resolveToState(target: Path | string): { path: Path; state: State } {
    const parsed: Path = typeof target === 'string'
      ? parsePath(target)
      : this.#validatePathObject(target);
    const key = formatPath(parsed);
    const state = this.#pathToState.get(key);
    if (!state) {
      throw new Error(`path '${key}' does not resolve in this machine`);
    }
    return { path: parsed, state };
  }

  #validatePathObject(p: Path): Path {
    if (!Number.isInteger(p.instructionIndex) || p.instructionIndex < 1) {
      throw new Error(`invalid path: instructionIndex must be a positive integer, got ${p.instructionIndex}`);
    }
    if (p.groupInstructionIndex !== undefined
      && (!Number.isInteger(p.groupInstructionIndex) || p.groupInstructionIndex < 1)) {
      throw new Error(`invalid path: groupInstructionIndex must be a positive integer, got ${p.groupInstructionIndex}`);
    }
    if (p.scope !== undefined) {
      const segs = typeof p.scope === 'string' ? p.scope.split('::') : p.scope;
      for (const s of segs) {
        if (!subroutineNameValidator(s)) {
          throw new Error(`invalid path: scope segment '${s}' is not a valid subroutine name`);
        }
      }
    }
    // Canonicalize so the registry/listBreakpoints output is shape-stable
    // regardless of whether the caller passed a string or an object form,
    // and regardless of whether scope was 'foo::bar' or ['foo', 'bar'].
    return parsePath(formatPath(p));
  }

  stateAt(target: Path | string): State {
    const { state } = this.#resolveToState(target);
    return state;
  }

  hasState(target: Path | string): boolean {
    try {
      this.#resolveToState(target);
      return true;
    } catch {
      return false;
    }
  }

  candidatesFor(target: Path | string): Path[] {
    const { state } = this.#resolveToState(target);
    return this.#stateToCandidatePaths.get(state)!;
  }

  tag(target: Path | string, ...tags: string[]): void {
    const { state } = this.#resolveToState(target);
    state.tag(...tags);
  }

  untag(target: Path | string, ...tags: string[]): void {
    const { state } = this.#resolveToState(target);
    state.untag(...tags);
  }

  tagsOf(target: Path | string): readonly string[] {
    const { state } = this.#resolveToState(target);
    return state.tags;
  }

  findByTag(tag: string): Path[] {
    const results: Path[] = [];
    for (const [state, paths] of this.#stateToCandidatePaths) {
      if (state.tags.includes(tag)) {
        results.push(...paths);
      }
    }
    return results;
  }

  setBreakpoint(target: BreakpointTarget, filter: BreakpointFilter): void {
    validateBreakpointFilter(filter);
    const resolved = this.#resolveBreakpointTarget(target);
    if (resolved.kind === 'instruction') {
      this.#breakpoints.push({ kind: 'instruction', path: resolved.path, filter });
      this.#refreshStateDebug(resolved.state);
    } else {
      this.#breakpoints.push({ kind: 'halt', filter });
      this.#refreshHaltDebug();
    }
  }

  clearBreakpoint(target: BreakpointTarget): void {
    const resolved = this.#resolveBreakpointTarget(target);
    if (resolved.kind === 'instruction') {
      const key = formatPath(resolved.path);
      this.#breakpoints = this.#breakpoints.filter(
        (bp) => !(bp.kind === 'instruction' && formatPath(bp.path) === key),
      );
      this.#refreshStateDebug(resolved.state);
    } else {
      this.#breakpoints = this.#breakpoints.filter((bp) => bp.kind !== 'halt');
      this.#refreshHaltDebug();
    }
  }

  clearBreakpoints(): void {
    const instructionStates = new Set<State>();
    let hadHalt = false;
    for (const bp of this.#breakpoints) {
      if (bp.kind === 'instruction') {
        instructionStates.add(this.#pathToState.get(formatPath(bp.path))!);
      } else {
        hadHalt = true;
      }
    }
    this.#breakpoints = [];
    for (const s of instructionStates) this.#refreshStateDebug(s);
    if (hadHalt) this.#refreshHaltDebug();
  }

  listBreakpoints(): Breakpoint[] {
    return this.#breakpoints.map((bp) => (bp.kind === 'instruction'
      ? { kind: 'instruction', path: { ...bp.path }, filter: { ...bp.filter } }
      : { kind: 'halt', filter: { ...bp.filter } }));
  }

  #resolveBreakpointTarget(target: BreakpointTarget):
    | { kind: 'instruction'; path: Path; state: State }
    | { kind: 'halt' }
  {
    if (target instanceof State) {
      if (target.isHalt) {
        return { kind: 'halt' };
      }
      throw new Error(
        'setBreakpoint accepts a State only for the haltState singleton. '
        + 'Use a Path or path string for instruction breakpoints.',
      );
    }
    const { path, state } = this.#resolveToState(target);
    // A path that resolves to haltState (e.g., a `stop` instruction) is treated as
    // a halt breakpoint — halt is singular, no per-path discrimination.
    if (state.isHalt) {
      return { kind: 'halt' };
    }
    return { kind: 'instruction', path, state };
  }

  #refreshStateDebug(state: State): void {
    const filters = this.#breakpoints
      .filter((bp): bp is Extract<Breakpoint, { kind: 'instruction' }> =>
        bp.kind === 'instruction' && this.#pathToState.get(formatPath(bp.path)) === state)
      .map((bp) => bp.filter);
    withLockdownEscape(() => {
      state.debug = (filters.length > 0 ? mergeBreakpointFilters(filters) : null) as State['debug'];
    });
  }

  #refreshHaltDebug(): void {
    // turing-machine-js#207: `haltState.debug` is now a boolean. The legacy
    // `mergeBreakpointFilters` returned a per-side DebugConfig object that
    // the engine rejects at write time. Halt has one meaningful pause
    // moment (post-triggering-iter), so any registered halt-BP collapses to
    // "on"; absence collapses to "off". The per-BP `filter` shape kept in
    // `#breakpoints` is now decorative for halt entries — it still drives
    // arrival-path filtering in the onPause wrapper but doesn't shape the
    // engine-level write.
    //
    // No `withLockdownEscape` needed — the module-load `installHaltLockdown`
    // was dropped in this release; haltState writes go straight to the
    // engine's setter (which under #207 accepts boolean).
    const hasHaltBP = this.#breakpoints.some((bp) => bp.kind === 'halt');
    haltState.debug = hasHaltBP;
  }

  #onUserDebugWrite(state: State, value: unknown): void {
    const paths = this.#stateToCandidatePaths.get(state)!;
    if (paths.length > 1) {
      throw new Error(
        `Direct state.debug assignment is ambiguous for a State shared by `
        + `multiple instructions (${paths.map((p) => `'${formatPath(p)}'`).join(', ')}). `
        + `Use pm.setBreakpoint(<path>, filter) to target a specific instruction.`,
      );
    }
    if (value === null) {
      this.clearBreakpoint(paths[0]);
    } else {
      this.setBreakpoint(paths[0], value as BreakpointFilter);
    }
  }

  #recordPath(state: State, path: Path): void {
    const existing = this.#stateToCandidatePaths.get(state);
    if (existing) {
      existing.push(path);
    } else {
      this.#stateToCandidatePaths.set(state, [path]);
    }
    this.#pathToState.set(formatPath(path), state);
  }
}
