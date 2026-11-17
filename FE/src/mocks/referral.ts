import { daysAgo } from "@/mocks/delay";
import type { ReferralHistoryRow } from "@/types/referral";

/** Sample referral programme data for the signed-in company. */
export const REFERRAL_CODE = "TVSHREE24";
export const REFERRAL_LINK = `https://app.trackvid.in/register?ref=${REFERRAL_CODE}`;
export const REFERRER_BONUS_PERCENT = 20;
export const FRIEND_BONUS_PERCENT = 10;

export const referralHistory: ReferralHistoryRow[] = [
  {
    id: "ref_001",
    friendName: "Kavya Fashions",
    friendEmail: "accounts@kavyafashions.in",
    joinedAt: daysAgo(4, 11),
    status: "joined",
    firstRechargeAmount: 0,
    bonusCredits: 0,
    rewardedAt: null,
  },
  {
    id: "ref_002",
    friendName: "Urban Threads Pvt Ltd",
    friendEmail: "ops@urbanthreads.co.in",
    joinedAt: daysAgo(12, 15),
    status: "rewarded",
    firstRechargeAmount: 25000,
    bonusCredits: 5000,
    rewardedAt: daysAgo(10, 16),
  },
  {
    id: "ref_003",
    friendName: "Mehta Footwear",
    friendEmail: "rahul.mehta@mehtafootwear.com",
    joinedAt: daysAgo(21, 10),
    status: "rewarded",
    firstRechargeAmount: 10000,
    bonusCredits: 2000,
    rewardedAt: daysAgo(19, 12),
  },
  {
    id: "ref_004",
    friendName: "",
    friendEmail: "hello@desiroots.store",
    joinedAt: daysAgo(33, 9),
    status: "joined",
    firstRechargeAmount: 0,
    bonusCredits: 0,
    rewardedAt: null,
  },
  {
    id: "ref_005",
    friendName: "Saanvi Ethnic Wear",
    friendEmail: "saanvi.ethnic@gmail.com",
    joinedAt: daysAgo(48, 14),
    status: "rewarded",
    firstRechargeAmount: 50000,
    bonusCredits: 10000,
    rewardedAt: daysAgo(45, 18),
  },
  {
    id: "ref_006",
    friendName: "Trendz Kids",
    friendEmail: "support@trendzkids.in",
    joinedAt: daysAgo(70, 13),
    status: "rewarded",
    firstRechargeAmount: 5000,
    bonusCredits: 1000,
    rewardedAt: daysAgo(66, 11),
  },
];
