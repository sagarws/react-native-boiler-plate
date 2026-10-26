export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Values snap to this increment, so the control can only emit round numbers. */
  step: number;
  onChange: (next: number) => void;
  accessibilityLabel: string;
  /** Spoken in place of the bare number, e.g. "80 percent". */
  accessibilityValueText?: string;
  disabled?: boolean;
  testID?: string;
}
