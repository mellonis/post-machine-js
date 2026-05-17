import {
  Alphabet,
  type MachineState,
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

export type PostMachineOptions = {
  blankSymbol?: string;
  markSymbol?: string;
};

export class PostMachine extends TuringMachine {
  #initialState: State;
  #blankSymbol: string;
  #markSymbol: string;

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
    __onPause,
  }: {
    stepsLimit?: number;
    onStep?: (machineState: MachineState) => void;
    __onPause?: (machineState: MachineState) => void | Promise<void>;
  } = {}): Promise<void> {
    await super.run({
      initialState: this.#initialState,
      stepsLimit,
      onStep,
      onPause: __onPause,
    });
  }

  override * runStepByStep({ stepsLimit = 1e5 }: { stepsLimit?: number } = {}): Generator<MachineState> {
    yield* super.runStepByStep({ initialState: this.#initialState, stepsLimit });
  }

  #buildInitialState({
    instructions,
    subroutinesDataFromUpperScope = {},
    subroutineInitialStatesFromUpperScope = {},
    calledFromGroup = false,
    instructionPrefix = '',
  }: {
    instructions: Instructions;
    subroutinesDataFromUpperScope?: Record<string, { reference: Reference; instructions: Instructions }>;
    subroutineInitialStatesFromUpperScope?: Record<string, State>;
    calledFromGroup?: boolean;
    instructionPrefix?: string;
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
        }),
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
        });

        let nextState: State | Reference;

        if (list[ix + 1] == null) {
          nextState = haltState;
        } else {
          nextState = references[String(list[ix + 1])];
        }

        builtStates.set(String(instructionIndex), groupState.withOverrodeHaltState(new State({
          [ifOtherSymbol]: {
            nextState,
          },
        })));
      } else {
        throw new Error('invalid instruction');
      }
    });

    builtStates.forEach((state, instructionIndex) => {
      references[instructionIndex].bind(state);
    });

    return references[instructionIndexList[0]].ref;
  }
}
