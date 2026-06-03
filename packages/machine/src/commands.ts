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
    : `${instructionPrefix}${String(boundNextInstructionIndex)}`;
  const continuationName = `${callerName}~${targetName}`;

  const state = subroutineInitialStates[subroutineName].withOverriddenHaltState(new State({
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

// WeakMap from `call('foo')`-produced state-producers to the subroutine name
// they reference. Used by the call-graph analyzer (#85 cycle detection — see
// `callGraph.ts`) to read each producer's target without invoking it.
const callTargets = new WeakMap<CommandFn, string>();

/**
 * Returns the subroutine name a `call(...)` producer targets, or `undefined`
 * if the argument isn't a `call()` producer. Used at construction time to
 * statically analyze which subroutines participate in cycles.
 */
export function callTargetOf(producer: CommandFn): string | undefined {
  return callTargets.get(producer);
}

export function call(subroutineName: string, nextInstructionIndex?: number): (context: CommandContext) => State {
  const actualNextInstructionIndex = arguments.length === 1 ? defaultNextInstructionIndex : nextInstructionIndex;

  const actualCommand = callCommandStateProducer.bind({
    subroutineName,
    nextInstructionIndex: actualNextInstructionIndex as number | symbol,
  });

  commandsSet.add(actualCommand as CommandFn);
  callTargets.set(actualCommand as CommandFn, subroutineName);

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

/**
 * Inline `$tag` decorator (#86). Wraps a command (bare constructor like
 * `mark` or already-bound producer like `mark(20)` / `call('foo')`) with
 * one or more tags; tags are applied to the resulting State via the
 * engine's `state.tag(...)` API (engine #186). The wrapped command's
 * runtime behavior is unchanged — `$tag` is a decorator, not a primitive.
 * The `$` prefix flags it as a decorator at the call site.
 *
 * Usage:
 *   - Wrap a bare command:    `$tag('hot', mark)`
 *   - Wrap an indexed command:`$tag('loop-head', check(20, 40))`
 *   - Variadic tags:          `$tag('hot', 'sampled', 'entry', mark)`
 *   - Compose with call:      `$tag('subroutine-entry', call('foo'))`
 *
 * Does NOT compose with groups — `$tag('foo', [mark, right])` throws at
 * construction. Tag each member individually instead:
 *   `10: [$tag('lift', mark), $tag('descend', right)]`.
 */
export function $tag(...args: unknown[]): CommandStateProducer {
  if (args.length < 2) {
    throw new Error('$tag() requires at least one tag and a command');
  }

  const tags = args.slice(0, -1);
  const wrapped = args[args.length - 1];

  for (const t of tags) {
    if (typeof t !== 'string') {
      throw new Error(`$tag() tags must be strings, got ${typeof t}: ${String(t)}`);
    }
  }

  if (Array.isArray(wrapped)) {
    throw new Error(
      '$tag() cannot wrap a group — groups and tags are incompatible. '
      + 'Tag each group member individually instead: `[$tag("lift", mark), $tag("descend", right)]`.',
    );
  }

  if (typeof wrapped !== 'function') {
    throw new Error(
      `$tag() final argument must be a command, got ${typeof wrapped}`,
    );
  }

  const stringTags = tags as string[];
  const wrappedFn = wrapped as CommandStateProducer | CommandConstructor;

  // Dispatch: if `wrappedFn` is a bare command constructor (mark/right/etc.),
  // call it with `defaultNextInstructionIndex` to get the bound producer —
  // same conversion PostMachine does at instruction-build time (see the
  // `case erase: case left: …` switch in PostMachine.#buildInitialState).
  // Producers already in `commandsSet` (mark(20), call('foo'), check(20, 30),
  // $tag(...)) are invoked directly with context. `call`/`check` are excluded
  // — bare references throw at PostMachine's dispatch, so they can't reach
  // here without first being bound by the caller.
  const isBareConstructor = wrappedFn === erase
    || wrappedFn === left
    || wrappedFn === mark
    || wrappedFn === noop
    || wrappedFn === right
    || wrappedFn === stop;

  const taggedProducer: CommandStateProducer = (context) => {
    const producer: CommandStateProducer = isBareConstructor
      ? (wrappedFn as CommandConstructor)(defaultNextInstructionIndex)
      : wrappedFn as CommandStateProducer;

    const state = producer(context);

    state.tag(...stringTags);

    return state;
  };

  commandsSet.add(taggedProducer as CommandFn);

  return taggedProducer;
}
