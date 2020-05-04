import {
  haltState, ifOtherSymbol, movements, State,
} from '@turing-machine-js/machine';
import { blankSymbol, defaultNextInstructionIndex, markSymbol } from './consts';

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
