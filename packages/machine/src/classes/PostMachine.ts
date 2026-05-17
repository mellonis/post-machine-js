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
  call, check, erase, left, mark, noop, right, stop,
} from '../commands';
import { instructionIndexValidator, subroutineNameValidator, validateSymbolPair } from '../validators';
import { installStateLockdown, withLockdownEscape } from '../lockdown';
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

    // Install the lockdown on every constructed State (except haltState, which is
    // locked module-globally with halt-specific semantics — it's shared across
    // PostMachine instances, so per-instance lockdown would clobber across runs).
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
  }: {
    stepsLimit?: number;
    onStep?: (machineState: MachineState) => void;
    onPause?: (machineState: MachineState) => void | Promise<void>;
  } = {}): Promise<void> {
    let prevState: State | null = null;
    let prevJsSymbol: symbol | null = null;
    const entryPath = this.#firstStepArrivalPath();

    // Tracking is owned by the always-active internal onStep wrapper (registered
    // unconditionally even if the user passed only onPause), so prevState advances
    // every iteration regardless of whether the user's callbacks are invoked.
    const advanceTracking = (raw: EngineMachineState): void => {
      prevState = raw.state;
      prevJsSymbol = this.tapeBlock.symbol([raw.currentSymbols[0]]);
    };

    await super.run({
      initialState: this.#initialState,
      stepsLimit,
      onStep: (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        if (onStep) onStep(wrapped);
        advanceTracking(raw);
      },
      onPause: onPause ? async (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        if (this.#shouldFireOnPause(raw, wrapped)) {
          await onPause(wrapped);
        }
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
    const subroutineInitialStates: Record<string, State> = {
      ...subroutineInitialStatesFromUpperScope,
      ...Object.keys(localSubroutinesData).reduce<Record<string, State>>((result, subroutineName) => ({
        ...result,
        [subroutineName]: new State({
          [ifOtherSymbol]: {
            nextState: localSubroutinesData[subroutineName].reference,
          },
        }, `${instructionPrefix}${subroutineName}`),
      }), {}),
    };

    Object.keys(localSubroutinesData).forEach((subroutineName) => {
      const {
        reference,
        instructions: subroutineInstructions,
      } = subroutinesData[subroutineName];

      reference.bind(this.#buildInitialState({
        instructions: subroutineInstructions,
        subroutinesDataFromUpperScope: subroutinesData,
        subroutineInitialStatesFromUpperScope: subroutineInitialStates,
        instructionPrefix: `${instructionPrefix}${subroutineName}::`,
        scope: [...scope, subroutineName],
      }));
    });

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

        builtStates.set(String(instructionIndex), groupState.withOverrodeHaltState(new State({
          [ifOtherSymbol]: {
            nextState,
          },
        }, continuationName)));
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
        const s = this.#pathToState.get(formatPath(bp.path));
        if (s) instructionStates.add(s);
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
    const filters = this.#breakpoints
      .filter((bp): bp is Extract<Breakpoint, { kind: 'halt' }> => bp.kind === 'halt')
      .map((bp) => bp.filter);
    withLockdownEscape(() => {
      haltState.debug = (filters.length > 0 ? mergeBreakpointFilters(filters) : null) as State['debug'];
    });
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
