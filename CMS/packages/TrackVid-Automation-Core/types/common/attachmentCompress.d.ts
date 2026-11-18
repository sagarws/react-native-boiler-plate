/**
 * Fit one attachment under a cap, whatever kind of file it is.
 *
 * @param {string} input          the file on disk
 * @param {object} options
 * @param {number} options.maxBytes the marketplace's cap. Falsy means "no known
 *        cap", and the file is left alone — see uploadLimits.js: absent means
 *        unknown, never unlimited.
 * @returns {Promise<{path: string, compressed: boolean, from: number, to: number, reason: string|null}>}
 */
export function fitAttachmentToLimit(input: string, { maxBytes, tempDir, logger }?: {
    maxBytes: number;
}): Promise<{
    path: string;
    compressed: boolean;
    from: number;
    to: number;
    reason: string | null;
}>;
/**
 * Re-encode an image until it fits, or give up saying why.
 *
 * ALWAYS TO JPEG, whatever came in. A 9MB PNG of a photograph is 9MB because
 * PNG is lossless, and no quality setting will help while it stays one; the
 * same picture as JPEG is a few hundred KB. The marketplace shows the reviewer
 * a picture either way.
 *
 * EACH ATTEMPT STARTS FROM THE ORIGINAL, never from the previous output —
 * re-encoding an already-lossy result compounds the artefacts, and the second
 * pass would be noticeably worse than one pass at the same final setting.
 */
export function fitImageToLimit(input: any, { maxBytes, tempDir, logger }?: {}): Promise<{
    path: any;
    compressed: boolean;
    from: number;
    to: number;
    reason: any;
} | {
    path: string;
    compressed: boolean;
    from: number;
    to: any;
    reason: any;
}>;
/**
 * Fit a PDF under the cap by sending the picture inside it instead.
 *
 * Returns the usual shape. The replacement is a `.jpg`, which is what the
 * marketplace's image slot wanted in the first place.
 */
export function fitPdfToLimit(input: any, { maxBytes, tempDir, logger }?: {}): Promise<{
    path: any;
    compressed: boolean;
    from: number;
    to: number;
    reason: any;
} | {
    from: number;
    path: string;
    compressed: boolean;
    to: any;
    reason: any;
}>;
/**
 * Pull the largest embedded raster image out of a PDF.
 *
 * WHY THIS IS ENOUGH, for the PDFs that actually turn up here. A courier's
 * proof-of-delivery is a SCAN: the file is one photograph with a thin PDF
 * wrapper, and the photograph is already a JPEG — PDF stores those verbatim
 * under `/DCTDecode`, byte for byte. So the picture can be lifted out with a
 * read, no decoder and no new dependency, and then shrunk by the image path
 * that already exists.
 *
 * IT IS ALSO THE RIGHT FILE TO SEND. Snapdeal's slot is `POD_slip_image` — an
 * image slot. The PDF was never what the reviewer wanted; it is what the
 * courier happened to produce.
 *
 * A PDF THIS DOES NOT FIT returns null and says so: a text-born PDF has no
 * photograph in it, and a `/FlateDecode` image is a raw bitmap that would need
 * decoding and re-encoding to be worth anything. Null is honest, and the caller
 * still offers the original so the marketplace gives its own verdict.
 *
 * Parsed by scanning rather than with a PDF library, deliberately: what is
 * needed is "find the JPEGs", not "understand the document", and every library
 * that understands the document is a native binary or a megabyte of parser.
 */
export function extractJpegFromPdf(buffer: any): any;
export function kindOf(file: any): string;
/**
 * JPEG quality steps, worst case last.
 *
 * Quality BEFORE scale, deliberately. A claim is argued from what the reviewer
 * can see in the photo — a torn seal, a wrong SKU — and detail survives a
 * quality drop far better than it survives being made physically smaller. Only
 * when 2 cannot fit does the image start losing pixels.
 */
export const QUALITY_STEPS: number[];
/** Scale factors tried once quality alone has failed. */
export const SCALE_STEPS: number[];
