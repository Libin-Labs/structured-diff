export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface IdentifiedRecord {
  readonly id: string;
  readonly value: JsonValue;
}

export type StructuredChange =
  | {
      readonly kind: 'added';
      readonly id: string;
      readonly index: number;
      readonly value: JsonValue;
    }
  | {
      readonly kind: 'removed';
      readonly id: string;
      readonly index: number;
      readonly value: JsonValue;
    }
  | { readonly kind: 'moved'; readonly id: string; readonly from: number; readonly to: number }
  | {
      readonly kind: 'field-added';
      readonly id: string;
      readonly path: string;
      readonly after: JsonValue;
    }
  | {
      readonly kind: 'field-removed';
      readonly id: string;
      readonly path: string;
      readonly before: JsonValue;
    }
  | {
      readonly kind: 'updated';
      readonly id: string;
      readonly path: string;
      readonly before: JsonValue;
      readonly after: JsonValue;
    };

export interface StructuredDiffOptions {
  maxRecords?: number;
  maxNodes?: number;
  maxStringLength?: number;
  maxChanges?: number;
  maxDepth?: number;
}

export interface StructuredDiffResult {
  readonly equal: boolean;
  readonly changes: readonly StructuredChange[];
}

function limit(value: number, name: string, maximum: number, allowZero = false): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function clone(
  value: unknown,
  budget: { left: number },
  maxDepth: number,
  maxStringLength: number,
): JsonValue {
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): JsonValue => {
    if (--budget.left < 0 || depth > maxDepth) throw new RangeError('Snapshot capacity exceeded.');
    if (typeof item === 'string') {
      if (item.length > maxStringLength) throw new RangeError('Snapshot string capacity exceeded.');
      return item;
    }
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') throw new TypeError('Record values must be strict JSON.');
    if (active.has(item)) throw new TypeError('Cyclic values are not supported.');
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (
          Object.getPrototypeOf(item) !== Array.prototype ||
          Reflect.ownKeys(item).length !== item.length + 1
        )
          throw new TypeError('Arrays must be dense and have no extra properties.');
        return Array.from({ length: item.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || !('value' in descriptor))
            throw new TypeError('Array entries must be enumerable data properties.');
          return visit(descriptor.value, depth + 1);
        });
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new TypeError('Values must be plain JSON records.');
      const copy: Record<string, JsonValue> = {};
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== 'string' || key.length > 1024)
          throw new TypeError('Object keys must be strings of at most 1024 characters.');
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor))
          throw new TypeError('Properties must be enumerable data properties.');
        Object.defineProperty(copy, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return copy;
    } finally {
      active.delete(item);
    }
  };
  return visit(value, 0);
}

function pointer(path: readonly string[]): string {
  return path.length === 0
    ? ''
    : `/${path.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

function freezeJson(value: JsonValue): JsonValue {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Diffs ordered records by stable top-level id and reports reorders as moves. */
export function diffStructured(
  before: readonly IdentifiedRecord[],
  after: readonly IdentifiedRecord[],
  options: StructuredDiffOptions = {},
): StructuredDiffResult {
  const maxRecords = limit(options.maxRecords ?? 10_000, 'maxRecords', 100_000);
  const maxNodes = limit(options.maxNodes ?? 100_000, 'maxNodes', 1_000_000);
  const maxStringLength = limit(options.maxStringLength ?? 65_536, 'maxStringLength', 1_000_000);
  const maxChanges = limit(options.maxChanges ?? 10_000, 'maxChanges', 100_000, true);
  const maxDepth = limit(options.maxDepth ?? 64, 'maxDepth', 128, true);
  if (!Array.isArray(before) || !Array.isArray(after))
    throw new TypeError('Expected before and after record arrays.');
  if (before.length > maxRecords || after.length > maxRecords)
    throw new RangeError('Record capacity exceeded.');
  for (const records of [before, after]) {
    if (
      Object.getPrototypeOf(records) !== Array.prototype ||
      Reflect.ownKeys(records).length !== records.length + 1
    )
      throw new TypeError('Record lists must be dense arrays without extra properties.');
  }

  const snapshot = (records: readonly IdentifiedRecord[]) => {
    const entries = new Map<string, { id: string; index: number; value: JsonValue }>();
    const budget = { left: maxNodes };
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (
        !record ||
        typeof record !== 'object' ||
        (Object.getPrototypeOf(record) !== Object.prototype &&
          Object.getPrototypeOf(record) !== null) ||
        Reflect.ownKeys(record).length !== 2 ||
        !Object.hasOwn(record, 'id') ||
        !Object.hasOwn(record, 'value')
      )
        throw new TypeError('Each record must own only id and value data properties.');
      const idDescriptor = Object.getOwnPropertyDescriptor(record, 'id')!;
      const valueDescriptor = Object.getOwnPropertyDescriptor(record, 'value')!;
      if (
        !idDescriptor.enumerable ||
        !('value' in idDescriptor) ||
        !valueDescriptor.enumerable ||
        !('value' in valueDescriptor)
      )
        throw new TypeError('Record id and value must be enumerable data properties.');
      const id: unknown = idDescriptor.value;
      if (typeof id !== 'string' || id.length === 0 || id.length > 256)
        throw new TypeError('Each record needs an id of at most 256 characters.');
      if (entries.has(id)) throw new TypeError(`Duplicate record id: ${id}.`);
      entries.set(id, {
        id,
        index,
        value: freezeJson(clone(valueDescriptor.value, budget, maxDepth, maxStringLength)),
      });
    }
    return entries;
  };
  const left = snapshot(before);
  const right = snapshot(after);
  const changes: StructuredChange[] = [];
  const emit = (change: StructuredChange) => {
    if (changes.length >= maxChanges) throw new RangeError('Change capacity exceeded.');
    changes.push(Object.freeze(change));
  };
  const compare = (id: string, a: JsonValue, b: JsonValue, path: string[]): void => {
    if (a === b) return;
    if (
      a === null ||
      b === null ||
      typeof a !== 'object' ||
      typeof b !== 'object' ||
      Array.isArray(a) !== Array.isArray(b)
    ) {
      emit({ kind: 'updated', id, path: pointer(path), before: a, after: b });
      return;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    for (const key of keys) {
      const next = [...path, key];
      const hasA = Object.hasOwn(a, key);
      const hasB = Object.hasOwn(b, key);
      const get = (value: JsonValue[] | { [key: string]: JsonValue }) =>
        Array.isArray(value) ? value[Number(key)]! : value[key]!;
      if (!hasA) emit({ kind: 'field-added', id, path: pointer(next), after: get(b) });
      else if (!hasB) emit({ kind: 'field-removed', id, path: pointer(next), before: get(a) });
      else compare(id, get(a), get(b), next);
    }
  };
  for (const [id, record] of left) {
    const current = right.get(id);
    if (!current) emit({ kind: 'removed', id, index: record.index, value: record.value });
    else {
      if (record.index !== current.index)
        emit({ kind: 'moved', id, from: record.index, to: current.index });
      compare(id, record.value, current.value, []);
    }
  }
  for (const [id, record] of right) {
    if (!left.has(id)) emit({ kind: 'added', id, index: record.index, value: record.value });
  }
  return Object.freeze({ equal: changes.length === 0, changes: Object.freeze(changes) });
}
