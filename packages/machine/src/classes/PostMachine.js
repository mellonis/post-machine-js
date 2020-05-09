import TuringMachine, {
  Reference,
  State,
  ifOtherSymbol,
  haltState,
} from '@turing-machine-js/machine';
import { commandsSet, defaultNextInstructionIndex, originalTapeBlock } from '../consts';
import {
  call, check, erase, left, mark, noop, right, stop,
} from '../commands';
import { instructionIndexValidator, subroutineNameValidator } from '../validators';

export default class PostMachine extends TuringMachine {
  #initialState;

  constructor(instructions = {}) {
    super({ tapeBlock: originalTapeBlock.clone() });

    this.#initialState = this.#buildInitialState({
      instructions,
    });
  }

  get tape() {
    return this.tapeBlock.tapeList[0];
  }

  replaceTapeWith(newTape) {
    this.tapeBlock.replaceTape(newTape);
  }

  run({ stepsLimit = 1e5, onStep = null } = {}) {
    const iterator = this.runStepByStep({ stepsLimit });

    // eslint-disable-next-line no-restricted-syntax
    for (const machineState of iterator) {
      if (onStep instanceof Function) {
        onStep(machineState);
      }
    }
  }

  * runStepByStep({ stepsLimit = 1e5 } = {}) {
    yield* super.runStepByStep({ initialState: this.#initialState, stepsLimit });
  }

  #buildInitialState = ({
    instructions,
    subroutinesDataFromUpperScope = {},
    subroutineInitialStatesFromUpperScope = {},
    calledFromGroup = false,
  }) => {
    const instructionsCopy = { ...instructions };

    const hasSymbolKeyProperties = Object.getOwnPropertySymbols(instructionsCopy).length > 0;

    if (hasSymbolKeyProperties) {
      throw new Error('invalid instruction index(es)');
    }

    const localSubroutinesData = Object.keys(instructionsCopy)
      .filter((instructionIndexStr) => !instructionIndexValidator(instructionIndexStr))
      .reduce((result, subroutineName) => {
        if (!subroutineNameValidator(subroutineName)) {
          throw new Error(`invalid subroutine name: '${subroutineName}'`);
        }

        const instructionsForSubroutinesData = instructionsCopy[subroutineName];

        delete instructionsCopy[subroutineName];

        return {
          ...result,
          [subroutineName]: {
            willBeBoundSoon: false,
            reference: new Reference(),
            instructions: instructionsForSubroutinesData,
          },
        };
      }, {});
    const subroutinesData = {
      ...subroutinesDataFromUpperScope,
      ...localSubroutinesData,
    };
    const subroutineInitialStates = {
      ...subroutineInitialStatesFromUpperScope,
      ...Object.keys(localSubroutinesData)
        .reduce((result, subroutineName) => ({
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

    const references = instructionIndexList.reduce((result, instructionIndex) => ({
      ...result,
      [instructionIndex]: new Reference(),
    }), {});

    const states = new Map();

    instructionIndexList.map(Number).forEach((instructionIndex, ix, list) => {
      switch (instructionsCopy[instructionIndex]) {
        case erase:
        case left:
        case mark:
        case noop:
        case right:
        case stop:
          // eslint-disable-next-line max-len
          instructionsCopy[instructionIndex] = instructionsCopy[instructionIndex](defaultNextInstructionIndex);
          break;
        case call:
        case check:
          throw new Error(`inappropriate '${instructionsCopy[instructionIndex].name}' command usage at instruction ${instructionIndex}`);
        // no default
      }

      if (commandsSet.has(instructionsCopy[instructionIndex])) {
        references[instructionIndex].bind(instructionsCopy[instructionIndex].call(null, {
          instructionIndex: Number(instructionIndex),
          nextInstructionIndex: list[ix + 1],
          tapeBlock: this.tapeBlock,
          references,
          states,
          subroutineInitialStates,
          calledFromGroup,
        }));
      } else if (Array.isArray(instructionsCopy[instructionIndex])) {
        if (instructionsCopy[instructionIndex].length === 0) {
          throw new Error('empty group');
        }

        const areInstructionsInGroupValid = instructionsCopy[instructionIndex]
          .every((command) => commandsSet.has(command));

        if (!areInstructionsInGroupValid) {
          throw new Error('invalid command in the group');
        }

        const groupState = this.#buildInitialState({
          instructions: instructionsCopy[instructionIndex]
            .reduce((result, command, commandIndexInTheGroup) => ({
              ...result,
              [commandIndexInTheGroup + 1]: command,
            }), {}),
          subroutinesDataFromUpperScope: subroutinesData,
          subroutineInitialStatesFromUpperScope: subroutineInitialStates,
          calledFromGroup: true,
        });

        let nextState;

        if (list[ix + 1] == null) {
          nextState = haltState;
        } else {
          nextState = references[list[ix + 1]];
        }

        references[instructionIndex].bind(groupState.withOverrodeHaltState(new State({
          [ifOtherSymbol]: {
            nextState,
          },
        })));
      } else {
        throw new Error('invalid instruction');
      }
    });

    return references[instructionIndexList[0]].ref;
  }
}
