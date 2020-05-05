import {
  haltState, ifOtherSymbol, movements, State,
} from '@turing-machine-js/machine';
import { blankSymbol, defaultNextInstructionIndex, markSymbol } from './consts';

function callCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states, subroutineInitialStates,
}) {
  const { subroutineName } = this;

  if (!Object.prototype.hasOwnProperty.call(subroutineInitialStates, subroutineName)) {
    throw new Error(`undefined '${subroutineName}' subroutine`);
  }

  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, boundNextInstructionIndex)) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[boundNextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:callFn:${boundNextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = subroutineInitialStates[subroutineName].withOverrodeHaltState(new State({
    [ifOtherSymbol]: {
      nextState,
    },
  }));

  states.set(hash, state);

  return state;
}

function checkCommandStateProducer({
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

function eraseCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, boundNextInstructionIndex)) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[boundNextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:eraseFn:${boundNextInstructionIndex}:`;

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

function leftCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, boundNextInstructionIndex)) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[boundNextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:leftFn:${boundNextInstructionIndex}:`;

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

function markCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, boundNextInstructionIndex)) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[boundNextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:markFn:${boundNextInstructionIndex}:`;

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

function noopCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, boundNextInstructionIndex)) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[boundNextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:noopFn:${boundNextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [ifOtherSymbol]: {
      nextState,
    },
  }, instructionIndex);

  states.set(hash, state);

  return state;
}
function rightCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, boundNextInstructionIndex)) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[boundNextInstructionIndex];
  } else {
    throw new Error(`invalid instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:rightFn:${boundNextInstructionIndex}:`;

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

export function call(subroutineName, nextInstructionIndex = defaultNextInstructionIndex) {
  if (typeof subroutineName !== 'string' || !subroutineName.trim()) {
    throw new Error('invalid subroutine name');
  }

  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return callCommandStateProducer.bind({
    subroutineName,
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

  return checkCommandStateProducer.bind({
    nextInstructionIndexIfMarked,
    nextInstructionIndexOtherwise,
  });
}

export function erase(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return eraseCommandStateProducer.bind({
    nextInstructionIndex,
  });
}

export function left(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return leftCommandStateProducer.bind({
    nextInstructionIndex,
  });
}

export function mark(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return markCommandStateProducer.bind({
    nextInstructionIndex,
  });
}

export function noop(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return noopCommandStateProducer.bind({
    nextInstructionIndex,
  });
}

export function right(nextInstructionIndex) {
  if (typeof nextInstructionIndex !== 'number' && nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid instruction index');
  }

  return rightCommandStateProducer.bind({
    nextInstructionIndex,
  });
}

export function stop(nextInstructionIndex) {
  if (nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('invalid \'stop\' command usage');
  }

  return function stopCommandStateProducer() {
    return haltState;
  };
}
