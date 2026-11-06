# @lp-labs/structured-diff

Bounded comparison of ordered, identity-bearing records. Stable top-level ids are matched before
their JSON values are compared, so record reordering is reported explicitly as a move instead of
being confused with a positional replacement.

```js
import { diffStructured } from '@lp-labs/structured-diff';

const result = diffStructured(
  [
    { id: 'a', value: { title: 'Draft' } },
    { id: 'b', value: { title: 'Final' } },
  ],
  [
    { id: 'b', value: { title: 'Final' } },
    { id: 'a', value: { title: 'Approved' } },
  ],
);
console.log(result.changes);
// move b from 1 to 0; update a at /title
```

## API

- `diffStructured(before, after, options?)` accepts ordered arrays of `{ id, value }` records and
  returns immutable `equal` and `changes` fields.
- `IdentifiedRecord`, `JsonValue`, `StructuredChange`, `StructuredDiffOptions`, and
  `StructuredDiffResult` describe the contract.
- `StructuredChange` distinguishes top-level `added`, `removed`, and `moved` records; nested
  `field-added`, `field-removed`, and `updated` values use escaped JSON Pointer paths.
- Matched records are compared by id; field order is deterministic. Nested arrays are compared
  positionally and are not inferred to contain identities. Moves describe index changes, not edit
  intent or a minimal sequence of reorder operations.

## Customize

```js
import { diffStructured } from '@lp-labs/structured-diff';

const result = diffStructured(
  [{ id: 'user:1', value: { name: 'A', flags: ['old'] } }],
  [
    { id: 'user:1', value: { name: 'B', flags: ['new'] } },
    { id: 'user:2', value: null },
  ],
  { maxRecords: 500, maxNodes: 25_000, maxChanges: 200, maxDepth: 32 },
);
console.log(result.changes);
```

## Errors and limits

Inputs must be arrays of records with unique nonempty ids and strict finite JSON values (plain
records, dense arrays, no accessors, symbols, cycles, or non-finite numbers). Invalid inputs throw
`TypeError`; record, snapshot, depth, or change capacity violations throw `RangeError`. The
operation fails as a whole rather than returning a truncated diff.

Defaults: 10,000 records, 100,000 nodes per snapshot, 65,536 characters per string, 10,000 changes,
and depth 64. Maximum configurable bounds are 100,000 records, 1,000,000 nodes, 1,000,000
characters per string, 100,000 changes, and depth 128.

This package is not a generic object-patch engine and does not apply changes. Unlike a positional
state differ, it requires explicit stable identity for the ordered top-level collection and
reports collection movement as its own change kind.

## Package

- ESM, CommonJS, and TypeScript declarations are provided through conditional exports.
- Runtime and peer dependencies: none.
- TypeScript and Prettier are development-only dependencies.

MIT licensed: [MIT](./LICENSE)

Author: [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/)

[Support this work](https://www.paypal.me/LibinPrasanth)

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
