import {describe, expect, test} from 'vitest';

import {PostMachine, $tag, mark, noop, right, stop} from './index';
import {State, toMermaid} from '@turing-machine-js/machine';

// Tests for the `$tag('label', command)` inline decorator (#86).
//
// The `$tag` decorator wraps a command producer (or bare constructor) with
// one or more tags. Tags get applied to the resulting State via the engine's
// `state.tag(...)` API (engine #186). Composes with indexed commands
// (`$tag('hot', check(20, 30))`), rejects groups (`$tag('foo', [mark, right])`
// throws — tag the inner commands individually instead). The `$` prefix
// flags it as a decorator (not a primitive command) at the call site.

describe('$tag — inline tag decorator (#86)', () => {
  test('tags a bare command (constructor form)', () => {
    const machine = new PostMachine({
      10: $tag('hot', mark),
      20: stop,
    });

    const state = machine.stateAt({instructionIndex: 10});

    expect(state).toBeDefined();
    expect(state!.tags).toContain('hot');
  });

  test('tags a command-with-explicit-jump (producer form)', () => {
    const machine = new PostMachine({
      10: $tag('hot', mark(30)),
      20: noop,
      30: stop,
    });

    const state = machine.stateAt({instructionIndex: 10});

    expect(state).toBeDefined();
    expect(state!.tags).toContain('hot');
  });

  test('variadic — multiple tags before the command', () => {
    const machine = new PostMachine({
      10: $tag('hot', 'sampled', 'entry', mark),
      20: stop,
    });

    const state = machine.stateAt({instructionIndex: 10});

    expect(state!.tags).toEqual(expect.arrayContaining(['hot', 'sampled', 'entry']));
  });

  test('rejects groups — `$tag(\'label\', [mark, right])` throws at construction', () => {
    expect(() => new PostMachine({
      10: $tag('hot', [mark, right] as never),
      20: stop,
    })).toThrow(/group/i);
  });

  test('per-member `$tag` inside a group works — tags apply to each inner state', () => {
    // The recommended workaround for "tag inside a group" — wrap each
    // member individually instead of wrapping the group as a whole.
    const machine = new PostMachine({
      10: [$tag('lift', mark), $tag('descend', right)],
      20: stop,
    });

    // Inner group instructions carry their per-member tags.
    expect(machine.tagsOf({ instructionIndex: 10, groupInstructionIndex: 1 }))
      .toEqual(['lift']);
    expect(machine.tagsOf({ instructionIndex: 10, groupInstructionIndex: 2 }))
      .toEqual(['descend']);

    // The outer group wrapper at path '10' is the top-level entry — it
    // carries only the auto-tag 'main', not the inner-member tags.
    expect(machine.tagsOf('10')).toEqual(['main']);

    // findByTag returns the group-inner path for each member tag.
    expect(machine.findByTag('lift')).toEqual([
      { instructionIndex: 10, groupInstructionIndex: 1 },
    ]);
    expect(machine.findByTag('descend')).toEqual([
      { instructionIndex: 10, groupInstructionIndex: 2 },
    ]);
  });

  test('rejects calls with no tags', () => {
    expect(() => new PostMachine({
      10: ($tag as unknown as (...args: unknown[]) => unknown)(mark) as never,
      20: stop,
    })).toThrow(/at least one tag/i);
  });

  test('rejects non-string tags', () => {
    expect(() => new PostMachine({
      10: ($tag as unknown as (...args: unknown[]) => unknown)(42, mark) as never,
      20: stop,
    })).toThrow(/string/i);
  });

  test('rejects non-function final argument', () => {
    // Final arg must be a command (function) or a group (array — handled by
    // the group-rejection branch above). Anything else falls through to
    // the "must be a command" throw.
    expect(() => new PostMachine({
      10: ($tag as unknown as (...args: unknown[]) => unknown)('hot', 42) as never,
      20: stop,
    })).toThrow(/must be a command/);
  });

  test('rejects bare `$tag` at top level — must be invoked', () => {
    expect(() => new PostMachine({
      10: $tag as never,
      20: stop,
    })).toThrow(/\$tag/);
  });

  test('rejects bare `$tag` inside a group — must be invoked', () => {
    expect(() => new PostMachine({
      10: [$tag as never],
      20: stop,
    })).toThrow(/\$tag/);
  });

  test('tags appear in toMermaid output (engine #186 emit)', () => {
    const machine = new PostMachine({
      10: $tag('hot', mark),
      20: stop,
    });

    const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));

    // Engine #186 emits tags inline in node labels via `<br>` and as
    // classDef/class lines for color grouping. Both should appear.
    expect(mermaid).toContain('<br>');
    expect(mermaid).toContain('hot');
    expect(mermaid).toMatch(/classDef tag_hot /);
    expect(mermaid).toMatch(/class s\d+ tag_hot/);
  });

  test('round-trip: machine reaches the tagged state and runs to completion', async () => {
    const machine = new PostMachine({
      10: $tag('hot', mark),
      20: stop,
    });

    // The tag doesn't affect runtime — the machine still halts normally.
    await machine.run();

    expect(machine.tape.symbols[0]).toBe('*');
  });
});
