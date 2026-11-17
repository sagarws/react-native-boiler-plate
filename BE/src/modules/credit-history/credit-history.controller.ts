import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import CreditHistory from '@legacy/models/CreditHistory/CreditHistory.modal';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import { Auth } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';

const MULTI_STATION_FEED_NAME = 'Multi Station';

/**
 * Port of legacy routes/CreditHistory/creditHistory.routes.ts.
 * Aggregation pipeline copied verbatim from legacy getCreditHistory (first $match on
 * `{ companyId, actionType?, createdAt }`, same as legacy; index set unchanged by the port).
 */
@Controller('api/credit-history')
export class CreditHistoryController {
  @Get()
  @Auth()
  async getCreditHistory(@LegacyReq() req: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const companyId = req.user.companyId;

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const startDate = new Date(req.query.startDate as string).setUTCHours(0, 0, 0, 0);
      const endQueryDate = req.query.endDate ? (req.query.endDate as string) : (req.query.startDate as string);
      const endDate = new Date(endQueryDate).setUTCHours(23, 59, 59, 999);
      const search = req.query.search ? (req.query.search as string) : '';
      const searchMatch = search
        ? {
            $or: [
              { 'orderData.trackingId': { $regex: search, $options: 'i' } },
              { 'cmsData.AWBNumber': { $regex: search, $options: 'i' } },
            ],
          }
        : {};
      const dateMatch = search.length === 0 ? { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } } : {};
      const actionType = req.query.actionType && req.query.actionType !== 'undefined' ? (req.query.actionType as string) : '';
      const actionTypeArray = actionType
        ? actionType.split(',').map((item) => Number(item.trim())).filter((num) => !isNaN(num))
        : [];

      const creditHistory = await CreditHistory.aggregate([
        {
          $match: {
            companyId: companyId,
            ...(actionTypeArray.length > 0 ? { actionType: { $in: actionTypeArray } } : {}),
            ...dateMatch,
          },
        },
        { $lookup: { from: 'companies', localField: 'companyId', foreignField: '_id', as: 'companyData' } },
        { $lookup: { from: 'feeds', localField: 'feedId', foreignField: '_id', as: 'feedData' } },
        { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'orderData' } },
        { $lookup: { from: 'manualpayments', localField: 'paymentId', foreignField: '_id', as: 'paymentData' } },
        { $lookup: { from: 'cms', localField: 'cmsId', foreignField: '_id', as: 'cmsData' } },
        {
          $addFields: {
            companyData: { $arrayElemAt: ['$companyData', 0] },
            feedData: { $arrayElemAt: ['$feedData', 0] },
            orderData: { $arrayElemAt: ['$orderData', 0] },
            paymentData: { $arrayElemAt: ['$paymentData', 0] },
            cmsData: { $arrayElemAt: ['$cmsData', 0] },
          },
        },
        {
          // Multi-step recording: the charge is against the merged Order; feed name reads "Multi Station".
          $addFields: { isMultiStation: { $gt: [{ $size: { $ifNull: ['$orderData.mergedFrom', []] } }, 0] } },
        },
        { $addFields: { feedData: { $cond: ['$isMultiStation', { feedName: MULTI_STATION_FEED_NAME }, '$feedData'] } } },
        {
          $project: {
            isMultiStation: 1,
            companyId: 1,
            createdAt: 1,
            feedId: 1,
            actionType: 1,
            credit: 1,
            orderId: 1,
            cmsId: 1,
            paymentId: 1,
            'companyData.name': 1,
            'paymentData.user_email': 1,
            'paymentData.payment_status': 1,
            'feedData.feedName': 1,
            'cmsData.AWBNumber': 1,
            'orderData.orderType': 1,
            'orderData.trackingId': 1,
          },
        },
        { $match: { ...searchMatch } },
        {
          $facet: {
            metadata: [{ $count: 'total' }],
            history: [{ $sort: { createdAt: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
          },
        },
        { $addFields: { totalCount: { $arrayElemAt: ['$metadata.total', 0] }, currentPage: page, perPage: limit } },
        {
          $project: {
            history: 1,
            metadata: {
              total: '$totalCount',
              totalPage: { $ceil: { $divide: ['$totalCount', limit] } },
              page: '$currentPage',
              limit: '$perPage',
            },
          },
        },
      ]);

      if (!creditHistory) {
        reply.status(SERVER_STATUS_CODE.NOT_FOUND);
        return { isSuccess: false, message: SERVER_MESSAGE.CREDIT_HISTORY_NOT_FOUND, displayMessage: SERVER_MESSAGE.CREDIT_HISTORY_NOT_FOUND };
      }

      const payload = {
        metadata: creditHistory[0]?.metadata[0] ?? {},
        history: creditHistory[0].history ?? [],
      };

      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return { isSuccess: true, message: SERVER_MESSAGE.CREDIT_HISTORY_FOUND, displayMessage: SERVER_MESSAGE.CREDIT_HISTORY_FOUND, data: payload };
    } catch (error) {
      console.error('🚀 ~ error while getting credit history -->', error);
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }
}
