import { describe, expect, test } from 'vitest';
import {
  PostMachine,
  $tag, check, mark, right, stop,
} from '../index';

// Path-based tag registry + auto-tag policy (post-machine-js #86).
//
// API:
//   pm.tag(path, ...tags)       — add one or more tags to the state at path
//   pm.untag(path, ...tags)     — remove tags (no-op if not present)
//   pm.tagsOf(path)             — frozen snapshot of the state's tags
//   pm.findByTag(tag)           — all paths whose state carries that tag
//
// All four forward to the engine's `state.tag(...) / .untag(...) / .tags`
// API (engine #186). PostMachine does NOT maintain its own tag storage.
//
// Auto-tag policy (applied at construction):
//   - The ENTRY POINT of the top-level program → tagged 'main'  (e.g. path '1')
//   - Each subroutine's entry state             → tagged with the subroutine name (e.g. path 'alg::1' → 'alg')
//
// Only the entry-point state of each program/subroutine gets an auto-tag.
// Other top-level instructions and subroutine body instructions stay clean,
// keeping diagrams uncluttered while still anchoring the structural roles.

describe('pm.tag / pm.untag / pm.tagsOf / pm.findByTag — registry API (#86)', () => {
  test('pm.tag adds a tag to the state at path (string form)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.tag('10', 'hot');
    expect(pm.tagsOf('10')).toContain('hot');
  });

  test('pm.tag adds a tag to the state at path (object form)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.tag({ instructionIndex: 10 }, 'hot');
    expect(pm.tagsOf({ instructionIndex: 10 })).toContain('hot');
  });

  test('pm.tag is variadic — adds multiple tags in one call', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.tag('10', 'hot', 'sampled', 'entry');
    expect(pm.tagsOf('10')).toEqual(expect.arrayContaining(['hot', 'sampled', 'entry']));
  });

  test('pm.untag removes a tag (subsequent tagsOf no longer contains it)', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.tag('10', 'hot');
    pm.untag('10', 'hot');
    expect(pm.tagsOf('10')).not.toContain('hot');
  });

  test('pm.untag is a no-op for tags that were never added', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.untag('10', 'never-added')).not.toThrow();
  });

  test('pm.tagsOf returns a frozen array', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.tag('10', 'hot');
    const tags = pm.tagsOf('10');
    expect(Object.isFrozen(tags)).toBe(true);
  });

  test('pm.findByTag returns all paths carrying that tag', () => {
    const pm = new PostMachine({ 10: mark, 20: mark, 30: stop });
    pm.tag('10', 'hot');
    pm.tag('20', 'hot');
    const paths = pm.findByTag('hot');
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.instructionIndex === 10)).toBe(true);
    expect(paths.some((p) => p.instructionIndex === 20)).toBe(true);
  });

  test('pm.findByTag returns [] for an unknown tag', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(pm.findByTag('never-added')).toEqual([]);
  });

  test('pm.tag throws on an unknown path', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    expect(() => pm.tag('99', 'hot')).toThrow(/does not resolve/);
  });

  test('user tags and inline $tag(...) decorator compose on the same state', () => {
    const pm = new PostMachine({
      10: $tag('inline', mark),
      20: stop,
    });
    pm.tag('10', 'post-hoc');
    expect(pm.tagsOf('10')).toEqual(expect.arrayContaining(['inline', 'post-hoc']));
  });
});

describe('auto-tag policy at construction (#86)', () => {
  test('the top-level entry point is tagged "main"', () => {
    const pm = new PostMachine({ 10: mark, 20: mark, 30: stop });
    expect(pm.tagsOf('10')).toContain('main');
  });

  test('non-entry top-level instructions are NOT auto-tagged', () => {
    const pm = new PostMachine({ 10: mark, 20: mark, 30: stop });
    expect(pm.tagsOf('20')).not.toContain('main');
  });

  test('halt-resolving entry points are NOT auto-tagged', () => {
    // `stop` resolves to the engine's haltState singleton, which is globally
    // shared. Tagging it would leak the tag across all PostMachine instances
    // — so auto-tag skips halt-resolving paths even when they're entries.
    const pm = new PostMachine({ 10: stop });
    expect(pm.tagsOf('10')).not.toContain('main');
  });

  test('subroutine entry state is tagged with the subroutine name', () => {
    const pm = new PostMachine({
      10: check(20, 30),
      20: right(10),
      30: stop,
      rightToBlank: { 1: mark, 2: stop },
    });
    expect(pm.tagsOf('rightToBlank::1')).toContain('rightToBlank');
  });

  test('subroutine body states (non-entry) are NOT auto-tagged with the sub name', () => {
    const pm = new PostMachine({
      10: stop,
      sub: { 1: mark, 2: stop },
    });
    // Entry (instruction 1) carries the tag; subsequent body instructions do not.
    expect(pm.tagsOf('sub::1')).toContain('sub');
    expect(pm.tagsOf('sub::2')).not.toContain('sub');
  });

  test('subroutine entry is NOT tagged "main" (it belongs to the subroutine, not the top-level program)', () => {
    const pm = new PostMachine({
      10: stop,
      sub: { 1: mark, 2: stop },
    });
    expect(pm.tagsOf('sub::1')).not.toContain('main');
  });

  test('findByTag("main") returns just the top-level entry-point path', () => {
    const pm = new PostMachine({
      10: mark,
      20: mark,
      30: stop,
      sub: { 1: mark, 2: stop },
    });
    const paths = pm.findByTag('main');
    expect(paths).toHaveLength(1);
    expect(paths[0].instructionIndex).toBe(10);
  });

  test('user pm.tag composes with auto-tags — both coexist on the entry state', () => {
    const pm = new PostMachine({ 10: mark, 20: stop });
    pm.tag('10', 'hot');
    expect(pm.tagsOf('10')).toEqual(expect.arrayContaining(['main', 'hot']));
  });
});
