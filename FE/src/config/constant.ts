import type { Claim, ECommercePlatform } from "@/types/platform";
import type { PermissionMap } from "@/types/common";

export const COLORS = [
  "#00B3E6",
  "#E6B333",
  "#6680B3",
  "#66991A",
  "#E6331A",
  "#33FFCC",
  "#4D8000",
  "#B33300",
  "#66664D",
  "#4DB3FF",
  "#1AB399",
  "#E666B3",
  "#CC9999",
  "#B3B31A",
  "#4D8066",
  "#E6FF80",
  "#1AFF33",
  "#999933",
  "#FF3380",
  "#4D80CC",
  "#9900B3",
  "#99E6E6",
  "#6666FF",
  "#FF6633",
  "#FFB399",
  "#FF33FF",
  "#999966",
  "#99FF99",
  "#B34D4D",
  "#E6B3B3",
  "#FF99E6",
];

// export const COLORS = [
//     "#FF5733", "#33FF57", "#3357FF", "#F3FF33", "#FF33A8",
//     "#33FFF6", "#FFB833", "#B833FF", "#33FF33", "#FF3333",
//     "#1C1C1C", "#E6E6E6", "#FFCC00", "#00CCFF", "#FF0066",
//     "#6600CC", "#CCFF00", "#FF3300", "#00FF33", "#0033FF",
//     "#8B4513", "#A0522D", "#FF7F50", "#FFD700", "#8A2BE2",
//     "#5F9EA0", "#FF4500", "#32CD32", "#7B68EE", "#FF69B4",
//     "#2F4F4F", "#D3D3D3", "#FF1493", "#1E90FF", "#FFDAB9",
//     "#B22222", "#4682B4", "#D2691E", "#ADFF2F", "#FF8C00",
//     "#191970", "#F0E68C", "#7FFF00", "#DC143C", "#8B0000",
//     "#4169E1", "#FFB6C1", "#A52A2A", "#20B2AA", "#FF6347"
// ];

export const PERMISSIONS: PermissionMap = {
  vms: {
    view: false,
    edit: false,
  },
  video_link: {
    view: false,
    edit: false,
  },
  cms: {
    view: false,
    edit: false,
  },
  rms: {
    view: false,
    edit: false,
  },
  accounts: {
    view: false,
    edit: false,
    my_usage: {
      view: false,
      edit: false,
    },
    purchase_history: {
      view: false,
      edit: false,
    },
    credit_history: {
      view: false,
      edit: false,
    },
    plan: {
      view: false,
      edit: false,
    },
    tds_reimbursement: {
      view: false,
      edit: false,
    },
  },
  favorite: {
    view: false,
    edit: false,
  },
  feed: {
    view: false,
    edit: false,
  },
  manage_users: {
    view: false,
    edit: false,
  },
  manage_roles: {
    view: false,
    edit: false,
  },
  external_imports: {
    view: false,
    edit: false,
  },
  master_data: {
    view: false,
    edit: false,
  },
  sku_data: {
    view: false,
    edit: false,
  },
  profile: {
    view: false,
    edit: false,
  },
  settings: {
    view: false,
    edit: false,
  },
  support: {
    view: false,
    edit: false,
  },
  email: {
    view: false,
    edit: false,
    mailbox: {
      view: false,
      edit: false,
    },
  },
  whats_new: {
    view: false,
    edit: false,
  },



};

export const percentageOptions: { label: string; value: string }[] = [
  { label: "Similar", value: "similar" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

export const eCommercePlatformOptions: { label: string; value: string }[] = [
  { label: "Ajio", value: "ajio" },
  { label: "Myntra", value: "myntra" },
  { label: "Amazon", value: "amazon" },
  { label: "Flipkart", value: "flipkart" },
  { label: "Delhivery", value: "delhivery" },
  { label: "Xbees", value: "xbees" },
];

export const importTypeOptions: { label: string; value: string }[] = [
  { label: "Return", value: "return" },
  { label: "Forward", value: "forward" },
];

export const DefaultECommercePlatforms: ECommercePlatform[] = [
  {
    name: "Flipkart",
    typeOfClaims: [
      // Main product
      {
        name: "One of the components was missing from product",
        description: "One of the components was missing from product",
        key: "component_missing_from_product",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "Product returned is not working (applicable only for electronic devices)",
        description: "Product returned is not working (applicable only for electronic devices)",
        key: "product_not_working",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "I received a fake Product",
        description: "I received a fake Product",
        key: "fake_product",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "I received a damaged product",
        description: "I received a damaged product",
        key: "damaged_product",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "Product was missing from the received return",
        description: "Product was missing from the received return",
        key: "product_missing_from_return",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "Product returned was seal broken",
        description: "Product returned was seal broken",
        key: "seal_broken",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "I received the return product with missing Tag",
        description: "I received the return product with missing Tag",
        key: "missing_tag",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "I received a wrong product",
        description: "I received a wrong product",
        key: "wrong_product",
        parentSelection: "Main product",
        isDisable: false,
      },
      {
        name: "I received a used product",
        description: "I received a used product",
        key: "used_product",
        parentSelection: "Main product",
        isDisable: false,
      },
      // Packaging
      {
        name: "Packaging was damaged for Return order",
        description: "Packaging was damaged for Return order",
        key: "packaging_damaged",
        parentSelection: "Packaging",
        isDisable: false,
      },
      // Accessory
      {
        name: "I received a damaged accessory",
        description: "I received a damaged accessory",
        key: "damaged_accessory",
        parentSelection: "Accessory",
        isDisable: false,
      },
      {
        name: "Accessory was missing from the returned shipment",
        description: "Accessory was missing from the returned shipment",
        key: "accessory_missing",
        parentSelection: "Accessory",
        isDisable: false,
      },
      {
        name: "I received a wrong accessory in return",
        description: "I received a wrong accessory in return",
        key: "wrong_accessory",
        parentSelection: "Accessory",
        isDisable: false,
      },
      // Freebie
      {
        name: "I received a fake Freebie in return",
        description: "I received a fake Freebie in return",
        key: "fake_freebie",
        parentSelection: "Freebie",
        isDisable: false,
      },
      {
        name: "Freebie was missing from returned order",
        description: "Freebie was missing from returned order",
        key: "freebie_missing",
        parentSelection: "Freebie",
        isDisable: false,
      },
      {
        name: "I received a damaged freebie",
        description: "I received a damaged freebie",
        key: "damaged_freebie",
        parentSelection: "Freebie",
        isDisable: false,
      },
      // Combo product
      {
        name: "More than one products from combo were damaged",
        description: "More than one products from combo were damaged",
        key: "combo_multiple_damaged",
        parentSelection: "Combo product",
        isDisable: false,
      },
      {
        name: "More than one products from combo were fake",
        description: "More than one products from combo were fake",
        key: "combo_multiple_fake",
        parentSelection: "Combo product",
        isDisable: false,
      },
      {
        name: "More than one products from combo were missing",
        description: "More than one products from combo were missing",
        key: "combo_multiple_missing",
        parentSelection: "Combo product",
        isDisable: false,
      },
      {
        name: "One of my products from combo was damage",
        description: "One of my products from combo was damage",
        key: "combo_one_damaged",
        parentSelection: "Combo product",
        isDisable: false,
      },
      {
        name: "I received a fake product",
        description: "I received a fake product",
        key: "combo_fake_product",
        parentSelection: "Combo product",
        isDisable: false,
      },
      {
        name: "One of the products from combo was missing",
        description: "One of the products from combo was missing",
        key: "combo_one_missing",
        parentSelection: "Combo product",
        isDisable: false,
      },
    ],
  },
  {
    name: "Tata CliQ",
    /**
     * The seller portal's QC-failure vocabulary, as a cascade.
     *
     * `parentSelection` IS THE PORTAL'S REASON, verbatim — the form shows it as
     * "Reason Of QC Failure" and the automation resolves it straight to the
     * portal's code ("Wrong Product" -> "10"), so a parent that is not one of
     * these twelve cannot be filed. Spelled exactly as the portal spells them.
     *
     * ALL TWELVE ARE HERE. This list held four of them, so eight of the
     * portal's reasons could not be chosen at all on the create form — a
     * damaged box, a missing accessory, an open seal had nowhere to go.
     *
     * THE CHILDREN OF "Wrong Product" ARE NOT FREE TEXT: it is the one reason
     * the portal asks a second question for, and it offers exactly four
     * answers, so the four claim types under it ARE those answers. The other
     * eleven take no sub-reason — the portal's own page clears that select for
     * them — so their children describe the case in TrackVid's own words.
     *
     * Kept in step with TrackVid-BE's `DefaultClaimsTataCliq`, which seeds the
     * same catalogue onto a company: this is the copy the create form renders
     * before a company has been seeded, and two catalogues that disagree is an
     * operator picking a claim type the server then refuses.
     */
    typeOfClaims: [
      // ── Wrong Product ─────────────────────────────────────────────────────
      {
        name: "Other brand delivered",
        description: "A product of a different brand came back in the return",
        key: "tatacliq_wrong_other_brand",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Local product delivered",
        description: "An unbranded or counterfeit local product came back",
        key: "tatacliq_wrong_local_product",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Same brand but different SKU delivered",
        description: "Our own brand, but the wrong article",
        key: "tatacliq_wrong_same_brand_sku",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Same brand but different size delivered",
        description: "The right article in the wrong size",
        key: "tatacliq_wrong_same_brand_size",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      // ── Product Carrier Damage - In-transit damage by Logistic partner ────
      {
        name: "Damaged in transit by the logistics partner",
        description: "Product Carrier Damage - In-transit damage by Logistic partner",
        key: "carrier_damage",
        parentSelection: "Product Carrier Damage - In-transit damage by Logistic partner",
        isDisable: false,
      },
      // ── Used Product ──────────────────────────────────────────────────────
      {
        name: "I received a used product",
        description: "I received a used product",
        key: "used_product",
        parentSelection: "Used Product",
        isDisable: false,
      },
      // ── Damaged Product ───────────────────────────────────────────────────
      {
        name: "I received a damaged product",
        description: "I received a damaged product",
        key: "damaged_product",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Product returned is not working (applicable only for electronic devices)",
        description: "Product returned is not working (applicable only for electronic devices)",
        key: "product_not_working",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      // ── Damaged Box ───────────────────────────────────────────────────────
      {
        name: "Packaging was damaged for Return order",
        description: "Packaging was damaged for Return order",
        key: "packaging_damaged",
        parentSelection: "Damaged Box",
        isDisable: false,
      },
      // ── Missing Box ───────────────────────────────────────────────────────
      {
        name: "Box was missing from returned shipment",
        description: "Box was missing from returned shipment",
        key: "missing_box",
        parentSelection: "Missing Box",
        isDisable: false,
      },
      // ── Missing Accessories ───────────────────────────────────────────────
      {
        name: "One of the components was missing from product",
        description: "One of the components was missing from product",
        key: "component_missing_from_product",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      {
        name: "I received a damaged accessory",
        description: "I received a damaged accessory",
        key: "damaged_accessory",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      {
        name: "Accessory was missing from the returned shipment",
        description: "Accessory was missing from the returned shipment",
        key: "accessory_missing",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      {
        name: "I received a wrong accessory in return",
        description: "I received a wrong accessory in return",
        key: "wrong_accessory",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      {
        name: "I received a fake Freebie in return",
        description: "I received a fake Freebie in return",
        key: "fake_freebie",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      {
        name: "Freebie was missing from returned order",
        description: "Freebie was missing from returned order",
        key: "freebie_missing",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      {
        name: "I received a damaged freebie",
        description: "I received a damaged freebie",
        key: "damaged_freebie",
        parentSelection: "Missing Accessories",
        isDisable: false,
      },
      // ── Missing Product/Empty Box ─────────────────────────────────────────
      {
        name: "Product was missing from the received return",
        description: "Product was missing from the received return",
        key: "product_missing_from_return",
        parentSelection: "Missing Product/Empty Box",
        isDisable: false,
      },
      // ── Partial Product ───────────────────────────────────────────────────
      {
        name: "More than one products from combo were damaged",
        description: "More than one products from combo were damaged",
        key: "combo_multiple_damaged",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "More than one products from combo were missing",
        description: "More than one products from combo were missing",
        key: "combo_multiple_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "One of my products from combo was damage",
        description: "One of my products from combo was damage",
        key: "combo_one_damaged",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "One of the products from combo was missing",
        description: "One of the products from combo was missing",
        key: "combo_one_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      // ── Seal Open ─────────────────────────────────────────────────────────
      {
        name: "Product returned was seal broken",
        description: "Product returned was seal broken",
        key: "seal_broken",
        parentSelection: "Seal Open",
        isDisable: false,
      },
      // ── Delivered but not received ────────────────────────────────────────
      {
        name: "Order marked as delivered but not received",
        description: "Order marked as delivered but not received",
        key: "delivered_not_received",
        parentSelection: "Delivered but not received",
        isDisable: false,
      },
      // ── Price Mismatch ────────────────────────────────────────────────────
      {
        name: "Price charged does not match the order",
        description: "Price charged does not match the order",
        key: "price_mismatch",
        parentSelection: "Price Mismatch",
        isDisable: false,
      },
    ],
  },
  {
    name: "Amazon",
    typeOfClaims: [
      // ── "I received damaged/ used item" ────────────────────────────────
      {
        name: "Product heavily damaged",
        description: "The returned product is heavily damaged and unfit for resale.",
        key: "product_heavily_damaged",
        isDisable: false,
        parentSelection: "I received damaged/ used item",
      },
      {
        name: "Product with minor damaged/dents/scratches",
        description: "The returned product shows minor damage such as dents or scratches.",
        key: "product_minor_damaged",
        isDisable: false,
        parentSelection: "I received damaged/ used item",
      },
      {
        name: "Only product packaging damaged",
        description: "Only the outer packaging is damaged; the product itself is intact.",
        key: "only_packaging_damaged",
        isDisable: false,
        parentSelection: "I received damaged/ used item",
      },
      {
        name: "Item received with open seal",
        description: "The item's factory seal was already broken when the return arrived.",
        key: "item_open_seal",
        isDisable: false,
        parentSelection: "I received damaged/ used item",
      },
      {
        name: "Mildly used product received",
        description: "The returned product shows mild signs of use.",
        key: "mildly_used_product",
        isDisable: false,
        parentSelection: "I received damaged/ used item",
      },
      {
        name: "Heavily used product received",
        description: "The returned product shows heavy signs of use.",
        key: "heavily_used_product",
        isDisable: false,
        parentSelection: "I received damaged/ used item",
      },

      // ── "I received different item/ empty box" ────────────────────────
      {
        name: "Different item received",
        description: "The return contained a completely different item than what was originally sent.",
        key: "different_item_received",
        isDisable: false,
        parentSelection: "I received different item/ empty box",
      },
      {
        name: "Empty box received",
        description: "The return package was an empty box with no product inside.",
        key: "empty_box_received",
        isDisable: false,
        parentSelection: "I received different item/ empty box",
      },
      {
        name: "Fake/ replica/ counterfeit item received",
        description: "The returned item is a fake, replica, or counterfeit of the original product.",
        key: "counterfeit_item_received",
        isDisable: false,
        parentSelection: "I received different item/ empty box",
      },

      // ── "I received item with missing parts/ accessories or incorrect quantity" ──
      {
        name: "Missing parts/ accessories/ components",
        description: "The returned item is missing parts, accessories, or components.",
        key: "missing_parts_accessories",
        isDisable: false,
        parentSelection:
          "I received item with missing parts/ accessories or incorrect quantity",
      },
      {
        name: "Main product missing",
        description: "The main product itself is missing from the returned package.",
        key: "main_product_missing",
        isDisable: false,
        parentSelection:
          "I received item with missing parts/ accessories or incorrect quantity",
      },
      {
        name: "Missing quantity",
        description: "The returned package contains fewer units than expected.",
        key: "missing_quantity",
        isDisable: false,
        parentSelection:
          "I received item with missing parts/ accessories or incorrect quantity",
      },

      // ── "I did not receive the return" ─────────────────────────────────
      {
        name: "Item was refunded but not returned to me",
        description: "The buyer was refunded but the item was never returned to me.",
        key: "refunded_not_returned",
        isDisable: false,
        parentSelection: "I did not receive the return",
      },
      {
        name: "Replacement sent to buyer but original item wasn't received",
        description: "A replacement was sent to the buyer but the original item was never received back.",
        key: "replacement_sent_original_not_received",
        isDisable: false,
        parentSelection: "I did not receive the return",
      },
      {
        name: "Item was refunded but replacement item not received",
        description: "The buyer was refunded but the promised replacement item was never received.",
        key: "refunded_replacement_not_received",
        isDisable: false,
        parentSelection: "I did not receive the return",
      },
      {
        name: "Dispute return delivery status",
        description: "The return delivery status shown by Amazon is being disputed.",
        key: "dispute_return_delivery_status",
        isDisable: false,
        parentSelection: "I did not receive the return",
      },

      // ── "The buyer was refunded out of policy" ─────────────────────────
      {
        name: "Digital order with code used by buyer (open software/ media)",
        description: "The digital order code has already been used by the buyer, or the media/software was opened.",
        key: "digital_code_used",
        isDisable: false,
        parentSelection: "The buyer was refunded out of policy",
      },
      {
        name: "Non-returnable item (including customized) but buyer was refunded out of policy",
        description: "A non-returnable or customized item was refunded to the buyer outside Amazon's policy.",
        key: "non_returnable_refunded",
        isDisable: false,
        parentSelection: "The buyer was refunded out of policy",
      },
    ],
  },
  {
    name: "Myntra",
    /**
     * Kept in step with TrackVid-BE's `DefaultClaimsMyntra`, which seeds the
     * same catalogue onto a company. The keys ARE the contract: MyntraForm,
     * EditCmsFieldsModal and cms-create.validation all branch on
     * `partial_return` (asks for Disputed Amount) and
     * `wrong_returns_own_product` (asks for Physical Received SKU). The
     * previous list here predated those keys, so a company reset from this
     * file could not produce either claim and both fields were unreachable.
     */
    typeOfClaims: [
      {
        name: "Damaged Returns",
        description: "The returned item is damaged, with clear signs of wear or breakage, making it unsuitable for restocking or resale.",
        key: "damaged_returns",
        isDisable: false,
      },
      {
        name: "Stained Returns",
        description: "The returned item came back stained or soiled and cannot be resold.",
        key: "stained_returns",
        isDisable: false,
      },
      {
        name: "Box Damaged",
        description: "The outer box of the returned shipment arrived damaged.",
        key: "box_damaged",
        isDisable: false,
      },
      {
        name: "Shortage in Return",
        description: "The returned package contains fewer items than originally sent.",
        key: "shortage_in_return",
        isDisable: false,
      },
      {
        name: "Empty Box",
        description: "We have received a return of an empty box with no product inside.",
        key: "empty_box",
        isDisable: false,
      },
      {
        name: "Fake Returns",
        description: "The returned item is counterfeit and is not the product that was originally shipped.",
        key: "fake_returns",
        isDisable: false,
      },
      {
        name: "Partial Return",
        description: "We received a partial return, with only some of the articles from the original order included, missing several items.",
        key: "partial_return",
        isDisable: false,
      },
      {
        name: "Wrong Returns-Received other seller's product",
        description: "A return item belongs to a different seller than what was originally sent out.",
        key: "wrong_returns_other_seller_product",
        isDisable: false,
      },
      {
        name: "Wrong Returns-Received own product",
        description: "The return includes one of our own products, but it differs from the original item shipped.",
        key: "wrong_returns_own_product",
        isDisable: false,
      },
      {
        name: "Used Returns",
        description: "The returned item shows signs of use and is not in resaleable condition.",
        key: "used_returns",
        isDisable: false,
      },
    ],
  },
  {
    name: "Ajio",
    // Claim names must exactly match the AJIO portal claim-reason dropdown
    // option text (uppercase, as shown on the seller portal) — the puppeteer
    // script picks the option by text equality.
    typeOfClaims: [
      {
        name: "SHORT QUANTITY",
        description: "The returned package contains fewer items than originally sent.",
        key: "short_quantity",
        isDisable: false,
      },
      {
        name: "EMPTY BOX RECEIVED",
        description: "We have received a return of an empty box with no product inside.",
        key: "empty_box_received",
        isDisable: false,
      },
      {
        name: "PARTIAL ARTICLES RECEIVED",
        description: "We received a partial return, with only some of the articles from the original order included, missing several items.",
        key: "partial_articles_received",
        isDisable: false,
      },
      {
        name: "DIFFERENT BRAND PRODUCT RECEIVED",
        description: "A return item belongs to a different brand than what was originally sent out.",
        key: "different_brand_product",
        isDisable: false,
      },
      {
        name: "SAME BRAND PRODUCT RECEIVED (ARTICLE NOT AS PER DOCUMENT)",
        description: "The return includes a product from the same brand, but it differs from the original item shipped in style.",
        key: "same_brand_product",
        isDisable: false,
      },
      {
        name: "DAMAGE PRODUCT RECEIVED",
        description: "The returned item is damaged, with clear signs of wear or breakage, making it unsuitable for restocking or resale.",
        key: "damaged_product",
        isDisable: false,
      },
    ],
  },
  {
    name: "Meesho",
    typeOfClaims: [
      {
        name: "Partial Articles Received",
        description: "We received a partial return, with only some of the articles from the original order included, missing several items.",
        key: "partial_articles_received",
        isDisable: false,
      },
      {
        name: "Empty Box Received",
        description: "We have received a return of an empty box with no product inside.",
        key: "empty_box_received",
        isDisable: false,
      },
      {
        name: "Short Quantity",
        description: "The returned package contains fewer items than originally sent.",
        key: "short_quantity",
        isDisable: false,
      },
      {
        name: "Different Brand Product",
        description: "A return item belongs to a different brand than what was originally sent out.",
        key: "different_brand_product",
        isDisable: false,
      },
      {
        name: "Same Brand Product",
        description: "The return includes a product from the same brand, but it differs from the original item shipped in style.",
        key: "same_brand_product",
        isDisable: false,
      },
      {
        name: "Damaged Product",
        description: "The returned item is damaged, with clear signs of wear or breakage, making it unsuitable for restocking or resale.",
        key: "damaged_product",
        isDisable: false,
      },
    ],
  },
  {
    name: "Nykaa",
    // Mirrors DefaultClaimsNykaa in TrackVid-BE src/constants/common.ts —
    // keep the two in step. Names go to the Nykaa portal verbatim as the
    // ticket Issue, so the "Recieved" misspelling is intentional.
    typeOfClaims: [
      { name: "Damaged / Defective Product Recieved", description: "", key: "damaged_defective_product_received", isDisable: false },
      { name: "Used Product Recieved", description: "", key: "used_product_received", isDisable: false },
      { name: "Incomplete / Partial Product Received", description: "", key: "incomplete_partial_product_received", isDisable: false },
      { name: "Wrong Product Returned - Same Brand", description: "", key: "wrong_product_same_brand", isDisable: false },
      { name: "Wrong Product Returned - Other brand Product", description: "", key: "wrong_product_other_brand", isDisable: false },
      { name: "Empty Parcel Received", description: "", key: "empty_parcel_received", isDisable: false },
      { name: "I want a report", description: "", key: "i_want_a_report", isDisable: false },
      { name: "Wrong Product Returned - Local Product", description: "", key: "wrong_product_local_product", isDisable: false },
      { name: "Delivered but Not Received", description: "", key: "delivered_but_not_received", isDisable: false },
      { name: "Others", description: "", key: "others", isDisable: false },
    ],
  },
  {
    name: "Delhivery",
    // Flat "Claim type" list — no parentSelection cascade. The CreateCms
    // page hides the Issue Area dropdown when parentSelectionOptions is empty
    // so this becomes a single "Type Of Claim" dropdown.
    typeOfClaims: [
      {
        name: "Received used or damaged product",
        description: "Received a used or damaged product.",
        key: "received_used_or_damaged_product",
        isDisable: false,
      },
      {
        name: "Received wrong product",
        description: "Received a wrong product.",
        key: "received_wrong_product",
        isDisable: false,
      },
      {
        name: "Item missing or received empty box",
        description: "Item is missing or the parcel arrived as an empty box.",
        key: "item_missing_or_empty_box",
        isDisable: false,
      },
      {
        name: "Did not receive the shipment (POD needed)",
        description: "Shipment was not received; Proof of Delivery is needed.",
        key: "shipment_not_received_pod_needed",
        isDisable: false,
      },
    ],
  },
  {
    name: "Xbees",
    typeOfClaims: [
      // ── "TAT Failure" ─────────────────────────────────────────────────
      {
        name: "Delivered after TAT",
        description: "Shipment was delivered after the agreed TAT.",
        key: "delivered_after_tat",
        parentSelection: "TAT Failure",
        isDisable: false,
      },

      // ── "Seal Open" ───────────────────────────────────────────────────
      {
        name: "Seal Open",
        description: "Product seal was found open on delivery.",
        key: "seal_open",
        parentSelection: "Seal Open",
        isDisable: false,
      },

      // ── "Partial Product" ─────────────────────────────────────────────
      {
        name: "Accessories missing",
        description: "One or more accessories were missing from the returned shipment.",
        key: "accessories_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "MRP tag missing",
        description: "MRP tag was missing on the returned product.",
        key: "mrp_tag_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "Brand tag missing",
        description: "Brand tag was missing on the returned product.",
        key: "brand_tag_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "Partial Product Picked",
        description: "Only part of the ordered product was picked in the return.",
        key: "partial_product_picked",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "Qty missing",
        description: "Quantity in the returned shipment is less than expected.",
        key: "qty_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },
      {
        name: "Brand box missing",
        description: "Original brand box was missing from the returned shipment.",
        key: "brand_box_missing",
        parentSelection: "Partial Product",
        isDisable: false,
      },

      // ── "Empty Box" ───────────────────────────────────────────────────
      {
        name: "Empty Parcel Delivered",
        description: "The delivered parcel was empty with no product inside.",
        key: "empty_parcel_delivered",
        parentSelection: "Empty Box",
        isDisable: false,
      },

      // ── "Damaged Product" ─────────────────────────────────────────────
      {
        name: "Product Damaged In-transit",
        description: "Product was damaged during transit.",
        key: "product_damaged_in_transit",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Screen broken product received",
        description: "Product received had a broken screen.",
        key: "screen_broken_product_received",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Mobile body damage",
        description: "Mobile body damage found on the returned product.",
        key: "mobile_body_damage",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Volume button damage",
        description: "Volume button was damaged on the returned product.",
        key: "volume_button_damage",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Scratch on product",
        description: "Scratch marks were found on the returned product.",
        key: "scratch_on_product",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Dead phone delivered",
        description: "A non-functional (dead) phone was delivered.",
        key: "dead_phone_delivered",
        parentSelection: "Damaged Product",
        isDisable: false,
      },
      {
        name: "Brand Box damage",
        description: "Brand box was damaged on the returned product.",
        key: "brand_box_damage",
        parentSelection: "Damaged Product",
        isDisable: false,
      },

      // ── "POD Issue" ───────────────────────────────────────────────────
      {
        name: "POD missing",
        description: "Proof of Delivery is missing for the shipment.",
        key: "pod_missing",
        parentSelection: "POD Issue",
        isDisable: false,
      },

      // ── "Used Product" ────────────────────────────────────────────────
      {
        name: "Dirty product picked",
        description: "A dirty product was picked in the return.",
        key: "dirty_product_picked",
        parentSelection: "Used Product",
        isDisable: false,
      },
      {
        name: "Stain on the product",
        description: "Stains were found on the returned product.",
        key: "stain_on_product",
        parentSelection: "Used Product",
        isDisable: false,
      },

      // ── "Wrong Product" ───────────────────────────────────────────────
      {
        name: "Wrong Product Picked",
        description: "A wrong product was picked in the return.",
        key: "wrong_product_picked",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Wrong Product Interchanged",
        description: "Products were interchanged during pickup.",
        key: "wrong_product_interchanged",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Wrong Size",
        description: "A product of wrong size was received.",
        key: "wrong_size",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Wrong color",
        description: "A product of wrong color was received.",
        key: "wrong_color",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Wrong SKU",
        description: "A product with a wrong SKU was received.",
        key: "wrong_sku",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Wrong IMEI",
        description: "A device with a wrong IMEI was received.",
        key: "wrong_imei",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Wrong EAN",
        description: "A product with a wrong EAN code was received.",
        key: "wrong_ean",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Dummy product",
        description: "A dummy / placeholder product was received.",
        key: "dummy_product",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Product image not match",
        description: "The returned product does not match the product image.",
        key: "product_image_not_match",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
      {
        name: "Serial number mismatch",
        description: "Serial number of the returned product does not match records.",
        key: "serial_number_mismatch",
        parentSelection: "Wrong Product",
        isDisable: false,
      },
    ],
  },
];

export const DefaultClaims: Claim[] = [
  {
    name: "Partial Articles Received",
    description: "We received a partial return, with only some of the articles from the original order included, missing several items.",
    key: "partial_articles_received",
    isDisable: false,
  },
  {
    name: "Empty Box Received",
    description: "We have received a return of an empty box with no product inside.",
    key: "empty_box_received",
    isDisable: false,
  },
  {
    name: "Short Quantity",
    description: "The returned package contains fewer items than originally sent.",
    key: "short_quantity",
    isDisable: false,
  },
  {
    name: "Different Brand Product",
    description: "A return item belongs to a different brand than what was originally sent out.",
    key: "different_brand_product",
    isDisable: false,
  },
  {
    name: "Same Brand Product",
    description: "The return includes a product from the same brand, but it differs from the original item shipped in style.",
    key: "same_brand_product",
    isDisable: false,
  },
  {
    name: "Damaged Product",
    description: "The returned item is damaged, with clear signs of wear or breakage, making it unsuitable for restocking or resale.",
    key: "damaged_product",
    isDisable: false,
  },
];

export const CMS_STATUS = {
  PENDING: "Pending",
  IN_REVIEW: "In Review",
  UN_ATTENDED: "Un Attended",
  IN_PROGRESS: "In Progress",
  CUSTOMER_REPLIED: "Customer Replied",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RESOLVED: "Resolved",
  // Terminal auto-claim state, written by the BE when a claim's processCount
  // exceeds the retry cap (MAX_AUTO_CLAIM_ATTEMPTS in TrackVid-BE
  // src/constants/common.ts). Rows in this state are NOT re-fed to the
  // puppeteer worker — the operator must intervene (fix credentials / edit
  // the row / mark it resolved manually). Rendered on Manage SPF Claims as
  // its own tab right after "All", and its checkboxes stay hidden so ops
  // can't accidentally re-queue a capped row — TEMP_PERMIT lifts that gate
  // for the same per-browser escape hatch as the retry cap itself.
  FAILED_TO_PROCEED: "Failed to Proceed",
  // Myntra-only, written by the claim status-sync job. Their SPF lifecycle is
  //   OPEN → AWAITING_SELLER_RESPONSE → ACCEPT/REJECT
  //        → AWAITING_AGENT_RESPONSE → PAYMENT_COMPLETED
  // AWAITING_SELLER_RESPONSE means Myntra is blocked on us (someone must act);
  // AWAITING_AGENT_RESPONSE means their agent is working the payout; PAID is
  // the terminal success state that lets an Approved claim finish.
  AWAITING_SELLER_RESPONSE: "Awaiting Seller Response",
  AWAITING_AGENT_RESPONSE: "Awaiting Agent Response",
  PAID: "Paid",
  // Nykaa-only, written by the claim status-sync job. Their disputes are Zoho
  // Desk tickets and Zoho's lifecycle is reported as-is:
  //   OPEN — raised, nobody at Nykaa has picked it up yet
  //   ON_HOLD — Nykaa has parked it; a different chase from an untouched one
  //   CLOSED — the ticket is FINISHED, which is not the same as granted.
  // Closed and Resolved both used to be written as "Approved", so a claim
  // Nykaa had merely filed away read here as money paid.
  OPEN: "Open",
  ON_HOLD: "On Hold",
  CLOSED: "Closed",
};

export const MASTER_DATA = {
  GOOD: "Good",
  PENDING: "Pending",
  IN_REVIEW: "In Review",
  UN_ATTENDED: "Un Attended",
  IN_PROGRESS: "In Progress",
  CUSTOMER_REPLIED: "Customer Replied",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RESOLVED: "Resolved",
}

export const ORDER_STATUS = {
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
  RETURN_CREATED: "Return Created",
  RETURN_CANCELLED: "Return Cancelled",
  RETURN_DELIVERED: "Return Delivered",
  RETURN_NOT_DELIVERED: "Return Not Delivered",
  RETURN_DISPUTE: "Return Dispute",
  MARKETPLACE_DELIVERED: "Marketplace Delivered",
  PHYSICALLY_RETURN_RECEIVED: "Physically Return Received",
};

export const masterImportPlatformOptions: { label: string; value: string }[] = [
  { label: "AJIO", value: "AJIO" },
  { label: "Myntra", value: "MYNTRA" },
  { label: "Meesho", value: "MEESHO" },
  { label: "Flipkart", value: "flipkart" },
  { label: "Amazon", value: "amazon" },
  { label: "Snapdeal", value: "SNAPDEAL" },
  { label: "Delhivery", value: "delhivery" },
  { label: "Xbees", value: "xbees" },
  { label: "OTHER", value: "OTHER" },
];

/**
 * Mirrors the BE `MYNTRA_AUTOCLAIM_TIMEJOB` flag in TrackVid-BE/src/constants/common.ts.
 * When `true`, the backend runs the daily 15:00 IST Myntra Auto Claim cron.
 *
 * NOTE: the FE no longer reads this flag. Manage SPF Claims now hides the
 * manual "Auto Claim" button on the Snapdeal AND Myntra tabs unconditionally
 * (see AUTO_CLAIM_HIDDEN_PLATFORMS in pages/CMS.tsx), with TEMP_PERMIT as the
 * per-browser override. Kept here only so the BE flag stays documented on
 * this side; flip it in lock-step with its BE twin.
 */
export const MYNTRA_AUTOCLAIM_TIMEJOB = false;
export const UPDATE_EXISTED_CLAIM_FROM_CMS = false;

/**
 * Temporary override for the auto-claim retry cap (MAX_AUTO_CLAIM_ATTEMPTS in
 * CMS.tsx). Normally a claim that has been picked up 3+ times can no longer be
 * selected on Manage SPF Claims — its checkbox is disabled and the Attempts
 * badge turns red.
 *
 * Defaults to `false`; ops can turn it on per-browser without a deploy by
 * running `localStorage.setItem("tempPermit", "true")` in the console (e.g.
 * after fixing the root cause of a platform-wide script failure), and turn it
 * back off with `"false"` or by removing the key.
 * The red Attempts badge stays visible either way so the retry count is never
 * hidden — only the selection block is lifted.
 *
 * Read once at module load, so a change takes effect on the next page reload.
 */
const readTempPermit = (): boolean => {
  try {
    return localStorage.getItem("tempPermit") === "true";
  } catch {
    // Storage can be unavailable (private mode / blocked cookies) — fall back
    // to the safe default instead of breaking the module import.
    return false;
  }
};

export const TEMP_PERMIT = readTempPermit();

/**
 * Kill switch for save-and-dispatch on the Create Claim page.
 *
 * `true`  — platforms with an Automated-Scripts runner get a second toolbar
 *           button, "Create Ticket", which saves the claim AND queues the auto
 *           claim in one click. The row goes Queued → Running → Success/Failed,
 *           pushed to the grid over the existing `cms:script:progress` socket.
 * `false` — the toolbar is exactly as it was: "Save" only, and every create
 *           from this page sends `autoClaim: false`, so nothing is filed.
 *
 * SAFE TO FLIP WITHOUT A BE DEPLOY, BUT NOT BECAUSE THE BE IS UNREACHABLE.
 * It used to say that — "the auto-claim branch only ever fires on the flag this
 * button sends" — and that stopped being true when createCMS moved from opt-in
 * to opt-out. An omitted `autoClaim` now means "file it", so with this constant
 * false and nothing sent, plain Save went on filing claims the switch claimed
 * to have stopped. What makes it a real switch is that `useCreateCmsForm` now
 * sends `autoClaim: false` explicitly whenever this is off.
 *
 * THIS ONLY COVERS THIS PAGE. Any other caller of POST /cms/createCMS that
 * omits the flag still dispatches. The switch that covers the server, whatever
 * the caller, is `AUTO_CLAIM_ON_CREATE=false` in the BE env — use that one when
 * the goal is "stop filing claims", not this.
 *
 * Which platforms qualify is NOT decided here — that comes from
 * GET /cms/automation-platforms, sourced from the BE's
 * validations/claimAutomation.validation.ts, so the button and the dispatch
 * gate can never disagree about what is claimable.
 *
 * Unrelated to the manual Auto Claim button on /cms, which keeps working for
 * existing rows regardless of this flag.
 */
export const CLAIM_SAVE_AND_TICKET_CREATE = true;
