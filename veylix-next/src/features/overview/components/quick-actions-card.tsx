// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { CardHeading, IconTile } from "@/components/ui/card-primitives";
import { quickActions } from "@/data/dashboard";

export function QuickActionsCard() {
  const e = [
    ...quickActions,
    {
      label: "AI Assistant",
      action: "assistant",
      icon: "sparkle",
      tone: "amber",
    },
  ];
  return (
    <section className="glass-card quick-actions-card">
      <CardHeading title="Quick Actions" />
      <div className="quick-actions-list">
        {e.map((e) => (
          <button
            key={e.action}
            type="button"
            className="quick-action"
            data-action={e.action}
          >
            <IconTile name={e.icon} tone={e.tone} />
            <span>{e.label}</span>
            <Icon name="caret-right" />
          </button>
        ))}
      </div>
    </section>
  );
}
