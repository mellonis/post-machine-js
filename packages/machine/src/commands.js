import {
  haltState, ifOtherSymbol, movements, State,
} from '@turing-machine-js/machine';
import {
  blankSymbol, commandsSet, defaultNextInstructionIndex, markSymbol,
} from './consts';
import { instructionIndexValidator, subroutineNameValidator } from './validators';

function callCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states, subroutineInitialStates,
}) {
  const { subroutineName } = this;

  if (!subroutineNameValidator(subroutineName)) {
    throw new Error(`invalid subroutine name: '${subroutineName}'`);
  }

  if (!Object.prototype.hasOwnProperty.call(subroutineInitialStates, subroutineName)) {
    throw new Error(`undefined '${subroutineName}' subroutine`);
  }

  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex)
  ) {
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

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
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:callFn:${subroutineName}:${boundNextInstructionIndex}:`;

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
    throw new Error(`invalid next instruction index: ${nextInstructionIndexIfMarked}`);
  }

  if (!Object.prototype.hasOwnProperty.call(references, nextInstructionIndexOtherwise)) {
    throw new Error(`invalid next instruction index: ${nextInstructionIndexOtherwise}`);
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

  const hash = `:checkFn:${nextInstructionIndexIfMarked}:${nextInstructionIndexOtherwise}:`;

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
  });

  states.set(hash, state);

  return state;
}

function eraseCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex)
  ) {
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

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
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
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
  });

  states.set(hash, state);

  return state;
}

function leftCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex)
  ) {
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

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
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
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
  });

  states.set(hash, state);

  return state;
}

function markCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex)
  ) {
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

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
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
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
  });

  states.set(hash, state);

  return state;
}

function noopCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex)
  ) {
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

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
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

  const hash = `:noopFn:${boundNextInstructionIndex}:`;

  if (states.has(hash)) {
    return states.get(hash);
  }

  const state = new State({
    [ifOtherSymbol]: {
      nextState,
    },
  });

  states.set(hash, state);

  return state;
}

function rightCommandStateProducer({
  instructionIndex, nextInstructionIndex, references, states,
}) {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;
  let nextState;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex)
  ) {
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
  }

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
    throw new Error(`invalid next instruction index: ${boundNextInstructionIndex}`);
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
  });

  states.set(hash, state);

  return state;
}

export function call(subroutineName, nextInstructionIndex) {
  if (arguments.length === 1) {
    // eslint-disable-next-line no-param-reassign
    nextInstructionIndex = defaultNextInstructionIndex;
  }

  const actualCommand = callCommandStateProducer.bind({
    subroutineName,
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(call);

export function check(nextInstructionIndexIfMarked, nextInstructionIndexOtherwise) {
  const actualCommand = checkCommandStateProducer.bind({
    nextInstructionIndexIfMarked,
    nextInstructionIndexOtherwise,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(check);

export function erase(nextInstructionIndex) {
  if (arguments.length === 0) {
    throw new Error('invalid next instruction index: undefined');
  }

  const actualCommand = eraseCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(erase);

export function left(nextInstructionIndex) {
  if (arguments.length === 0) {
    throw new Error('invalid next instruction index: undefined');
  }

  const actualCommand = leftCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(left);

export function mark(nextInstructionIndex) {
  if (arguments.length === 0) {
    throw new Error('invalid next instruction index: undefined');
  }

  const actualCommand = markCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(mark);

export function noop(nextInstructionIndex) {
  if (arguments.length === 0) {
    throw new Error('invalid next instruction index: undefined');
  }

  const actualCommand = noopCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(noop);

export function right(nextInstructionIndex) {
  if (arguments.length === 0) {
    throw new Error('invalid next instruction index: undefined');
  }

  const actualCommand = rightCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(right);

export function stop(nextInstructionIndex) {
  if (nextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate \'stop\' command usage');
  }

  const actualCommand = function stopCommandStateProducer() {
    return haltState;
  };

  commandsSet.add(actualCommand);

  return actualCommand;
}

commandsSet.add(stop);
