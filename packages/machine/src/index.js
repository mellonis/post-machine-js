import TuringMachine, { Alphabet, Reference, TapeBlock } from '@turing-machine-js/machine';
import { blankSymbol, defaultNextInstructionIndex, markSymbol } from './consts';
import {
  check, erase, left, mark, right, stop,
} from './commands';

export { Tape } from '@turing-machine-js/machine';
export { blankSymbol, markSymbol } from './consts';
export {
  left, right, mark, erase, check, stop,
} from './commands';

const alphabet = new Alphabet({
  symbolList: [blankSymbol, markSymbol],
});

const stubTapeBlock = new TapeBlock({
  alphabetList: [alphabet],
});

export default class PostMachine extends TuringMachine {
  #initialState;

  constructor(instructions = {}) {
    super({ tapeBlock: stubTapeBlock.clone() });

    this.#initialState = this.#buildInitialState(instructions);

    if (!this.#initialState) {
      throw new Error('invalid instructions');
    }
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
    yield* super.runStepByStep(this.#initialState, stepsLimit);
  }

  get tape() {
    return this.tapeBlock.tapeList[0];
  }

  set tape(newTape) {
    this.tapeBlock.replaceTape(newTape);
  }

  #buildInitialState = (instructions) => {
    const instructionsCopy = { ...instructions };

    const hasSymbolKeyProperties = Object.getOwnPropertySymbols(instructionsCopy).length > 0;

    if (hasSymbolKeyProperties) {
      throw new Error('invalid instruction index(es)');
    }

    const instructionIndexList = Object.keys(instructionsCopy);

    if (instructionIndexList.length === 0) {
      throw new Error('there is no instructions');
    }

    const areInstructionIndexesValid = instructionIndexList
      .every((instructionIndex) => Number.isFinite(Number(instructionIndex)));

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
        case left:
        case right:
        case mark:
        case erase:
          // eslint-disable-next-line max-len
          instructionsCopy[instructionIndex] = instructionsCopy[instructionIndex](defaultNextInstructionIndex);
          break;
        case stop:
          instructionsCopy[instructionIndex] = stop(defaultNextInstructionIndex);
          break;
        case check:
          throw new Error(`invalid 'check' command usage at instruction ${instructionIndex}`);
        default:
          break;
      }

      references[instructionIndex].bind(instructionsCopy[instructionIndex].call(null, {
        instructionIndex: Number(instructionIndex),
        nextInstructionIndex: list[ix + 1],
        tapeBlock: this.tapeBlock,
        references,
        states,
      }));
    });

    return references[instructionIndexList[0]].ref;
  }
}
