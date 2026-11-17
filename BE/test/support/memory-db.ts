/**
 * In-memory MongoDB for parity specs, installed UNDER Mongoose: the driver-level collection
 * methods Mongoose calls (find, findOne, findOneAndUpdate, insertOne, updateOne, …) are replaced,
 * so Mongoose casting, defaults, hooks, `sort`/`select`/`populate`/`lean` and hydration all run
 * for real. Query matching, update operators and aggregation use `mingo`.
 *
 * Both legacy and new code share the same Mongoose models in one process, so one memory DB serves
 * both sides of a parity test. Use `snapshot()`/`restore()` to give each side the same start state.
 */
import mongoose from 'mongoose';
import 'mingo/init/system'; // all query/projection/pipeline/expression operators
import { Aggregator, Query } from 'mingo';
import { updateObject } from 'mingo/updater';

type Doc = Record<string, any>;
const OID = 'oid:';

/** ObjectId → "oid:<hex>" so mingo can compare/sort them; reversed on the way out. */
const encode = (v: any): any => {
  if (v instanceof mongoose.Types.ObjectId) return OID + v.toHexString();
  if (v instanceof Date || v instanceof RegExp || Buffer.isBuffer(v) || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(encode);
  if (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID') return OID + v.toHexString();
  if (v._bsontype === 'Decimal128') return Number(v.toString());
  const out: Doc = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encode(x);
  return out;
};
const decode = (v: any): any => {
  if (typeof v === 'string' && v.startsWith(OID) && v.length === OID.length + 24) return new mongoose.Types.ObjectId(v.slice(OID.length));
  if (v instanceof Date || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  const out: Doc = {};
  for (const [k, x] of Object.entries(v)) out[k] = decode(x);
  return out;
};
const clone = (d: Doc) => decode(encode(d));

const applyUpdate = (doc: Doc, update: Doc, isInsert: boolean) => {
  if (Array.isArray(update)) throw new Error('memory-db: pipeline updates not supported');
  const ops = Object.keys(update);
  if (!ops.some((k) => k.startsWith('$'))) {
    // replacement document
    const id = doc._id;
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, update, { _id: id });
    return;
  }
  for (const op of ops) {
    if (op === '$setOnInsert') {
      if (isInsert) updateObject(doc, { $set: update[op] });
      continue;
    }
    updateObject(doc, { [op]: update[op] } as any);
  }
};

/**
 * Rewrites stages where mingo differs from MongoDB:
 * `$count` on zero input gives `{n: 0}` in mingo but no document in MongoDB → use the documented
 * equivalent `$group {_id:null, n:{$sum:1}}` + `$project {_id:0}`. Recurses into `$facet`.
 */
const mongoCompatPipeline = (pipeline: Doc[]): Doc[] =>
  pipeline.flatMap((stage) => {
    if (stage.$count) return [{ $group: { _id: null, [stage.$count]: { $sum: 1 } } }, { $project: { _id: 0 } }];
    if (stage.$facet) return [{ $facet: Object.fromEntries(Object.entries(stage.$facet).map(([k, v]) => [k, mongoCompatPipeline(v as Doc[])])) }];
    return [stage];
  });

const lookupSource = (name: string) => memoryDb.collections.get(name)?.rows ?? [];

/**
 * Runs an (encoded) pipeline. Standard stages go to mingo in chunks; these are handled here
 * because mingo 6 lacks them: `$lookup` with `let`/`pipeline` (incl. the combined
 * localField/foreignField + pipeline form) and `$facet` (so its sub-pipelines can use them).
 * `vars` are the enclosing `$$` variables (from an outer `$lookup.let`).
 */
const runPipeline = (input: Doc[], pipeline: Doc[], vars: Doc): Doc[] => {
  let current = input;
  let chunk: Doc[] = [];
  const flush = () => {
    if (chunk.length) current = new Aggregator(chunk, { collectionResolver: lookupSource, variables: vars } as any).run(current) as Doc[];
    chunk = [];
  };
  for (const stage of pipeline) {
    if (stage.$lookup && stage.$lookup.pipeline) {
      flush();
      const { from, let: letSpec = {}, pipeline: sub, localField, foreignField, as } = stage.$lookup;
      const foreign = lookupSource(from);
      current = current.map((doc) => {
        // `let` values are expressions evaluated against the outer document
        const letVars = Object.keys(letSpec).length
          ? (new Aggregator([{ $replaceRoot: { newRoot: letSpec } }], { variables: vars } as any).run([doc])[0] as Doc)
          : {};
        let candidates = foreign;
        if (localField && foreignField) {
          const local = localField.split('.').reduce((o: any, k: string) => o?.[k], doc);
          const keys = new Set((Array.isArray(local) ? local : [local]).map((x) => JSON.stringify(x ?? null)));
          candidates = foreign.filter((f) => {
            const fv = foreignField.split('.').reduce((o: any, k: string) => o?.[k], f);
            return (Array.isArray(fv) ? fv : [fv]).some((x) => keys.has(JSON.stringify(x ?? null)));
          });
        }
        return { ...doc, [as]: runPipeline(candidates, sub, { ...vars, ...letVars }) };
      });
      continue;
    }
    if (stage.$facet) {
      flush();
      const base = current;
      current = [Object.fromEntries(Object.entries(stage.$facet).map(([k, sub]) => [k, runPipeline(base, sub as Doc[], vars)]))];
      continue;
    }
    chunk.push(stage);
  }
  flush();
  return current;
};

const cursor = (rows: Doc[]) => ({
  toArray: async () => rows.map(decode),
  explain: async () => ({}),
  close: async () => undefined,
  [Symbol.asyncIterator]: async function* () { for (const r of rows) yield decode(r); },
});

/** Ids generated for upserts/inserts without _id follow mongoose: new ObjectId. */
export class MemoryCollection {
  rows: Doc[] = [];
  constructor(public readonly name: string) {}

  private select(filter: Doc = {}, options: Doc = {}) {
    let c = new Query(encode(filter)).find(this.rows, options.projection ? encode(options.projection) : undefined);
    if (options.sort) c = c.sort(Array.isArray(options.sort) ? Object.fromEntries(options.sort) : options.sort);
    if (options.skip) c = c.skip(options.skip);
    if (options.limit) c = c.limit(options.limit);
    return c.all() as Doc[];
  }
  private matchRefs(filter: Doc = {}) {
    const q = new Query(encode(filter));
    return this.rows.filter((r) => q.test(r));
  }
  private upsertBase(filter: Doc) {
    const base: Doc = {};
    for (const [k, v] of Object.entries(encode(filter))) if (!k.startsWith('$') && (v === null || typeof v !== 'object' || !Object.keys(v).some((x) => x.startsWith('$')))) base[k] = v;
    if (!base._id) base._id = OID + new mongoose.Types.ObjectId().toHexString();
    return base;
  }

  async find(filter: Doc, options: Doc = {}) { return cursor(this.select(filter, options)); }
  async findOne(filter: Doc, options: Doc = {}) { const [r] = this.select(filter, { ...options, limit: 1 }); return r ? decode(r) : null; }
  async countDocuments(filter: Doc) { return this.matchRefs(filter).length; }
  async estimatedDocumentCount() { return this.rows.length; }
  async distinct(field: string, filter: Doc) {
    const vals = new Map<string, any>();
    for (const r of this.matchRefs(filter)) { const v = field.split('.').reduce((o, k) => o?.[k], r); for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined) vals.set(JSON.stringify(x), x); }
    return [...vals.values()].map(decode);
  }
  async insertOne(doc: Doc) {
    const d = encode(doc);
    if (!d._id) d._id = OID + new mongoose.Types.ObjectId().toHexString();
    if (this.rows.some((r) => r._id === d._id)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    this.rows.push(d);
    return { acknowledged: true, insertedId: decode(d._id) };
  }
  async insertMany(docs: Doc[]) {
    const ids: Record<number, any> = {};
    for (const [i, d] of docs.entries()) ids[i] = (await this.insertOne(d)).insertedId;
    return { acknowledged: true, insertedCount: docs.length, insertedIds: ids };
  }
  private updateRows(filter: Doc, update: Doc, options: Doc, many: boolean) {
    const matched = this.matchRefs(filter);
    const targets = many ? matched : matched.slice(0, 1);
    for (const r of targets) applyUpdate(r, encode(update), false);
    if (!targets.length && options.upsert) {
      const d = this.upsertBase(filter);
      applyUpdate(d, encode(update), true);
      this.rows.push(d);
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: decode(d._id) };
    }
    return { acknowledged: true, matchedCount: targets.length, modifiedCount: targets.length, upsertedCount: 0, upsertedId: null };
  }
  async updateOne(filter: Doc, update: Doc, options: Doc = {}) { return this.updateRows(filter, update, options, false); }
  async updateMany(filter: Doc, update: Doc, options: Doc = {}) { return this.updateRows(filter, update, options, true); }
  async replaceOne(filter: Doc, doc: Doc, options: Doc = {}) { return this.updateRows(filter, doc, options, false); }
  async findOneAndUpdate(filter: Doc, update: Doc, options: Doc = {}) {
    const [target] = this.select(filter, { sort: options.sort, limit: 1 });
    const ref = target && this.rows.find((r) => r._id === target._id);
    let result: Doc | null = null;
    if (ref) {
      const before = JSON.parse(JSON.stringify(ref));
      applyUpdate(ref, encode(update), false);
      result = options.returnDocument === 'after' ? ref : before;
    } else if (options.upsert) {
      const d = this.upsertBase(filter);
      applyUpdate(d, encode(update), true);
      this.rows.push(d);
      result = options.returnDocument === 'after' ? d : null;
    }
    const value = result ? decode(result) : null;
    return options.includeResultMetadata ? { value, ok: 1 } : value;
  }
  async findOneAndReplace(filter: Doc, doc: Doc, options: Doc = {}) { return this.findOneAndUpdate(filter, doc, options); }
  async findOneAndDelete(filter: Doc, options: Doc = {}) {
    const [target] = this.select(filter, { sort: options.sort, limit: 1 });
    if (target) this.rows = this.rows.filter((r) => r._id !== target._id);
    const value = target ? decode(target) : null;
    return options.includeResultMetadata ? { value, ok: 1 } : value;
  }
  async deleteOne(filter: Doc) { const [t] = this.matchRefs(filter); if (t) this.rows = this.rows.filter((r) => r !== t); return { acknowledged: true, deletedCount: t ? 1 : 0 }; }
  async deleteMany(filter: Doc) { const ts = new Set(this.matchRefs(filter)); this.rows = this.rows.filter((r) => !ts.has(r)); return { acknowledged: true, deletedCount: ts.size }; }
  aggregate(pipeline: Doc[]) {
    return cursor(runPipeline(this.rows, mongoCompatPipeline(encode(pipeline)), {}));
  }
}

export interface MemoryDb {
  collections: Map<string, MemoryCollection>;
  /** Install the fake under these models (idempotent). */
  use(...models: mongoose.Model<any>[]): MemoryDb;
  /** Install the fake under every model registered with mongoose so far (call after imports). */
  useAll(): MemoryDb;
  /** Insert raw documents (as stored in Mongo) into a model's collection. */
  seed(model: mongoose.Model<any>, docs: Doc[]): void;
  /** Insert raw documents into a collection that has no model in this test (for $lookup sources). */
  seedRaw(collectionName: string, docs: Doc[]): void;
  rows(model: mongoose.Model<any>): Doc[];
  snapshot(): Map<string, Doc[]>;
  restore(snap: Map<string, Doc[]>): void;
  /** Remove every stub. */
  uninstall(): void;
}

const METHODS = ['find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'aggregate'] as const;
const restorers: (() => void)[] = [];

export const memoryDb: MemoryDb = {
  collections: new Map(),
  use(...models) {
    for (const model of models) {
      const name = model.collection.collectionName;
      if (this.collections.has(name)) continue;
      const mc = new MemoryCollection(name);
      this.collections.set(name, mc);
      const col: any = model.collection;
      for (const m of METHODS) {
        const original = col[m];
        col[m] = (...args: any[]) => (mc as any)[m](...args);
        restorers.push(() => { col[m] = original; });
      }
    }
    return this;
  },
  useAll() {
    return this.use(...(Object.values(mongoose.models) as mongoose.Model<any>[]));
  },
  seed(model, docs) {
    this.use(model);
    const mc = this.collections.get(model.collection.collectionName);
    // Store docs the way mongoose would have written them (subdocument _ids, defaults, casting),
    // like real data. Keys the caller set explicitly (timestamps, __v) win.
    for (const d of docs) {
      const shaped = new (model as any)({ _id: new mongoose.Types.ObjectId(), ...d }).toObject({ depopulate: true, virtuals: false });
      for (const [k, v] of Object.entries(d)) {
        // keep fields the schema dropped (strict) and explicit timestamps/version from the fixture
        if (!(k in shaped) || k === 'createdAt' || k === 'updatedAt' || k === '__v') shaped[k] = v;
      }
      mc.rows.push(encode(shaped));
    }
  },
  seedRaw(name, docs) {
    if (!this.collections.has(name)) this.collections.set(name, new MemoryCollection(name));
    const mc = this.collections.get(name);
    for (const d of docs) mc.rows.push(encode({ _id: new mongoose.Types.ObjectId(), ...d }));
  },
  rows(model) { return (this.collections.get(model.collection.collectionName)?.rows ?? []).map(decode); },
  snapshot() { return new Map([...this.collections].map(([k, c]) => [k, JSON.parse(JSON.stringify(c.rows))])); },
  restore(snap) {
    for (const [k, rows] of snap) this.collections.get(k).rows = JSON.parse(JSON.stringify(rows));
    // Dates were serialized to strings by JSON; re-hydrate ISO strings stored as Date originally
    for (const c of this.collections.values()) c.rows = c.rows.map((r) => reviveDates(r));
  },
  uninstall() { while (restorers.length) restorers.pop()(); this.collections.clear(); },
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const reviveDates = (v: any): any => {
  if (typeof v === 'string' && ISO.test(v)) return new Date(v);
  if (Array.isArray(v)) return v.map(reviveDates);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reviveDates(x)]));
  return v;
};

export { clone as cloneDoc };
