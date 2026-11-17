import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { User } from '@legacy/models/User/user.model';
import { Referral, REFERRAL_STATUS } from '@legacy/models/Referral/referral.model';
import { SERVER_MESSAGE } from '@legacy/enum/response.enum';
import { ensureUserReferralCode, REFERRER_BONUS_PERCENT, FRIEND_BONUS_PERCENT } from '@legacy/utils/referral';
import { Auth } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';

const maskEmail = (email?: string): string => {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
};

/** Port of legacy routes/Referral/referral.routes.ts. Queries: Referral `{ referrerId }` sorted by createdAt, User `_id $in`. */
@Controller('api/referrals')
export class ReferralController {
  @Get('summary')
  @Auth()
  async getReferralSummary(@LegacyReq() req: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const userId = req.user.id;
      const code = await ensureUserReferralCode(userId);
      const referrals: any[] = await Referral.find({ referrerId: userId }).sort({ createdAt: -1 }).limit(100).lean();
      const friendIds = referrals.map((r) => r.referredUserId);
      const friends: any[] = await User.find({ _id: { $in: friendIds } }).select('name email createdAt').lean();
      const friendMap = new Map(friends.map((f) => [String(f._id), f]));

      const joinedCount = referrals.filter((r) => r.status === REFERRAL_STATUS.JOINED).length;
      const rewardedCount = referrals.filter((r) => r.status === REFERRAL_STATUS.REWARDED).length;
      const totalBonusEarned = referrals.reduce((sum, r) => sum + (r.referrerBonusCredits || 0), 0);

      const history = referrals.map((r) => {
        const friend = friendMap.get(String(r.referredUserId));
        return {
          id: r._id,
          friendName: friend?.name?.fullName ?? '',
          friendEmail: maskEmail(friend?.email),
          joinedAt: friend?.createdAt ?? r.createdAt,
          status: r.status,
          firstRechargeAmount: r.firstRechargeAmount,
          bonusCredits: r.referrerBonusCredits,
          rewardedAt: r.rewardedAt,
        };
      });

      const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') ?? '';
      const referralLink = frontendUrl ? `${frontendUrl}/auth/register?ref=${code}` : `?ref=${code}`;

      reply.status(200);
      return {
        isSuccess: true,
        displayMessage: 'Referral summary fetched.',
        data: {
          referralCode: code,
          referralLink,
          referrerBonusPercent: REFERRER_BONUS_PERCENT,
          friendBonusPercent: FRIEND_BONUS_PERCENT,
          stats: { totalReferrals: referrals.length, joinedCount, rewardedCount, totalBonusEarned },
          history,
        },
      };
    } catch (err: any) {
      reply.status(500);
      return { isSuccess: false, message: err.message, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }
}
