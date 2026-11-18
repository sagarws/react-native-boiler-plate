import mongoose from 'mongoose';
import Feed from '@legacy/models/Feed/feed.model';
import { FeedUser } from '@legacy/models/User/feedUser.model';
import { User } from '@legacy/models/User/user.model';
import { getRole } from '@legacy/utils/helper';
import { SERVER_MESSAGE } from '@legacy/enum/response.enum';
import { loginFeedUser } from '@legacy/controllers/Auth/auth.controller';

/**
 * POST /api/auth/feed-token — a feed session for a company admin who is
 * already signed in (the CMS desktop app's VMS mode: the admin picks a feed
 * instead of typing that station's userId and password).
 *
 * NOT IN THE PINNED LEGACY TREE. The same endpoint was added to the legacy repo
 * as `issueFeedToken`; until `BE/legacy` is re-pinned past it, this Nest-owned
 * handler serves the route. It runs the same checks (feed + FeedUser in the
 * caller's company, not disabled, station lock unless `force: true`), then
 * hands the legacy `loginFeedUser` a body it builds server-side — so the
 * session it returns is byte-identical to a normal feed login, and the feed's
 * password never leaves the server. When the pin moves, replace this with a
 * `delegate(q, r, issueFeedToken)` like every other route.
 *
 * Guarded by `adminAuth(["feed::view"])` at the route (same as the feed list),
 * which puts the caller's `{ id, companyId }` on `req.user`.
 */
export const issueFeedToken = async (req: any, res: any) => {
  try {
    const { feedId, versionName, force } = req.body ?? {};
    const companyId = req.user?.companyId;

    if (typeof feedId !== 'string' || !mongoose.Types.ObjectId.isValid(feedId)) {
      return res.status(400).json({ isSuccess: false, message: 'feedId is required.', data: null, displayMessage: 'Choose a feed.' });
    }

    const feed: any = await Feed.findOne({ _id: feedId, companyId, isDeleted: false }).lean();
    if (!feed) {
      return res.status(404).json({ isSuccess: false, message: 'Feed not found.', data: null, displayMessage: 'That feed does not exist in your company.' });
    }

    const user: any = await FeedUser.findOne({ feedId, companyId, isDeleted: false }).lean();
    if (!user) {
      return res.status(404).json({ isSuccess: false, message: SERVER_MESSAGE.USER_NOT_FOUND, data: null, displayMessage: 'This feed has no login yet. Add one in TrackVid first.' });
    }

    if (user.isDisable || feed.isDisable) {
      return res.status(400).json({ isSuccess: false, message: SERVER_MESSAGE.USER_DISABLED, data: null, displayMessage: SERVER_MESSAGE.USER_DISABLED });
    }

    if (user.isLoggedIn && force !== true) {
      return res.status(409).json({
        isSuccess: false,
        message: SERVER_MESSAGE.USER_ALREADY_LOGGED_IN,
        data: { feedName: feed.feedName, alreadyLoggedIn: true },
        displayMessage: SERVER_MESSAGE.USER_ALREADY_LOGGED_IN,
      });
    }

    // feed-login names the company's verified admin account in its company
    // block, and looks it up by email — so that is the account it is given.
    const adminRole: any = await getRole('admin');
    const admin: any = await User.findOne({ companyId, role: adminRole?._id, isDeleted: false, isDisable: false, isEmailVerified: true }).lean();
    if (!admin) {
      return res.status(400).json({ isSuccess: false, message: SERVER_MESSAGE.USER_NOT_FOUND, data: null, displayMessage: 'Your company has no verified admin account.' });
    }

    req.body = { userId: user.userId, password: user.password, companyEmail: admin.email, versionName };
    return loginFeedUser(req, res);
  } catch (err: any) {
    return res.status(500).json({ isSuccess: false, message: err.message, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER });
  }
};
