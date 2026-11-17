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
