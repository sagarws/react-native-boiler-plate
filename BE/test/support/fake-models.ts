/**
 * Replaces Mongoose model reads with an in-memory table (no DB). Supports the chains the legacy
 * auth middleware uses: findOne/findById/find/exists + populate/select/lean/exec/then.
 */
type Row = Record<string, any>;

const matches = (row: Row, filter: Row = {}) =>
  Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$exists' in v) return (row[k] !== undefined) === v.$exists;
    return String(row[k]) === String(v);
  });

const query = (result: () => unknown) => {
  const q: any = {
    populate: () => q, select: () => q, lean: () => q, sort: () => q, limit: () => q,
    exec: () => Promise.resolve(result()),
    then: (a: any, b: any) => Promise.resolve(result()).then(a, b),
    catch: (b: any) => Promise.resolve(result()).catch(b),
  };
  return q;
};

export const fakeModel = (model: any, rows: Row[]) => {
  const spies = [
    jest.spyOn(model, 'findOne').mockImplementation((f: any) => query(() => rows.find((r) => matches(r, f)) ?? null)),
    jest.spyOn(model, 'findById').mockImplementation((id: any) => query(() => rows.find((r) => String(r._id) === String(id)) ?? null)),
    jest.spyOn(model, 'find').mockImplementation((f: any) => query(() => rows.filter((r) => matches(r, f)))),
    jest.spyOn(model, 'exists').mockImplementation((f: any) => query(() => (rows.find((r) => matches(r, f)) ? { _id: 1 } : null))),
    jest.spyOn(model, 'updateOne').mockImplementation(() => query(() => ({ acknowledged: true }))),
  ];
  return () => spies.forEach((s) => s.mockRestore());
};

/**
 * Stubs only the DB write of `Model.create()/doc.save()`: casting + validation still run
 * (`validate()`), so cast/validation errors behave like a real save. Records saved docs.
 */
export const fakeSave = (model: any) => {
  const saved: any[] = [];
  const spy = jest.spyOn(model.prototype, '$save').mockImplementation(async function (this: any) {
    await this.validate();
    if (typeof this.initializeTimestamps === 'function' && this.schema.options.timestamps) this.initializeTimestamps();
    this.$isNew = false;
    saved.push(this.toObject());
    return this;
  });
  return { saved, restore: () => spy.mockRestore() };
};

/** Replaces the volatile ids/timestamps that legitimately differ between two runs. */
export const maskVolatile = (body: string, keys = ['_id', 'createdAt', 'updatedAt']) => {
  try {
    const walk = (n: any): any => {
      if (Array.isArray(n)) return n.map(walk);
      if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, keys.includes(k) ? '<v>' : walk(v)]));
      return n;
    };
    return JSON.stringify(walk(JSON.parse(body)));
  } catch {
    return body;
  }
};
