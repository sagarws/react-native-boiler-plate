export const zIndex = {
  base: 0,
  card: 1,
  dropdown: 10,
  sticky: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
} as const;

export type ZIndexKey = keyof typeof zIndex;
