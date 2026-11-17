import * as yup from "yup";
import { PACKING_SIDES } from "@/types/cms-create";
import { needsSubReason, requiredQcImageSlots } from "@/features/cms-create/tatacliq-qc";

/** Port of TrackVid-FE `validations/cms-create.validation.ts` (same messages, same per-platform rules). */

const eitherVideoOrLink = () =>
  yup.mixed().test("either-video-or-link", "*Return Video is required", function () {
    const { returnVideo, returnVideoLink } = this.parent as { returnVideo?: string; returnVideoLink?: string };
    return Boolean(returnVideoLink || returnVideo);
  });

/** The form values of the nearest-but-one ancestor (the claim, for a field inside `myntraClaimDetails`). */
function claimOf(ctx: yup.TestContext): { typeOfClaim?: string } {
  const from = (ctx as unknown as { from?: { value: unknown }[] }).from;
  const value = from?.[1]?.value;
  return value && typeof value === "object" ? (value as { typeOfClaim?: string }) : {};
}

export const cmsValidation = (skus: string[]) =>
  yup.object().shape({
    eCommercePlatform: yup.string().required("*E-commerce platform is required"),
    AWBNumber: yup.string().required("*AWB number is required"),
    typeOfClaim: yup.string().required("*Type of claim is required"),
    returnVideo: yup.string(),
    returnVideoLink: yup.string(),
    skuName: skus.length > 0 ? yup.string().trim().required("Please select a SKU") : yup.string().nullable(),
    eitherVideoOrLink: eitherVideoOrLink(),
    returnProductImage: yup.mixed().required("*Return product image required"),
    forwardSentProductImage: yup.mixed(),
    podProof: yup.mixed(),
  });

export const flipkartCmsValidation = (skus: string[]) =>
  cmsValidation(skus)
    .shape({
      otherClaimDetails: yup.object().shape({
        claimArea: yup.string().required("*Claim area is required"),
        shippingLabelImage: yup.string().required("*Shipping label image is required"),
        packingImages: yup.array().of(yup.string()).min(3, "*At least three packing images are required").max(10, "*Maximum ten packing images allowed"),
      }),
    })
    .shape({ returnProductImage: yup.mixed() });

export const delhiveryCmsValidation = (skus: string[]) =>
  cmsValidation(skus)
    .shape({
      otherClaimDetails: yup.object().shape({
        domestic: yup.string().required("*Domestic is required"),
        subcategory: yup.string().required("*Subcategory is required"),
        shippingLabelImage: yup.string().required("*Shipping label image is required"),
        packingImages: yup.array().of(yup.string()).min(1, "*At least one evidence image is required").max(10, "*Maximum ten evidence images allowed"),
      }),
    })
    .shape({ returnProductImage: yup.mixed() });

export const xbeesCmsValidation = (skus: string[]) =>
  cmsValidation(skus)
    .shape({
      otherClaimDetails: yup.object().shape({
        packingImages: yup
          .array()
          .of(
            yup.object().shape({
              fileKey: yup.string().defined(),
              side: yup
                .mixed<(typeof PACKING_SIDES)[number]>()
                .oneOf([...PACKING_SIDES])
                .required(),
            }),
          )
          .test("xbees-four-slots", "*All four package photos (Top, Right, Bottom, Left) are required", (value) => {
            if (!value || value.length !== PACKING_SIDES.length) return false;
            const bySide = new Map(value.map((v) => [v?.side, v?.fileKey]));
            return PACKING_SIDES.every((s) => Boolean(bySide.get(s)?.trim()));
          }),
        disputeAmount: yup
          .string()
          .trim()
          .required("*Dispute amount is required")
          .test("dispute-amount-positive", "*Dispute amount must be a positive number", (value) => {
            if (value === undefined || value === "") return false;
            const n = Number(value);
            return Number.isFinite(n) && n > 0;
          }),
      }),
    })
    .shape({ returnProductImage: yup.mixed() });

export const tataCliqCmsValidation = (skus: string[]) =>
  cmsValidation(skus)
    .shape({
      otherClaimDetails: yup.object().shape({
        qcReason: yup.string().required("*QC failure reason is required"),
        qcSubReason: yup.string().when("qcReason", {
          is: (reason: string) => needsSubReason(reason),
          then: (schema) => schema.required("Pick the sub-reason — Tata CliQ requires one for Wrong Product"),
          otherwise: (schema) => schema.strip(),
        }),
        qcImages: yup.object().test(
          "required-slots",
          ({ value }) => {
            const images = (value || {}) as Record<string, string>;
            const missing = requiredQcImageSlots()
              .filter((slot) => !images[slot.key])
              .map((slot) => slot.label);
            return `*${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`;
          },
          (value) => {
            const images = (value || {}) as Record<string, string>;
            return requiredQcImageSlots().every((slot) => Boolean(images[slot.key]));
          },
        ),
        packagingVideoUrl: yup.string(),
        unboxingVideoUrl: yup.string(),
      }),
    })
    .shape({ returnProductImage: yup.mixed() });

export const amazonCmsValidation = (skus: string[]) =>
  cmsValidation(skus)
    .shape({
      otherClaimDetails: yup.object().shape({
        fulfillmentChannel: yup.string().required("*Fulfillment channel is required"),
        contentsOfReturnImages: yup.array().of(yup.string()).min(1, "*At least one photo of the return contents is required").max(2, "*Maximum two photos allowed"),
        shippingLabelImage: yup.string().required("*Shipping-label photograph is required"),
        serialNumberImage: yup.string(),
      }),
    })
    .shape({ returnProductImage: yup.mixed() });

const NON_BARCODED = "I have received an RTO in a non-barcoded package";
const POD_CLAIM = "Return/RTO product not received but marked delivered - Need Proof of Delivery";

export const meeshoCmsValidation = yup.object().shape({
  eCommercePlatform: yup.string().required("*E-commerce platform is required"),
  AWBNumber: yup.string().required("*AWB number is required"),
  typeOfClaim: yup.string().required("*Type of claim is required"),
  returnVideo: yup.string(),
  returnVideoLink: yup.string(),
  eitherVideoOrLink: eitherVideoOrLink(),
  receivedProductImage_1: yup.mixed().required("*Received product image is required"),
  reverseWayBillImage: yup.mixed().required("*Reverse waybill image is required"),
  barcodeImage: yup.mixed().when("typeOfClaimName", {
    is: (value: string | undefined) => value !== NON_BARCODED,
    then: (schema) => schema.required("*Barcode image is required"),
  }),
  subOrderNumber: yup.string().trim().required("*Sub order number is required"),
  stateOfThePacket: yup.string().trim().required("*State of the packet is required"),
  logisticsPartnerName: yup
    .string()
    .trim()
    .when("typeOfClaimName", {
      is: (value: string | undefined) => value === POD_CLAIM,
      then: (schema) => schema.required("*Logistics partner name is required"),
    }),
  packetId: yup
    .string()
    .trim()
    .when("typeOfClaimName", {
      is: (value: string | undefined) => value !== NON_BARCODED,
      then: (schema) => schema.required("*PacketID is required"),
    }),
});

export const myntraCmsValidation = yup.object().shape({
  eCommercePlatform: yup.string().required("*E-commerce platform is required"),
  AWBNumber: yup.string().required("*AWB number is required"),
  typeOfClaim: yup.string().required("*Type of claim is required"),
  returnVideo: yup.string(),
  returnVideoLink: yup.string(),
  eitherVideoOrLink: eitherVideoOrLink(),
  myntraClaimDetails: yup.object().shape({
    shippingLabelImage: yup.string().required("*Shipping label is required"),
    packingImages: yup
      .array()
      .of(yup.string())
      .test("min-one", "*At least one product & outer packing image is required", (value) => Boolean(value) && (value ?? []).filter(Boolean).length >= 1)
      .test("max-ten", "*Maximum 10 product & outer packing images allowed", (value) => !value || value.filter(Boolean).length <= 10),
    damagedProductVideo: yup.string(),
    damagedProductVideoLink: yup.string(),
    disputedAmount: yup
      .string()
      .test("disputed-amount-required", "*Disputed amount is required", function (value) {
        if (claimOf(this).typeOfClaim !== "partial_return") return true;
        return Boolean(value) && String(value).trim() !== "";
      })
      .test("disputed-amount-positive", "*Disputed amount must be a positive number", function (value) {
        if (claimOf(this).typeOfClaim !== "partial_return") return true;
        if (value === undefined || value === "") return true;
        const n = Number(value);
        return Number.isFinite(n) && n > 0;
      }),
    physicalReceivedSku: yup.string().test("physical-received-sku-required", "*Physical received SKU is required", function (value) {
      if (claimOf(this).typeOfClaim !== "wrong_returns_own_product") return true;
      return Boolean(value) && String(value).trim() !== "";
    }),
  }),
});

export const snapdealCmsValidation = yup.object().shape({
  eCommercePlatform: yup.string().required("*E-commerce platform is required"),
  AWBNumber: yup.string().required("*AWB number is required"),
  subOrderNumber: yup.string().trim(),
  typeOfClaim: yup.string().required("*Type of claim is required"),
  returnVideo: yup.string(),
  returnVideoLink: yup.string(),
  eitherVideoOrLink: eitherVideoOrLink(),
  outerPackageImage_1: yup.mixed().required("*Outer package image 1 is required"),
  innerPackageImage_1: yup.mixed().required("*Inner package image 1 is required"),
  productImage_1: yup.mixed().required("*Product image 1 is required"),
  podImage_1: yup.mixed().required("*POD proof 1 is required"),
});

export const nykaaCmsValidation = (skus: string[]) =>
  yup.object().shape({
    eCommercePlatform: yup.string().required("*E-commerce platform is required"),
    AWBNumber: yup.string().required("*AWB number is required"),
    typeOfClaim: yup.string().required("*Type of claim is required"),
    returnVideo: yup.string(),
    returnVideoLink: yup.string(),
    skuName: skus.length > 0 ? yup.string().required("Please select a SKU") : yup.string().nullable(),
    eitherVideoOrLink: eitherVideoOrLink(),
    returnProductImage: yup.mixed().required("*Return product image required"),
    forwardSentProductImage: yup.mixed(),
    podProof: yup.mixed(),
    nykaaClaimDetails: yup.object().shape({
      vendorCode: yup.string().trim().required("*Vendor Code is required"),
      skuId: yup.string().trim().required("*SKU ID is required"),
      returnType: yup.string().oneOf(["RTO", "DTO", "REPL"], "*Invalid return type").required("*Return Type is required"),
    }),
  });
