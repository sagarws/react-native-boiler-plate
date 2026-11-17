// @ts-nocheck

export function createField(e, t, n = "text", r = {}) {
  return {
    key: e,
    label: t,
    type: n,
    ...r,
  };
}

export function textField(e, t, n) {
  return createField(e, t, "text", n);
}

export function selectField(e, t, n, r) {
  return createField(e, t, "select", {
    options: n,
    ...r,
  });
}

export function moneyField(e, t) {
  return createField(e, t, "money", {
    min: 0,
  });
}

export function numberField(e, t, n) {
  return createField(e, t, "number", {
    min: 0,
    ...n,
  });
}

export function statusField(e) {
  return selectField("status", "Status", e, {
    required: true,
  });
}

export const nameField = textField("name", "Name", {
  required: true,
});

export const notesField = createField("notes", "Notes", "textarea");

export function dateField(e = "date", t = "Date") {
  return createField(e, t, "date");
}

export function createResourceModule(e, t, n, r, i, a = {}) {
  return {
    id: e,
    title: t,
    description: n,
    kind: "resource",
    fields: r,
    columns: r
      .filter((e) => e.type !== "textarea")
      .slice(0, 6)
      .map((e) => e.key),
    seeds: i.map((t, n) => ({
      id: `${e}-${n + 1}`,
      ...t,
    })),
    ...a,
  };
}

export function createModule(e, t, n, r, i = {}) {
  return {
    id: e,
    title: t,
    description: n,
    kind: r,
    ...i,
  };
}
