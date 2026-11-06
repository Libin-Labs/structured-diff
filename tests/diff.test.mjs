import test from 'node:test';
import assert from 'node:assert/strict';
import { diffStructured } from '../dist/esm/index.js';

test('matches by stable identity and reports movement separately from edits', () => {
  const result = diffStructured(
    [
      { id: 'a', value: { title: 'old' } },
      { id: 'b', value: { title: 'same' } },
    ],
    [
      { id: 'b', value: { title: 'same' } },
      { id: 'a', value: { title: 'new' } },
    ],
  );
  assert.deepEqual(result.changes, [
    { kind: 'moved', id: 'a', from: 0, to: 1 },
    { kind: 'updated', id: 'a', path: '/title', before: 'old', after: 'new' },
    { kind: 'moved', id: 'b', from: 1, to: 0 },
  ]);
});

test('reports entity additions and removals with their snapshots', () => {
  const result = diffStructured([{ id: 'gone', value: { n: 1 } }], [{ id: 'new', value: null }]);
  assert.deepEqual(result.changes, [
    { kind: 'removed', id: 'gone', index: 0, value: { n: 1 } },
    { kind: 'added', id: 'new', index: 0, value: null },
  ]);
});

test('reports nested field additions, removals, and replacements', () => {
  const result = diffStructured(
    [{ id: 'x', value: { keep: 1, remove: 2, nested: { a: 1 } } }],
    [{ id: 'x', value: { keep: 1, added: 3, nested: { a: 2 } } }],
  );
  assert.deepEqual(result.changes, [
    { kind: 'field-added', id: 'x', path: '/added', after: 3 },
    { kind: 'updated', id: 'x', path: '/nested/a', before: 1, after: 2 },
    { kind: 'field-removed', id: 'x', path: '/remove', before: 2 },
  ]);
});

test('escapes special characters in field paths', () => {
  const result = diffStructured(
    [{ id: 'x', value: { 'a/b': 1 } }],
    [{ id: 'x', value: { 'a/b': 2 } }],
  );
  assert.equal(result.changes[0].path, '/a~1b');
});

test('compares nested arrays positionally rather than inferring ids', () => {
  const result = diffStructured(
    [{ id: 'x', value: { list: [1, 2] } }],
    [{ id: 'x', value: { list: [2, 1] } }],
  );
  assert.deepEqual(
    result.changes.map((change) => change.kind),
    ['updated', 'updated'],
  );
});

test('returns equal for identical data and immutable results', () => {
  const result = diffStructured([{ id: 'a', value: { x: 1 } }], [{ id: 'a', value: { x: 1 } }]);
  assert.equal(result.equal, true);
  assert.equal(Object.isFrozen(result.changes), true);
  const added = diffStructured([], [{ id: 'a', value: { nested: { x: 1 } } }]);
  assert.equal(Object.isFrozen(added.changes[0].value.nested), true);
  assert.throws(() => {
    added.changes[0].value.nested.x = 2;
  }, TypeError);
});

test('rejects duplicate or invalid identities and non-JSON values', () => {
  assert.throws(
    () =>
      diffStructured(
        [
          { id: 'a', value: null },
          { id: 'a', value: null },
        ],
        [],
      ),
    TypeError,
  );
  assert.throws(() => diffStructured([{ id: '', value: null }], []), TypeError);
  assert.throws(() => diffStructured([{ id: 'x', value: Number.NaN }], []), TypeError);
});

test('rejects cycles and non-plain values', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => diffStructured([{ id: 'x', value: cyclic }], []), TypeError);
  assert.throws(() => diffStructured([{ id: 'x', value: new Date() }], []), TypeError);
});

test('bounds string contents and rejects record accessors without invoking them', () => {
  assert.throws(
    () => diffStructured([{ id: 'a', value: 'too long' }], [], { maxStringLength: 3 }),
    RangeError,
  );
  let invoked = false;
  const record = { id: 'a' };
  Object.defineProperty(record, 'value', {
    enumerable: true,
    get() {
      invoked = true;
      return null;
    },
  });
  assert.throws(() => diffStructured([record], []), TypeError);
  assert.equal(invoked, false);
});

test('enforces record, node, depth, and change bounds', () => {
  assert.throws(
    () => diffStructured([{ id: 'a', value: null }], [], { maxRecords: 0 }),
    RangeError,
  );
  assert.throws(
    () => diffStructured([{ id: 'a', value: { x: 1 } }], [], { maxNodes: 1 }),
    RangeError,
  );
  assert.throws(
    () => diffStructured([{ id: 'a', value: { x: 1 } }], [], { maxDepth: 0 }),
    RangeError,
  );
  assert.throws(
    () => diffStructured([{ id: 'a', value: 1 }], [{ id: 'a', value: 2 }], { maxChanges: 0 }),
    RangeError,
  );
});

test('handles empty record arrays', () => {
  assert.deepEqual(diffStructured([], []), { equal: true, changes: [] });
});
