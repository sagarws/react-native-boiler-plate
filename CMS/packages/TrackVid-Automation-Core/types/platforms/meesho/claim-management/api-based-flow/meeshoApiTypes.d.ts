/**
 * What every call in claimApiFlow.js takes. Built by loginMeeshoApi or restored
 * from the session store.
 */
export type MeeshoApiContext = {
    /**
     * cookie name → value; the session is the cookies
     */
    jar: Record<string, string>;
    /**
     * numeric supplier id, e.g. 4647393
     */
    supplierId: number | string | null;
    /**
     * the 5-character slug, e.g. "e18ek"; sent as the `identifier` header
     */
    supplierIdentifier: string | null;
    logger?: {
        log: Function;
        warn?: Function;
    };
};
/**
 * POST /api/container/supplier/prefetch-supply-data → the call that maps the
 * slug to the numeric id. The ONLY source: supplier/config carries feature
 * flags and no ids at all.
 */
export type SupplyData = {
    registrationStatus: {
        decodedToken: {
            email: string;
            user_id: string;
            supplier_identifiers: string[];
            supplier_identifier_to_id_mapping: Record<string, number>;
        };
        isAuthenticated: boolean;
    };
    supplier: {
        supplier_id: number;
        name: string;
        identifier: string;
    };
};
/**
 * One row of the Returns search, normalised by searchReturnClaims().
 */
export type AccountReturn = {
    /**
     * the CMS AWB number
     */
    awb: string | null;
    /**
     * "3216302445191…"
     */
    orderNumber: string | null;
    /**
     * "3216302445191…_1" — what the ticket is keyed on
     */
    subOrderNumber: string | null;
    /**
     * "…_1_return_919569291"
     */
    subOrderIdentifier: string | null;
    /**
     * "RET"
     */
    type: string | null;
    /**
     * "FIRST_RET"
     */
    subType: string | null;
    /**
     * "Delivered"
     */
    shipmentStatus: string | null;
    /**
     * ISO with offset
     */
    createdDate: string | null;
    /**
     * ISO with offset — the date the 7-day claim window runs from
     */
    deliveredDate: string | null;
    /**
     * "Delhivery"
     */
    carrierName: string | null;
    returnReason: string | null;
    detailedReason: string | null;
    /**
     * name, sku, meesho_pid, quantity, price, category, image_urls[]
     */
    product: object | null;
    /**
     * the row exactly as Meesho returned it
     */
    raw: object;
};
/**
 * fetchSubCategory → sub_categories[].
 */
export type MeeshoSubCategory = {
    /**
     * 1 = wrong return, 2 = missing items, 3 = damaged return
     */
    sub_category_id: number;
    /**
     * what the CMS calls typeOfClaim
     */
    sub_category_title: string;
    /**
     * prose, and where the claim window is stated
     */
    description: string;
    /**
     * SUPPORT response time in hours (168), NOT the claim window
     */
    tat: number;
    /**
     * "Meesho support agent will share an update within 3 hours"
     */
    tatMessage: string;
    description_schema?: object[];
};
/**
 * subcategorySchema → schema[]: the ticket form, field by field. `action_*`
 * types are the ones validateTicketField checks.
 */
export type TicketFormField = {
    /**
     * sub_order_number | awb_number | packet_state | barcode_id | …
     */
    key: string;
    /**
     * "Sub Order Number"
     */
    label: string;
    /**
     * action_single_text_box | drop_down | img_file | action_img_file | video_file | text_area | text_box | text
     */
    type: string;
    req: boolean;
    errMsg?: {
        req: string;
    };
    options?: {
        value: string;
        label: string;
        default_select?: boolean;
    }[];
};
/**
 * POST /api/experience/support/api/v1/upload/supplier-support/input-attachment
 * Multipart with TWO fields: the file, and `entity_type` (SupportEntityType —
 * "SUPPLIER" for an upload the seller makes). Without the second, Meesho
 * answers 400 "Required SupportEntityType parameter 'entity_type' is not
 * present". The `url` is what goes in a ticket_details value array.
 */
export type UploadResponse = {
    /**
     * https://gcs-supl-…googleapis.com/TicketInputAttachments/<supplierId>/<epochMs>/<filename>
     */
    url: string;
    is_valid: boolean;
    errors: {
        error_message: string;
        field_name: string;
    }[] | null;
};
/**
 * One entry of `ticket_details`, in both validateTicketField and createTicket.
 */
export type TicketDetail = {
    key: string;
    type: string;
    label: string;
    /**
     * a string, or an array of uploaded URLs
     */
    value: string | string[];
    /**
     * drop_down only: the Title Case label beside the lowercase value
     */
    selectedLabel?: string;
};
/**
 * validateTicketField, normalised by validateTicketField().
 */
export type TicketFieldValidation = {
    isValid: boolean;
    errors: {
        message: string;
        field: string | null;
    }[];
    /**
     * { is_valid, errors, success, interaction_key }
     */
    raw: object;
};
/**
 * createTicket, normalised by createTicket(). A REFUSAL is an HTTP 200 with
 * is_valid false and errors[] — it throws rather than returning this.
 */
export type CreatedTicket = {
    /**
     * 12-digit id, e.g. "789478393183"
     */
    ticketId: string | null;
    /**
     * ticket_creation_message
     */
    message: string | null;
    /**
     * "Created"
     */
    ticketType: string | null;
    raw: object;
};
/**
 * searchTickets → results[]. The same shape fetchAllTickets returns.
 */
export type MeeshoTicket = {
    ticket_id: number;
    /**
     * the sub-category title
     */
    title: string;
    /**
     * HTML, as submitted
     */
    description: string;
    /**
     * "Open" | "Pending" | "In Progress" | "Closed"
     */
    status: string;
    supplier_id: number;
    supplier_support_sub_category_id: number;
    /**
     * "2026-09-15T18:49:54"
     */
    created_at: string;
    modified_at: string;
    /**
     * created_at + tat hours
     */
    estimated_response_time: string;
    reopen_count: number;
    /**
     * "Created"
     */
    ticket_type: string;
    read: boolean;
};
/**
 * What fileMeeshoClaim() resolves with.
 */
export type FiledMeeshoClaim = {
    ticketId: string;
    alreadyExisted: boolean;
    /**
     * set only for a ticket that already existed
     */
    cmsStatus: string | null;
    meeshoStatus: string | null;
};
