import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons/icon";

/** Template `commerce-heading`: breadcrumb, title with the gold dot, actions on the right. */
export function PageHeading({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: readonly { label: string; href?: string }[];
}) {
  return (
    <header className="commerce-heading">
      <div>
        <div className="commerce-breadcrumb">
          <Link href="/">TrackVid</Link>
          {(crumbs ?? []).map((c) => (
            <span key={c.label} style={{ display: "contents" }}>
              <Icon name="caret-right" />
              {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
          <Icon name="caret-right" />
          <span>{title}</span>
        </div>
        <h1>
          {title}
          <span>.</span>
        </h1>
        {subtitle ? <p className="tv-muted" style={{ marginTop: 6 }}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="commerce-heading-actions">{actions}</div> : null}
    </header>
  );
}
