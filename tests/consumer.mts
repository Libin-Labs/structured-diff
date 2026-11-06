import { diffStructured, type StructuredChange } from '@lp-labs/structured-diff';
const result = diffStructured([{ id: 'x', value: 1 }], [{ id: 'x', value: 2 }]);
const change: StructuredChange | undefined = result.changes[0];
console.log(result.equal, change?.kind);
