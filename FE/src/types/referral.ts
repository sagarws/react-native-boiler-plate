/** Types from TrackVid-FE `middleware/referral-middleware.ts` (`/referrals/summary`). */

export type ReferralStatus = "joined" | "rewarded";

export interface ReferralHistoryRow {
  id: string;
  friendName: string;
  friendEmail: string;
  joinedAt: string;
  status: ReferralStatus;
  firstRechargeAmount: number;
  bonusCredits: number;
  rewardedAt: string | null;
}

export interface ReferralSummaryData {
  referralCode: string;
  referralLink: string;
  referrerBonusPercent: number;
  friendBonusPercent: number;
  stats: {
    totalReferrals: number;
    joinedCount: number;
    rewardedCount: number;
    totalBonusEarned: number;
  };
  history: ReferralHistoryRow[];
}
