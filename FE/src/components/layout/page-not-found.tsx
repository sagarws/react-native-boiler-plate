import Link from "next/link";
import { Icon } from "@/components/icons/icon";

/** TrackVid 404 in the template's "Page not found" card. */
export function PageNotFound({ standalone = false }: { standalone?: boolean }) {
  const card = (
    <section className="glass-card tv-state" style={{ maxWidth: 520, margin: standalone ? 0 : "40px auto" }}>
      <Icon name="question" />
      <h3 style={{ fontSize: 40 }}>404</h3>
      <h3>Page not found</h3>
      <p>The page you are looking for does not exist or has been moved.</p>
      <Link className="primary-button" href="/">
        Back to dashboard
      </Link>
    </section>
  );
  return standalone ? <div className="tv-fullscreen-state">{card}</div> : card;
}
