import {
  haltState, ifOtherSymbol, movements, Reference, State, TapeBlock,
} from '@turing-machine-js/machine';

type StateOrRef = State | Reference;
import {
  blankSymbol, commandsSet, type CommandFn, defaultNextInstructionIndex, markSymbol,
} from './consts';
import { instructionIndexValidator, subroutineNameValidator } from './validators';

export type CommandContext = {
  instructionIndex: number;
  nextInstructionIndex: number | undefined;
  references: Record<string, Reference>;
  states: Map<string, State>;
  tapeBlock: TapeBlock;
  subroutineInitialStates: Record<string, State>;
  calledFromGroup: boolean;
};

function callCommandStateProducer(this: { subroutineName: string; nextInstructionIndex: number | symbol }, {
  instructionIndex,
  nextInstructionIndex,
  references,
  states,
  subroutineInitialStates,
  calledFromGroup,
}: CommandContext): State {
  const { subroutineName } = this;

  if (!subroutineNameValidator(subroutineName)) {
    throw new Error(`invalid subroutine name: '${subroutineName}'`);
  }

  if (!Object.prototype.hasOwnProperty.call(subroutineInitialStates, subroutineName)) {
    throw new Error(`undefined '${subroutineName}' subroutine`);
  }

  let { nextInstructionIndex: boundNextInstructionIndex } = this;

  if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate command usage in a group');
  }

  let nextState: StateOrRef;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex as number)
  ) {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex as number | symbol;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, String(boundNextInstructionIndex))) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[String(boundNextInstructionIndex)];
  } else {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  const hash = `:callFn:${subroutineName}:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
  }

  const state = subroutineInitialStates[subroutineName].withOverrodeHaltState(new State({
    [ifOtherSymbol]: {
      nextState,
    },
  }));

  states.set(hash, state);

  return state;
}

function checkCommandStateProducer(this: {
  nextInstructionIndexIfMarked: number;
  nextInstructionIndexOtherwise: number;
}, {
  instructionIndex, references, states, tapeBlock, calledFromGroup,
}: CommandContext): State {
  if (calledFromGroup) {
    throw new Error('the \'check\' command cannot be used in a group');
  }

  const { nextInstructionIndexIfMarked, nextInstructionIndexOtherwise } = this;

  if (!Object.prototype.hasOwnProperty.call(references, String(nextInstructionIndexIfMarked))) {
    throw new Error(`invalid next instruction index: ${nextInstructionIndexIfMarked}`);
  }

  if (!Object.prototype.hasOwnProperty.call(references, String(nextInstructionIndexOtherwise))) {
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
    return states.get(hash)!;
  }

  const state = new State({
    [tapeBlock.symbol([tapeBlock.tapes[0].alphabet.symbols[1]])]: {
      nextState: references[String(nextInstructionIndexIfMarked)],
    },
    [tapeBlock.symbol([tapeBlock.tapes[0].alphabet.blankSymbol])]: {
      nextState: references[String(nextInstructionIndexOtherwise)],
    },
  });

  states.set(hash, state);

  return state;
}

function eraseCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, {
  instructionIndex, nextInstructionIndex, references, states, calledFromGroup,
}: CommandContext): State {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;

  if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate command usage in a group');
  }

  let nextState: StateOrRef;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex as number)
  ) {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex as number | symbol;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, String(boundNextInstructionIndex))) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[String(boundNextInstructionIndex)];
  } else {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  const hash = `:eraseFn:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
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

function leftCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, {
  instructionIndex, nextInstructionIndex, references, states, calledFromGroup,
}: CommandContext): State {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;

  if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate command usage in a group');
  }

  let nextState: StateOrRef;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex as number)
  ) {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex as number | symbol;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, String(boundNextInstructionIndex))) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[String(boundNextInstructionIndex)];
  } else {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  const hash = `:leftFn:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
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

function markCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, {
  instructionIndex, nextInstructionIndex, references, states, calledFromGroup,
}: CommandContext): State {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;

  if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate command usage in a group');
  }

  let nextState: StateOrRef;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex as number)
  ) {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex as number | symbol;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, String(boundNextInstructionIndex))) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[String(boundNextInstructionIndex)];
  } else {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  const hash = `:markFn:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
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

function noopCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, {
  instructionIndex, nextInstructionIndex, references, states, calledFromGroup,
}: CommandContext): State {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;

  if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate command usage in a group');
  }

  let nextState: StateOrRef;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex as number)
  ) {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex as number | symbol;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, String(boundNextInstructionIndex))) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[String(boundNextInstructionIndex)];
  } else {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  const hash = `:noopFn:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
  }

  const state = new State({
    [ifOtherSymbol]: {
      nextState,
    },
  });

  states.set(hash, state);

  return state;
}

function rightCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, {
  instructionIndex, nextInstructionIndex, references, states, calledFromGroup,
}: CommandContext): State {
  let { nextInstructionIndex: boundNextInstructionIndex } = this;

  if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
    throw new Error('inappropriate command usage in a group');
  }

  let nextState: StateOrRef;

  if (
    boundNextInstructionIndex !== defaultNextInstructionIndex
    && !instructionIndexValidator(boundNextInstructionIndex as number)
  ) {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  if (boundNextInstructionIndex === defaultNextInstructionIndex) {
    boundNextInstructionIndex = nextInstructionIndex as number | symbol;
  }

  if (boundNextInstructionIndex == null) {
    nextState = haltState;
  } else if (Object.prototype.hasOwnProperty.call(references, String(boundNextInstructionIndex))) {
    if (instructionIndex === boundNextInstructionIndex) {
      throw new Error(`infinite loop at instruction ${instructionIndex}`);
    }

    nextState = references[String(boundNextInstructionIndex)];
  } else {
    throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
  }

  const hash = `:rightFn:${String(boundNextInstructionIndex)}:`;

  if (states.has(hash)) {
    return states.get(hash)!;
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

function stopCommandStateProducer(this: null, { calledFromGroup }: CommandContext): State {
  if (calledFromGroup) {
    throw new Error('the \'stop\' command cannot be used in a group');
  }

  return haltState;
}

export function call(subroutineName: string, nextInstructionIndex?: number): (context: CommandContext) => State {
  const actualNextInstructionIndex = arguments.length === 1 ? defaultNextInstructionIndex : nextInstructionIndex;

  const actualCommand = callCommandStateProducer.bind({
    subroutineName,
    nextInstructionIndex: actualNextInstructionIndex as number | symbol,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand as (context: CommandContext) => State;
}

export type CommandWithDeps = ((context: CommandContext) => State) & { dependencies?: number[] };

export function check(
  nextInstructionIndexIfMarked: number,
  nextInstructionIndexOtherwise: number,
): CommandWithDeps {
  const actualCommand = checkCommandStateProducer.bind({
    nextInstructionIndexIfMarked,
    nextInstructionIndexOtherwise,
  });

  commandsSet.add(actualCommand as CommandFn);

  const withDeps = actualCommand as CommandWithDeps;
  withDeps.dependencies = [nextInstructionIndexIfMarked, nextInstructionIndexOtherwise];
  return withDeps;
}

export function erase(nextInstructionIndex?: number | symbol): (context: CommandContext) => State {
  const actualCommand = eraseCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
}

export function left(nextInstructionIndex?: number | symbol): (context: CommandContext) => State {
  const actualCommand = leftCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
}

export function mark(nextInstructionIndex?: number | symbol): (context: CommandContext) => State {
  const actualCommand = markCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
}

export function noop(nextInstructionIndex?: number | symbol): (context: CommandContext) => State {
  const actualCommand = noopCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
}

export function right(nextInstructionIndex?: number | symbol): (context: CommandContext) => State {
  const actualCommand = rightCommandStateProducer.bind({
    nextInstructionIndex,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
}

export function stop(nextInstructionIndex?: number | symbol): (context: CommandContext) => State {
  if (arguments.length === 0 || (arguments.length >= 1 && nextInstructionIndex !== defaultNextInstructionIndex)) {
    throw new Error('inappropriate \'stop\' command usage');
  }

  const actualCommand = stopCommandStateProducer.bind(null);

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
}

commandsSet.add(call as CommandFn);
commandsSet.add(check as CommandFn);
commandsSet.add(erase as CommandFn);
commandsSet.add(left as CommandFn);
commandsSet.add(mark as CommandFn);
commandsSet.add(noop as CommandFn);
commandsSet.add(right as CommandFn);
commandsSet.add(stop as CommandFn);
