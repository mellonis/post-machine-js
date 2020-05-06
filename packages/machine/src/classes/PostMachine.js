import TuringMachine, { Reference } from '@turing-machine-js/machine';
import { defaultNextInstructionIndex, originalTapeBlock } from '../consts';
import {
  call, check, erase, left, mark, noop, right, stop,
} from '../commands';
import { instructionIndexValidator, subroutineNameValidator } from '../validators';

export default class PostMachine extends TuringMachine {
  #initialState;

  constructor(instructions = {}) {
    super({ tapeBlock: originalTapeBlock.clone() });

    this.#initialState = this.#buildInitialState(instructions);
  }

  get tape() {
    return this.tapeBlock.tapeList[0];
  }

  set tape(newTape) {
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

  #buildInitialState = (instructions, isSubroutine = false) => {
    const instructionsCopy = { ...instructions };

    const hasSymbolKeyProperties = Object.getOwnPropertySymbols(instructionsCopy).length > 0;

    if (hasSymbolKeyProperties) {
      throw new Error('invalid instruction index(es)');
    }

    const subroutineInitialStates = Object.keys(instructionsCopy)
      .filter((instructionIndexStr) => (
        !isSubroutine && !instructionIndexValidator(instructionIndexStr)
      ))
      .reduce((result, subroutineName) => {
        if (!subroutineNameValidator(subroutineName)) {
          throw new Error(`invalid subroutine name: '${subroutineName}'`);
        }

        // eslint-disable-next-line no-param-reassign
        result[subroutineName] = this.#buildInitialState(instructionsCopy[subroutineName], true);
        delete instructionsCopy[subroutineName];

        return result;
      }, {});

    const instructionIndexList = Object.keys(instructionsCopy);

    if (instructionIndexList.length === 0) {
      throw new Error('there is no instructions');
    }

    const areInstructionIndexesValid = instructionIndexList
      .every(instructionIndexValidator);

    if (!areInstructionIndexesValid) {
      throw new Error('invalid instruction index(es)');
    }

    const references = instructionIndexList.reduce((result, instructionIndex) => {
      // eslint-disable-next-line no-param-reassign
      result[instructionIndex] = new Reference();

      return result;
    }, {});

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

      references[instructionIndex].bind(instructionsCopy[instructionIndex].call(null, {
        instructionIndex: Number(instructionIndex),
        nextInstructionIndex: list[ix + 1],
        tapeBlock: this.tapeBlock,
        references,
        states,
        subroutineInitialStates,
      }));
    });

    return references[instructionIndexList[0]].ref;
  }
}
