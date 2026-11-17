import { filledIconPaths } from "@/components/icons/filled-icon-paths";
import { strokeIconPaths } from "@/components/icons/stroke-icon-paths";

export type FilledIconName = keyof typeof filledIconPaths;
export type StrokeIconName = keyof typeof strokeIconPaths;
export type IconName = FilledIconName | StrokeIconName;

function isFilled(name: IconName): name is FilledIconName {
  return name in filledIconPaths;
}

/** Template icon: a 20px inline SVG that takes `currentColor`. Rendered from path data, no HTML injection. */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const cls = `icon ${className}`.trim();
  if (isFilled(name)) {
    return (
      <span className={cls} aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
          {filledIconPaths[name].map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
    );
  }
  return (
    <span className={cls} aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="i-stroke"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {strokeIconPaths[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
