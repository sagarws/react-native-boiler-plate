// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function StorePulseGreeting({
  greeting,
  activityIcon,
  activityTitle,
  activityDetail,
  activityKind,
  tone,
  connection,
  paused,
  feedStatus,
  occurredAt,
  timeLabel,
  positionLabel,
  liveEndpoint,
  onKeyDown,
}) {
  return (
    <section
      className="store-live"
      aria-label="Store pulse and greeting"
      tabIndex={0}
      title={
        liveEndpoint
          ? "Store activity. Space pauses or resumes updates."
          : "Sample store activity. Space pauses or resumes; Right Arrow shows the next update."
      }
      data-activity={activityKind}
      data-tone={tone}
      data-connection={connection}
      data-paused={paused ? "true" : void 0}
      onKeyDown={onKeyDown}
    >
      <div className="live-greeting">
        <Icon name="sun" />
        <div>
          <strong>{greeting}</strong>
          <span>Your store, in motion.</span>
        </div>
      </div>
      <div className="live-update">
        <div className="live-message" aria-live="polite" aria-atomic="true">
          <span className="live-event-icon">
            <Icon name={activityIcon} />
          </span>
          <div>
            <strong title={activityTitle}>{activityTitle}</strong>
            <span title={activityDetail}>{activityDetail}</span>
          </div>
        </div>
      </div>
      <span className="sr-only">{feedStatus}</span>
      <time className="sr-only" dateTime={occurredAt}>
        {timeLabel}
      </time>
      <span className="sr-only">{positionLabel}</span>
    </section>
  );
}
