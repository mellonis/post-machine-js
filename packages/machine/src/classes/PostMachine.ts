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
import { wrapStateForLockdown } from '../lockdown';
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
  #stateProxyCache: Map<State, State> = new Map();

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

    // KNOWN LIMITATION: when `state.debug` is set AND both `onStep` and `onPause`
    // are provided, both callbacks fire on the same iteration. Each invocation advances
    // `prevState` / `prevJsSymbol` via the tracking logic below. For the next iteration,
    // arrival derivation in #wrapMachineState uses the "one step behind" tracking values.
    // The second callback's advance overwrites the first with the same values, which is
    // benign in the current engine v6 lifecycle, but the tracking is not correctly
    // "one step behind" if the engine's callback dispatch order changes in a future
    // engine release. Acceptable for now; revisit alongside the per-instruction
    // breakpoint API (#59).
    const advanceTracking = (raw: EngineMachineState): void => {
      prevState = raw.state;
      prevJsSymbol = this.tapeBlock.symbol([raw.currentSymbols[0]]);
    };

    await super.run({
      initialState: this.#initialState,
      stepsLimit,
      onStep: onStep ? (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        advanceTracking(raw);
        onStep(wrapped);
      } : undefined,
      onPause: onPause ? async (raw) => {
        const wrapped = this.#wrapMachineState(raw, prevState, prevJsSymbol, entryPath);
        advanceTracking(raw);
        await onPause(wrapped);
      } : undefined,
    });
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
    return wrapStateForLockdown(state, this.#stateProxyCache);
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
