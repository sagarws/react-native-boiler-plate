import { clone, delay } from "@/mocks/delay";
import { FRIEND_BONUS_PERCENT, REFERRAL_CODE, REFERRAL_LINK, REFERRER_BONUS_PERCENT, referralHistory } from "@/mocks/referral";
import type { ReferralSummaryData } from "@/types/referral";

/**
 * Mock of TrackVid-FE `api/referral-service.ts` (`/referrals/summary`). Resolves with the `data`
 * payload that `referral-middleware.getReferralSummary` hands to the page; throws on failure.
 */
const getSummary = async (): Promise<ReferralSummaryData> => {
  await delay(400);
  const rewarded = referralHistory.filter((r) => r.status === "rewarded");
  return {
    referralCode: REFERRAL_CODE,
    referralLink: REFERRAL_LINK,
    referrerBonusPercent: REFERRER_BONUS_PERCENT,
    friendBonusPercent: FRIEND_BONUS_PERCENT,
    stats: {
      totalReferrals: referralHistory.length,
      joinedCount: referralHistory.length - rewarded.length,
      rewardedCount: rewarded.length,
      totalBonusEarned: rewarded.reduce((s, r) => s + r.bonusCredits, 0),
    },
    history: clone(referralHistory).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)),
  };
};

export const ReferralService = {
  getSummary,
};
