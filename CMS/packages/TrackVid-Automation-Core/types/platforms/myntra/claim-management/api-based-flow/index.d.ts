export const claimApiFlow: {
    MYNTRA_TO_CMS_STATUS: {
        OPEN: string;
        IN_REVIEW: string;
        AWAITING_SELLER_RESPONSE: string;
        ACCEPT: string;
        AWAITING_AGENT_RESPONSE: string;
        REJECT: string;
        PAYMENT_COMPLETED: string;
    };
    mapMyntraStatus: (myntraStatus: any) => any;
    myntraCompensation: (row: {
        status?: string | null;
        compensationAmount?: number | null;
    } | null) => number | null;
    API_BASE: string;
    ISSUE_CATEGORIES: string[];
    TICKET_STATUSES: string[];
    mapIssueCategory: (value: any) => any;
    buildUpdateClaimPayload: ({ row, issueCategory, description, shippingLabelProofUrls, productProofUrls, videoProofUrls, disputedAmount, physicalReceivedSku, }: {
        row: any;
        issueCategory: any;
        description: any;
        shippingLabelProofUrls?: any[];
        productProofUrls?: any[];
        videoProofUrls?: any[];
        disputedAmount: any;
        physicalReceivedSku: any;
    }) => {
        orderId: any;
        returnId: any;
        trackingId: any;
        returnTrackingId: any;
        skuId: any;
        orderLineId: any;
        returnCreatedDate: any;
        rejectionReason: any;
        styleId: any;
        orderCreatedOn: any;
        orderStatus: any;
        orderCancelDate: any;
        warehouseId: any;
        orderPackedDate: any;
        orderShippedDate: any;
        orderDeliveredDate: any;
        isRefunded: any;
        orderCreatedBy: any;
        returnMode: any;
        returnReason: any;
        finalAmount: any;
        meta: any;
        isOCRVerified: boolean;
        issueCategory: any;
        status: string;
        description: any;
        shippingLabelProofUrl: any[];
        productProofUrl: any[];
        videoProofUrl: any[];
        replyComment: string;
        attachments: any[];
    };
    loginMyntraApi: (credentials: any, { forceFresh }?: {
        forceFresh?: boolean;
    }) => Promise<any>;
    fetchNewClaim: (jar: any, searchId: any) => Promise<{
        found: boolean;
        row: any;
        ticketId: string;
    }>;
    fetchClaimByTicketId: (jar: any, ticketId: any) => Promise<{
        found: boolean;
        status: string;
        originalStatus: string;
        validationReason: any;
        row: any;
    }>;
    getUploadToken: (jar: any, fileName: any) => Promise<{
        sasUrl: any;
        fileNameWithPath: any;
    }>;
    uploadProof: (jar: any, { filePath, orderId }: {
        filePath: any;
        orderId: any;
    }) => Promise<any>;
    updateClaim: (jar: any, payload: any) => Promise<{
        ticketId: string;
        row: any;
    }>;
    getTickets: (jar: any, { page, pageSize, statuses }?: {
        page?: number;
        pageSize?: number;
        statuses?: string[];
    }) => Promise<any>;
    findTicketIdByTrackingId: (jar: any, searchId: any, { pageSize, maxPages }?: {
        pageSize?: number;
        maxPages?: number;
    }) => Promise<string>;
    _cookieHeader: (jar: any) => string;
    _apiHeaders: (jar: any, extra: any) => any;
    _mimeForFile: (filePath: any) => any;
};
export const common: typeof import("./common");
export const fileClaim: typeof import("./fileClaim");
