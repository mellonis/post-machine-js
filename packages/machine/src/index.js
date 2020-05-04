import TuringMachine, {
  Alphabet,
  haltState,
  ifOtherSymbol,
  movements,
  Reference,
  State,
  TapeBlock,
} from '@turing-machine-js/machine';

export { Tape } from '@turing-machine-js/machine';

export const blankSymbol = ' ';
export const markSymbol = '*';

const alphabet = new Alphabet({
  symbolList: [blankSymbol, markSymbol],
});

const stubTapeBlock = new TapeBlock({
  alphabetList: [alphabet],
});

const defaultNextInstructionIndex = Symbol('defaultNextInstructionIndex');

function leftFn({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let nextState;

  if (this.nextInstructionIndex === defaultNextInstructionIndex) {
    this.nextInstructionIndex = nextInstructionIndex;
  }

  if (this.nextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, this.nextInstructionIndex)) {
    if (instructionIndex === this.nextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[this.nextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${this.nextInstructionIndex}`);
  }

  const hash = `:leftFn:${this.nextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [ifOtherSymbol]: {
      command: [
        {
          movement: movements.left,
        },
      ],
      nextState,
    },
  }, instructionIndex);

  states.set(hash, state);

  return state;
}

function rightFn({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let nextState;

  if (this.nextInstructionIndex === defaultNextInstructionIndex) {
    this.nextInstructionIndex = nextInstructionIndex;
  }

  if (this.nextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, this.nextInstructionIndex)) {
    if (instructionIndex === this.nextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[this.nextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${this.nextInstructionIndex}`);
  }

  const hash = `:rightFn:${this.nextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [ifOtherSymbol]: {
      command: [
        {
          movement: movements.right,
        },
      ],
      nextState,
    },
  }, instructionIndex);

  states.set(hash, state);

  return state;
}

function markFn({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let nextState;

  if (this.nextInstructionIndex === defaultNextInstructionIndex) {
    this.nextInstructionIndex = nextInstructionIndex;
  }

  if (this.nextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, this.nextInstructionIndex)) {
    if (instructionIndex === this.nextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[this.nextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${this.nextInstructionIndex}`);
  }

  const hash = `:markFn:${this.nextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [ifOtherSymbol]: {
      command: [
        {
          symbol: markSymbol,
        },
      ],
      nextState,
    },
  }, instructionIndex);

  states.set(hash, state);

  return state;
}

function eraseFn({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let nextState;

  if (this.nextInstructionIndex === defaultNextInstructionIndex) {
    this.nextInstructionIndex = nextInstructionIndex;
  }

  if (this.nextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, this.nextInstructionIndex)) {
    if (instructionIndex === this.nextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[this.nextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${this.nextInstructionIndex}`);
  }

  const hash = `:eraseFn:${this.nextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [ifOtherSymbol]: {
      command: [
        {
          symbol: blankSymbol,
        },
      ],
      nextState,
    },
  }, instructionIndex);

  states.set(hash, state);

  return state;
}

function checkFn({
  instructionIndex, references, states, tapeBlock,
}) {
  const { nextInstructionIndexIfMarked, nextInstructionIndexOtherwise } = this;

  if (!Object.prototype.hasOwnProperty.call(references, nextInstructionIndexIfMarked)) {
    throw new Error(`invalid instruction index: ${nextInstructionIndexIfMarked}`);
  }

  if (!Object.prototype.hasOwnProperty.call(references, nextInstructionIndexOtherwise)) {
    throw new Error(`invalid instruction index: ${nextInstructionIndexOtherwise}`);
  }

  if (nextInstructionIndexIfMarked === nextInstructionIndexOtherwise) {
    throw new Error('next instruction indexes for this command must be unique');
  }

  if (
    instructionIndex === nextInstructionIndexIfMarked
    || instructionIndex === nextInstructionIndexOtherwise
  ) {
    throw new Error(`potential infinite loop at instruction ${instructionIndex}`);
  }

  const hash = `:checkFn:${nextInstructionIndexIfMarked}:${nextInstructionIndexOtherwise}`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [tapeBlock.symbol([tapeBlock.tapeList[0].alphabet.symbolList[1]])]: {
      nextState: references[nextInstructionIndexIfMarked],
    },
    [tapeBlock.symbol([tapeBlock.tapeList[0].alphabet.blankSymbol])]: {
      nextState: references[nextInstructionIndexOtherwise],
    },
  }, instructionIndex);

  states.set(hash, state);

  return state;
}

export function left(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return leftFn.bind({
    nextInstructionIndex,
  });
}

export function right(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return rightFn.bind({
    nextInstructionIndex,
  });
}

export function mark(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return markFn.bind({
    nextInstructionIndex,
  });
}

export function erase(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return eraseFn.bind({
    nextInstructionIndex,
  });
}

export function check(nextInstructionIndexIfMarked, nextInstructionIndexOtherwise) {
  if (typeof nextInstructionIndexIfMarked !== 'number') {
    throw new Error(`invalid instruction index: ${nextInstructionIndexIfMarked}`);
  }

  if (typeof nextInstructionIndexOtherwise !== 'number') {
    throw new Error(`invalid instruction index: ${nextInstructionIndexOtherwise}`);
  }

  return checkFn.bind({
    nextInstructionIndexIfMarked,
    nextInstructionIndexOtherwise,
  });
}

export function stop(nextInstructionIndex) {
  if (nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid \'stop\' command usage');
  }

  return function stopFn() {
    return haltState;
  };
}

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
