import comparison = require('@lp-labs/structured-diff');
const result = comparison.diffStructured([{ id: 'x', value: null }], []);
const change: comparison.StructuredChange | undefined = result.changes[0];
console.log(change?.kind);
