import { Icon } from "@/components/icons/icon";

export function Stepper({ steps, active }: { steps: readonly string[]; active: number }) {
  return (
    <ol className="tv-stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={i === active ? "is-active" : i < active ? "is-done" : undefined} aria-current={i === active ? "step" : undefined}>
          <span className="tv-step-num">{i < active ? <Icon name="check" /> : i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
