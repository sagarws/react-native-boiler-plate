// -----------------------------------------------------------------------------
// Meesho Supplier Panel — request and response shapes of the claim APIs
// -----------------------------------------------------------------------------
// JSDoc only; nothing here runs. `npm run build` turns these into
// types/…/meeshoApiTypes.d.ts, so a TypeScript consumer (Trackvid-CMS) and an
// editor reading claimApiFlow.js see the same shapes.
//
// Every shape is copied from a real capture of the portal (Chrome 152,
// 2026-09-16: login, returns search, TAT validation, a refused claim, a ticket
// search). How and when each call is made is in MEESHO_API.md.
//
// When Meesho changes a response, change the shape here AND the call in
// claimApiFlow.js.
// -----------------------------------------------------------------------------

// ── Session ──────────────────────────────────────────────────────────────────

/**
 * What every call in claimApiFlow.js takes. Built by loginMeeshoApi or restored
 * from the session store.
 * @typedef {object} MeeshoApiContext
 * @property {Record<string, string>} jar  cookie name → value; the session is the cookies
 * @property {number|string|null} supplierId  numeric supplier id, e.g. 4647393
 * @property {string|null} supplierIdentifier  the 5-character slug, e.g. "e18ek"; sent as the `identifier` header
 * @property {{ log: Function, warn?: Function }} [logger]
 */

/**
 * POST /api/container/supplier/prefetch-supply-data → the call that maps the
 * slug to the numeric id. The ONLY source: supplier/config carries feature
 * flags and no ids at all.
 * @typedef {object} SupplyData
 * @property {{ decodedToken: { email: string, user_id: string, supplier_identifiers: string[], supplier_identifier_to_id_mapping: Record<string, number> }, isAuthenticated: boolean }} registrationStatus
 * @property {{ supplier_id: number, name: string, identifier: string }} supplier
 */

// ── fetchReturnClaims (global AWB search) ────────────────────────────────────

/**
 * One row of the Returns search, normalised by searchReturnClaims().
 * @typedef {object} AccountReturn
 * @property {string|null} awb  the CMS AWB number
 * @property {string|null} orderNumber  "3216302445191…"
 * @property {string|null} subOrderNumber  "3216302445191…_1" — what the ticket is keyed on
 * @property {string|null} subOrderIdentifier  "…_1_return_919569291"
 * @property {string|null} type  "RET"
 * @property {string|null} subType  "FIRST_RET"
 * @property {string|null} shipmentStatus  "Delivered"
 * @property {string|null} createdDate  ISO with offset
 * @property {string|null} deliveredDate  ISO with offset — the date the 7-day claim window runs from
 * @property {string|null} carrierName  "Delhivery"
 * @property {string|null} returnReason
 * @property {string|null} detailedReason
 * @property {object|null} product  name, sku, meesho_pid, quantity, price, category, image_urls[]
 * @property {object} raw  the row exactly as Meesho returned it
 */

// ── Support form vocabulary ──────────────────────────────────────────────────

/**
 * fetchSubCategory → sub_categories[].
 * @typedef {object} MeeshoSubCategory
 * @property {number} sub_category_id  1 = wrong return, 2 = missing items, 3 = damaged return
 * @property {string} sub_category_title  what the CMS calls typeOfClaim
 * @property {string} description  prose, and where the claim window is stated
 * @property {number} tat  SUPPORT response time in hours (168), NOT the claim window
 * @property {string} tatMessage  "Meesho support agent will share an update within 3 hours"
 * @property {object[]} [description_schema]
 */

/**
 * subcategorySchema → schema[]: the ticket form, field by field. `action_*`
 * types are the ones validateTicketField checks.
 * @typedef {object} TicketFormField
 * @property {string} key  sub_order_number | awb_number | packet_state | barcode_id | …
 * @property {string} label  "Sub Order Number"
 * @property {string} type  action_single_text_box | drop_down | img_file | action_img_file | video_file | text_area | text_box | text
 * @property {boolean} req
 * @property {{ req: string }} [errMsg]
 * @property {{ value: string, label: string, default_select?: boolean }[]} [options]
 */

// ── Attachments ──────────────────────────────────────────────────────────────

/**
 * POST /api/experience/support/api/v1/upload/supplier-support/input-attachment
 * Multipart with TWO fields: the file, and `entity_type` (SupportEntityType —
 * "SUPPLIER" for an upload the seller makes). Without the second, Meesho
 * answers 400 "Required SupportEntityType parameter 'entity_type' is not
 * present". The `url` is what goes in a ticket_details value array.
 * @typedef {object} UploadResponse
 * @property {string} url  https://gcs-supl-…googleapis.com/TicketInputAttachments/<supplierId>/<epochMs>/<filename>
 * @property {boolean} is_valid
 * @property {{ error_message: string, field_name: string }[]|null} errors
 */

// ── validateTicketField / createTicket ───────────────────────────────────────

/**
 * One entry of `ticket_details`, in both validateTicketField and createTicket.
 * @typedef {object} TicketDetail
 * @property {string} key
 * @property {string} type
 * @property {string} label
 * @property {string|string[]} value  a string, or an array of uploaded URLs
 * @property {string} [selectedLabel]  drop_down only: the Title Case label beside the lowercase value
 */

/**
 * validateTicketField, normalised by validateTicketField().
 * @typedef {object} TicketFieldValidation
 * @property {boolean} isValid
 * @property {{ message: string, field: string|null }[]} errors
 * @property {object} raw  { is_valid, errors, success, interaction_key }
 */

/**
 * createTicket, normalised by createTicket(). A REFUSAL is an HTTP 200 with
 * is_valid false and errors[] — it throws rather than returning this.
 * @typedef {object} CreatedTicket
 * @property {string|null} ticketId  12-digit id, e.g. "789478393183"
 * @property {string|null} message  ticket_creation_message
 * @property {string|null} ticketType  "Created"
 * @property {object} raw
 */

// ── searchTickets ────────────────────────────────────────────────────────────

/**
 * searchTickets → results[]. The same shape fetchAllTickets returns.
 * @typedef {object} MeeshoTicket
 * @property {number} ticket_id
 * @property {string} title  the sub-category title
 * @property {string} description  HTML, as submitted
 * @property {string} status  "Open" | "Pending" | "In Progress" | "Closed"
 * @property {number} supplier_id
 * @property {number} supplier_support_sub_category_id
 * @property {string} created_at  "2026-09-15T18:49:54"
 * @property {string} modified_at
 * @property {string} estimated_response_time  created_at + tat hours
 * @property {number} reopen_count
 * @property {string} ticket_type  "Created"
 * @property {boolean} read
 */

// ── fileMeeshoClaim ──────────────────────────────────────────────────────────

/**
 * What fileMeeshoClaim() resolves with.
 * @typedef {object} FiledMeeshoClaim
 * @property {string} ticketId
 * @property {boolean} alreadyExisted
 * @property {string|null} cmsStatus  set only for a ticket that already existed
 * @property {string|null} meeshoStatus
 */

module.exports = {};
