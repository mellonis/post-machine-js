import {
  haltState, ifOtherSymbol, movements, Reference, State, TapeBlock,
} from '@turing-machine-js/machine';

type StateOrRef = State | Reference;
import {
  commandsSet, type CommandFn, defaultNextInstructionIndex,
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
  blankSymbol: string;
  markSymbol: string;
  instructionPrefix: string;
};

// A bound state-producer — what each command function returns when called.
// Takes the per-build context, returns the State node to insert into the graph.
export type CommandStateProducer = (context: CommandContext) => State;

// A bare command function — `mark`, `erase`, `right`, etc. as exported.
// Calling with no arg (or with the internal sentinel) advances to the next
// numbered instruction; calling with an explicit index jumps there.
export type CommandConstructor = (nextInstructionIndex?: number | symbol) => CommandStateProducer;

// The recursive type for what users pass to `new PostMachine(...)`.
// Number-keyed values are commands or groups of commands; string-keyed values
// are subroutines (themselves Instructions). The runtime validators decide
// which key categories are valid where — TypeScript's index signature can't.
export type Instructions = {
  [key: string | number]:
    | CommandStateProducer
    | CommandConstructor
    | Array<CommandStateProducer | CommandConstructor>
    | Instructions;
};

function callCommandStateProducer(this: { subroutineName: string; nextInstructionIndex: number | symbol }, {
  instructionIndex,
  nextInstructionIndex,
  references,
  states,
  subroutineInitialStates,
  calledFromGroup,
  instructionPrefix,
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

  const callerName = `${instructionPrefix}${instructionIndex}`;
  const targetName = nextState === haltState
    ? 'halt'
    : `${instructionPrefix}${boundNextInstructionIndex}`;
  const continuationName = `${callerName}~${targetName}`;

  const state = subroutineInitialStates[subroutineName].withOverrodeHaltState(new State({
    [ifOtherSymbol]: {
      nextState,
    },
  }, continuationName));

  states.set(hash, state);

  return state;
}

function checkCommandStateProducer(this: {
  nextInstructionIndexIfMarked: number;
  nextInstructionIndexOtherwise: number;
}, {
  instructionIndex, references, states, tapeBlock, calledFromGroup, blankSymbol, markSymbol, instructionPrefix,
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
    [tapeBlock.symbol([markSymbol])]: {
      nextState: references[String(nextInstructionIndexIfMarked)],
    },
    [tapeBlock.symbol([blankSymbol])]: {
      nextState: references[String(nextInstructionIndexOtherwise)],
    },
  }, `${instructionPrefix}${instructionIndex}`);

  states.set(hash, state);

  return state;
}

type UnaryCommand = { symbol?: string; movement?: symbol };

// Factory for the five "unary" commands (erase, left, mark, noop, right) that
// share an identical state-producer skeleton. They differ only in:
//   - `hashPrefix`: a unique cache-key tag per command kind
//   - `buildCommand`: a function that, given the build-time context, returns
//     the per-tape TapeCommand to issue (or `null` for noop). Resolving the
//     command at producer-call time (not factory-call time) lets `mark`/`erase`
//     read per-instance `blankSymbol`/`markSymbol` from the context.
function makeUnaryCommandProducer(
  hashPrefix: string,
  buildCommand: ((ctx: CommandContext) => UnaryCommand) | null,
): (this: { nextInstructionIndex?: number | symbol }, ctx: CommandContext) => State {
  return function unaryCommandStateProducer(this: { nextInstructionIndex?: number | symbol }, ctx: CommandContext): State {
    const {
      instructionIndex, nextInstructionIndex, references, states, calledFromGroup, instructionPrefix,
    } = ctx;
    let { nextInstructionIndex: boundNextInstructionIndex } = this;

    if (calledFromGroup && boundNextInstructionIndex !== defaultNextInstructionIndex) {
      throw new Error('inappropriate command usage in a group');
    }

    if (
      boundNextInstructionIndex !== defaultNextInstructionIndex
      && !instructionIndexValidator(boundNextInstructionIndex as number)
    ) {
      throw new Error(`invalid next instruction index: ${String(boundNextInstructionIndex)}`);
    }

    if (boundNextInstructionIndex === defaultNextInstructionIndex) {
      boundNextInstructionIndex = nextInstructionIndex as number | symbol;
    }

    let nextState: StateOrRef;

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

    const hash = `${hashPrefix}${String(boundNextInstructionIndex)}:`;

    if (states.has(hash)) {
      return states.get(hash)!;
    }

    const transition = buildCommand === null ? { nextState } : { command: [buildCommand(ctx)], nextState };
    const state = new State({ [ifOtherSymbol]: transition }, `${instructionPrefix}${instructionIndex}`);

    states.set(hash, state);

    return state;
  };
}

const eraseCommandStateProducer = makeUnaryCommandProducer(':eraseFn:', (ctx) => ({ symbol: ctx.blankSymbol }));
const leftCommandStateProducer = makeUnaryCommandProducer(':leftFn:', () => ({ movement: movements.left }));
const markCommandStateProducer = makeUnaryCommandProducer(':markFn:', (ctx) => ({ symbol: ctx.markSymbol }));
const noopCommandStateProducer = makeUnaryCommandProducer(':noopFn:', null);
const rightCommandStateProducer = makeUnaryCommandProducer(':rightFn:', () => ({ movement: movements.right }));

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

export function check(
  nextInstructionIndexIfMarked: number,
  nextInstructionIndexOtherwise: number,
): CommandStateProducer {
  const actualCommand = checkCommandStateProducer.bind({
    nextInstructionIndexIfMarked,
    nextInstructionIndexOtherwise,
  });

  commandsSet.add(actualCommand as CommandFn);

  return actualCommand;
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
