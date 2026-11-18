export function loginXbeesApi(credentials: any, { forceFresh }?: {
    forceFresh?: boolean;
}): Promise<{
    accessToken: any;
    refreshToken: any;
    tokenType: any;
    realm: any;
    clientId: any;
    idToken: any;
}>;
/**
 * POST /disputeReasonSubReason
 * Request: { taskType: "DTO" | "DTA", disputeRaisedType: "Client" }
 * Response: [ { reason, subReason: [{ subReason, disputereasonid, isimage, isvideo }] } ]
 *
 * The "taskType" varies per shipment. Verified shape is DTO (Domestic To
 * Origin — returns). The runner picks DTO for return shipments; extend as
 * new task types come in.
 */
export function getDisputeReasons(ctx: any, taskType?: string): Promise<any>;
export function resolveDisputeReason(cmsReason: any, cmsSubReason: any, vocabulary: any): {
    reason: any;
    subReason: any;
    disputereasonid: any;
    isimage: boolean;
    isvideo: boolean;
};
export function getPresignedUrl(ctx: any, { fileName, shippingid, contentType, type, position }: {
    fileName: any;
    shippingid: any;
    contentType: any;
    type: any;
    position: any;
}): Promise<{
    uploadUrl: any;
    s3Key: any;
}>;
export function putToS3(uploadUrl: any, filePath: any, contentType: any): Promise<void>;
/**
 * POST /saveUploadedMedia
 * Body: { s3Key, type, position, shippingid, uploaderId }
 * Response: { tempMediaId, tinyURL }
 * The `tempMediaId` is what goes into raisedDispute's DisputeProdcutImageURL /
 * DisputeProductVideoURL arrays.
 */
export function saveUploadedMedia(ctx: any, { s3Key, type, position, shippingid, uploaderId }: {
    s3Key: any;
    type: any;
    position: any;
    shippingid: any;
    uploaderId: any;
}): Promise<{
    tempMediaId: any;
    tinyURL: any;
}>;
/**
 * End-to-end upload for one file: presigned URL → S3 PUT → saveUploadedMedia.
 * Returns the tempMediaId.
 */
export function uploadOneMedia(ctx: any, { filePath, fileName, contentType, type, position, shippingid, uploaderId }: {
    filePath: any;
    fileName: any;
    contentType: any;
    type: any;
    position: any;
    shippingid: any;
    uploaderId: any;
}): Promise<any>;
/**
 * POST /raisedDispute
 * Body verified from the capture:
 *   {
 *     AWBNumber, ShipmentType: "DTO Shipment", DisputeAmount, DisputeReason,
 *     DisputeSubReason, Comments,
 *     DisputeProdcutImageURL: [{ PhotoProof1_Front, PhotoProof2_Back,
 *       PhotoProof3_RightSide, PhotoProof4_LeftSide }],
 *     DisputeProductVideoURL: [{ UnboxingVideoProof1, PackagingVideoProof1 }],
 *     SourceType: "ClientAPI", OtherProofs1, OtherProofs2, actionStatus: null
 *   }
 * Each *Proof value is a tempMediaId string (or null when the slot is empty).
 */
export function raiseDispute(ctx: any, { awbNumber, disputeAmount, disputeReason, disputeSubReason, comments, photoTempIds, videoTempIds, shipmentType, otherProofs1, otherProofs2, }: {
    awbNumber: any;
    disputeAmount: any;
    disputeReason: any;
    disputeSubReason: any;
    comments: any;
    photoTempIds?: {};
    videoTempIds?: {};
    shipmentType?: string;
    otherProofs1?: string;
    otherProofs2?: string;
}): Promise<any>;
/**
 * POST /disputeSummary — list of disputes for the seller (paged; filters).
 * POST /viewDisputeDetails — full detail for one dispute id.
 * Response shapes vary per Xbees release; probe common keys.
 */
export function getDisputeSummary(ctx: any, { awbNumber, pageNumber, pageSize }?: {
    awbNumber?: string;
    pageNumber?: number;
    pageSize?: number;
}): Promise<any>;
export function viewDisputeDetails(ctx: any, disputeId: any): Promise<any>;
export function findExistingDisputeByAwb(ctx: any, awbNumber: any): Promise<{
    disputeId: any;
    status: any;
    raw: any;
}>;
export function mapXbeesStatus(xbeesStatus: any): any;
export function claimStatusToCmsStatus(xbeesStatus: any): any;
export namespace XBEES_TO_CMS_STATUS {
    let open: string;
    let in_review: string;
    let pending: string;
    let processing: string;
    let initiated: string;
    let approved: string;
    let resolved: string;
    let accepted: string;
    let rejected: string;
    let denied: string;
    let closed: string;
    let seller_action_required: string;
    let awaiting_response: string;
}
/**
 * Slot positions verified from the capture. Photo-side positions are
 * PhotoProof1_Front / PhotoProof2_Back / PhotoProof3_RightSide /
 * PhotoProof4_LeftSide. Video positions are UnboxingVideoProof1 /
 * PackagingVideoProof1.
 */
export const PHOTO_SLOTS: string[];
export const VIDEO_SLOTS: string[];
export function apiHeaders(ctx: any, extra?: {}): {
    "user-agent": string;
    accept: string;
    "accept-language": string;
    authorization: string;
    "content-type": string;
    origin: string;
    referer: string;
};
export function xbeesPost(ctx: any, urlPath: any, body: any, step: any, host?: string): Promise<any>;
/**
 * Map a non-100 Xbees envelope to a clean, operator-readable Error.
 * Returns null when the envelope is not a known business outcome, so the caller
 * falls back to the generic xbeesApiError with the full raw text.
 */
export function xbeesBusinessError(data: any): Error;
import { CLIENT_SHIP_HOST } from "../../common/sessionStore";
import { XBM_MASTER_HOST } from "../../common/sessionStore";
export { CLIENT_SHIP_HOST, XBM_MASTER_HOST };
