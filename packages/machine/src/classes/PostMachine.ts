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
import { type Path, comparePathsCanonically } from '../path';
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
  #referenceToPath: Map<Reference, Path> = new Map();

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
    const candidates = this.#stateToCandidatePaths.get(this.#initialState);
    if (!candidates || candidates.length === 0) {
      throw new Error('PostMachine internal: initial state has no candidate paths');
    }
    return candidates[0];
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
      // symbol first; fall back to ifOtherSymbol; fall back to candidatePaths[0].
      let followed: State | Reference | undefined;
      try {
        followed = prevState.getNextState(prevJsSymbol);
      } catch {
        try {
          followed = prevState.getNextState(ifOtherSymbol);
        } catch {
          followed = undefined;
        }
      }

      if (followed instanceof Reference) {
        const fromRef = this.#referenceToPath.get(followed);
        if (fromRef) {
          arrivalPath = fromRef;
        } else {
          const candidates = this.#stateToCandidatePaths.get(raw.state);
          arrivalPath = candidates && candidates.length > 0 ? candidates[0] : entryPath;
        }
      } else {
        const candidates = this.#stateToCandidatePaths.get(raw.state);
        arrivalPath = candidates && candidates.length > 0 ? candidates[0] : entryPath;
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

  #recordPath(state: State, path: Path): void {
    const existing = this.#stateToCandidatePaths.get(state);
    if (existing) {
      existing.push(path);
    } else {
      this.#stateToCandidatePaths.set(state, [path]);
    }
  }
}
