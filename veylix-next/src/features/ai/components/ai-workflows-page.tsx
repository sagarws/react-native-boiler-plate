// @ts-nocheck
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { aiWorkflows } from "@/features/ai/data";
import { buildHref } from "@/lib/navigation";

export function AiWorkflowsPage() {
  return (
    <Fragment>
      <CommercePageHeading
        title="AI workflows"
        actions={
          <Link
            className="secondary-button"
            href={buildHref("/commerce/integrations")}
          >
            API connection
            <Icon name="arrow-right" />
          </Link>
        }
      />
      <section className="glass-card ai-workflow-intro">
        <span className="icon-tile">
          <Icon name="sparkle" />
        </span>
        <div>
          <h2>Your store knowledge. A useful first draft.</h2>
          <p>
            Choose a workflow, review the context, then edit and save the
            result. Choose template responses or connect an AI provider.
          </p>
        </div>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/ai-voice")}
        >
          <Icon name="chats-circle" />
          {"Voice & product assist"}
        </Link>
      </section>
      <div className="ai-workflow-grid">
        {aiWorkflows.map((e, t) => (
          <Link
            key={e.id}
            className="glass-card ai-workflow-card"
            href={buildHref(
              `/commerce/ai-studio?workflow=${encodeURIComponent(e.id)}`,
            )}
          >
            <div>
              <span
                className={`icon-tile ${t % 3 == 1 ? "success" : t % 3 == 2 ? "info" : ""}`.trim()}
              >
                <Icon name={e.icon} />
              </span>
              <span className="ai-workflow-arrow">
                <Icon name="arrow-right" />
              </span>
            </div>
            <h2>{e.title}</h2>
            <p>{e.copy}</p>
            <small>{e.scope}</small>
            <strong>
              {"Open workflow "}
              <Icon name="arrow-right" />
            </strong>
          </Link>
        ))}
      </div>
    </Fragment>
  );
}
