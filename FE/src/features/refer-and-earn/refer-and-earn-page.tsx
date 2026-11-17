"use client";

import { Icon } from "@/components/icons/icon";
import { CardHeading, MetricCard } from "@/components/ui/card-primitives";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { PageHeading } from "@/components/ui/page-heading";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDate, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { ReferralService } from "@/services/referral-service";
import type { ReferralHistoryRow, ReferralSummaryData } from "@/types/referral";

/** TrackVid `referral-middleware.getReferralSummary`: failures toast the server message. */
async function loadSummary(): Promise<ReferralSummaryData> {
  try {
    return await ReferralService.getSummary();
  } catch (err) {
    toast.error(errorMessage(err, "Failed to load referrals"));
    throw err;
  }
}

async function copy(text: string, label: string) {
  if (await copyText(text)) toast.success(`${label} copied`);
  else toast.error("Could not copy");
}

function HowItWorksStep({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <li className="tv-refer-step">
      <span className="tv-step-num">{step}</span>
      <div>
        <strong>{title}</strong>
        <p className="tv-muted tv-small">{description}</p>
      </div>
    </li>
  );
}

const columns: DataColumn<ReferralHistoryRow>[] = [
  {
    key: "friendName",
    header: "Friend",
    width: 260,
    render: (row) => (
      <span className="tv-stack" style={{ gap: 2 }}>
        <strong>{row.friendName || "—"}</strong>
        <small className="tv-muted">{row.friendEmail}</small>
      </span>
    ),
  },
  { key: "joinedAt", header: "Joined", width: 130, render: (row) => <span className="tv-muted">{formatDate(row.joinedAt)}</span> },
  {
    key: "status",
    header: "Status",
    width: 160,
    render: (row) => (row.status === "rewarded" ? <StatusPill value="Reward credited" tone="green" /> : <StatusPill value="Joined" tone="amber" />),
  },
  {
    key: "firstRechargeAmount",
    header: "First recharge",
    width: 140,
    align: "right",
    render: (row) => (row.status === "rewarded" ? `₹${row.firstRechargeAmount.toLocaleString("en-IN")}` : "—"),
  },
  {
    key: "bonusCredits",
    header: "Your bonus",
    width: 120,
    align: "right",
    render: (row) =>
      row.status === "rewarded" ? <strong className="tv-refer-bonus">+{row.bonusCredits.toLocaleString("en-IN")}</strong> : <span className="tv-muted">—</span>,
  },
];

function ReferralContent({ summary }: { summary: ReferralSummaryData }) {
  const { referralCode, referralLink, stats, history } = summary;
  const referrerBonusPercent = summary.referrerBonusPercent ?? 20;
  const friendBonusPercent = summary.friendBonusPercent ?? 10;
  const shareText = `Join me on TrackVid and get ${friendBonusPercent}% bonus credits on your first recharge. Use my link: ${referralLink}`;

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
  };

  const shareEmail = () => {
    const subject = encodeURIComponent("Try TrackVid — get bonus credits on me");
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(shareText)}`;
  };

  const shareNative = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Join me on TrackVid", text: shareText, url: referralLink });
      } catch {
        // The user dismissed the share sheet — nothing to report (same as TrackVid).
      }
    } else {
      await copy(referralLink, "Referral link");
    }
  };

  return (
    <>
      <section className="glass-card tv-refer-hero" aria-labelledby="refer-hero-title">
        <div className="tv-row">
          <Icon name="gift" />
          <h2 id="refer-hero-title" className="tv-section-title">
            Invite friends. Earn credits.
          </h2>
        </div>
        <p className="tv-muted tv-small">
          Get <strong>{referrerBonusPercent}% bonus credits</strong> when a friend you refer makes their first recharge. They also get a{" "}
          <strong>{friendBonusPercent}% bonus</strong> to start with.
        </p>
        <div className="tv-refer-copyrow">
          <div className="tv-refer-link">
            <Icon name="link" />
            <span className="tv-ellipsis" title={referralLink}>
              {referralLink}
            </span>
            <button type="button" className="icon-button compact-button" aria-label="Copy link" title="Copy link" onClick={() => void copy(referralLink, "Referral link")}>
              <Icon name="copy" />
            </button>
          </div>
          <div className="tv-refer-code">
            <small>CODE</small>
            <strong>{referralCode}</strong>
            <button type="button" className="icon-button compact-button" aria-label="Copy code" title="Copy code" onClick={() => void copy(referralCode, "Referral code")}>
              <Icon name="copy" />
            </button>
          </div>
        </div>
        <div className="tv-row">
          <button type="button" className="secondary-button compact-button" onClick={shareWhatsApp}>
            <Icon name="chats-circle" /> WhatsApp
          </button>
          <button type="button" className="secondary-button compact-button" onClick={shareEmail}>
            <Icon name="envelope" /> Email
          </button>
          <button type="button" className="secondary-button compact-button" onClick={() => void shareNative()}>
            <Icon name="share" /> Share
          </button>
        </div>
      </section>

      <div className="tv-grid-4">
        <MetricCard icon="users" tone="blue" label="Total invites" value={formatNumber(stats.totalReferrals)} />
        <MetricCard icon="timer" tone="amber" label="Joined (pending recharge)" value={formatNumber(stats.joinedCount)} />
        <MetricCard icon="check-circle" tone="success" label="Recharged friends" value={formatNumber(stats.rewardedCount)} />
        <MetricCard icon="wallet" tone="info" label="Bonus credits earned" value={formatNumber(stats.totalBonusEarned)} />
      </div>

      <div className="tv-refer-grid">
        <section className="glass-card">
          <CardHeading title="How it works" />
          <ol className="tv-refer-steps">
            <HowItWorksStep step={1} title="Share your link" description="Send your unique referral link to a friend." />
            <HowItWorksStep step={2} title="Friend signs up" description="They create an account using your link." />
            <HowItWorksStep
              step={3}
              title="They make their first recharge"
              description={`You get ${referrerBonusPercent}% bonus credits. They get ${friendBonusPercent}%.`}
            />
          </ol>
        </section>
        <section className="glass-card tv-table-card">
          <div className="tv-refer-table-head">
            <CardHeading title="Referral history" />
          </div>
          <DataTable
            label="Referral history"
            columns={columns}
            rows={history}
            getRowId={(r) => r.id}
            pagination="none"
            emptyTitle="No referrals yet"
            emptyMessage="No referrals yet. Share your link to get started."
            minTableWidth={720}
          />
        </section>
      </div>

      <p className="tv-refer-fineprint">
        Bonus credits are awarded only on the referred user&apos;s <strong>first</strong> successful recharge. Credits are added automatically within minutes of
        payment and never expire. There is no cap on the number of friends you can refer.
      </p>
    </>
  );
}

/** TrackVid `ReferAndEarn`. */
export function ReferAndEarnPage() {
  const { data, loading, error, reload } = useAsync(loadSummary, []);

  return (
    <div className="tv-page">
      <PageHeading title="Refer & Earn" subtitle="Invite other sellers to TrackVid and earn bonus credits on their first recharge." />
      {loading && !data ? (
        <>
          <SkeletonCard lines={4} height={210} />
          <div className="tv-grid-4">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} lines={1} />
            ))}
          </div>
          <SkeletonCard lines={5} height={260} />
        </>
      ) : error || !data ? (
        <section className="glass-card">
          <ErrorState title="Could not load referrals" message="We couldn't load your referral details. Please refresh." onRetry={reload} />
        </section>
      ) : (
        <ReferralContent summary={data} />
      )}
    </div>
  );
}
