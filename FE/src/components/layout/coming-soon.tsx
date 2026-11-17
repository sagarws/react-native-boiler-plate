import { Icon } from "@/components/icons/icon";
import { PageHeading } from "@/components/ui/page-heading";

/** Placeholder for a route that is not migrated yet. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="tv-page">
      <PageHeading title={title} />
      <section className="glass-card tv-state">
        <Icon name="timer" />
        <h3>Coming soon</h3>
        <p>This screen is being rebuilt in the new TrackVid look.</p>
      </section>
    </div>
  );
}
