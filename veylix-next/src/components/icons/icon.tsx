// @ts-nocheck
import { iconSvgs } from "@/components/icons/icon-svgs";

export function Icon({ name: e, className = "" }) {
  return (
    <span
      className={`icon ${className}`.trim()}
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: iconSvgs[e] || iconSvgs.package,
      }}
    />
  );
}
