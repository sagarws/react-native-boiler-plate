import { orderImage } from "@renderer/services/claimCreate.service";

import { CLAIM_RESOURCE_CHANNELS } from "@shared/constants/channels";
import { invoke } from "@renderer/services/ipcClient";
/**
 * The six-side photographs, as one PDF.
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN IMPORTED. TrackVid-FE builds this with
 * jsPDF and `browser-image-compression`. Neither is a dependency here, and
 * neither is worth becoming one for what this does: every page is a single
 * photograph filling it, with no text, no vectors and no fonts. That is a PDF
 * you can write — an image XObject per page and an index — and the format's
 * own JPEG passthrough (`DCTDecode`) means the encoder is the browser's canvas,
 * which is already in the app.
 *
 * The result is byte-for-byte a valid PDF 1.4, opens in Preview, Acrobat and
 * Chrome, and is what the marketplaces receive: the backend stores it and the
 * claim form attaches it unchanged.
 *
 * THE OFFSETS ARE THE WHOLE TRICK. A PDF ends with a cross-reference table of
 * byte positions, so the file is assembled as bytes and every object's offset
 * is recorded as it is written. Build the string first and encode at the end
 * and the offsets are wrong the moment a photograph contains a byte that is not
 * Latin-1 — which is every photograph.
 */

/** No page wider or taller than this, in points (A4 is 595 × 842). */
const MAX_PAGE_POINTS = 842;

/**
 * The longest side a photograph is scaled to before encoding, in pixels.
 *
 * A phone camera hands over 4000px, and nine of those make a PDF the
 * marketplace refuses to accept. 1600 is the point where the packing label in
 * the corner of a parcel photograph is still readable — which is the entire
 * purpose of the evidence.
 */
const MAX_IMAGE_PIXELS = 1600;

/** JPEG quality. Chosen for the same reason as the size above. */
const JPEG_QUALITY = 0.82;

const encoder = new TextEncoder();

/** One decoded photograph, ready to place on a page. */
interface Page {
	jpeg: Uint8Array;
	width: number;
	height: number;
}

/**
 * Decodes a file, scales it down and re-encodes it as JPEG.
 *
 * Returns null instead of throwing: a broken image is one page missing from the
 * evidence, and losing the other eight to it would be worse. The caller reports
 * what it got.
 */
/**
 * A data URL, as a Blob — decoded here, NOT with `fetch`.
 *
 * The renderer's CSP is `connect-src 'self'`, and `data:` is not `'self'`, so
 * `fetch(dataUrl)` is refused before it starts. That one line is what made
 * every auto-filled claim fail with "None of the N six-side images could be
 * read": the main process fetched all of them correctly, and the renderer was
 * forbidden from unwrapping the answer. Loosening the CSP to fix it would open
 * `connect-src` for the whole window; decoding a string needs no permission.
 */
export const dataUrlToBlob = (dataUrl: string): Blob => {
	const comma = dataUrl.indexOf(",");

	if (comma < 0) throw new Error("not a data URL");

	const header = dataUrl.slice(5, comma);
	const body = dataUrl.slice(comma + 1);
	const type = header.split(";")[0] || "application/octet-stream";

	if (!header.includes(";base64")) return new Blob([decodeURIComponent(body)], { type });

	const binary = atob(body);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

	return new Blob([bytes], { type });
};

/**
 * A remote image, as bytes this can decode.
 *
 * The grid holds BOTH: a `File` the operator captured, and a URL the AWB
 * auto-fetch put there. The renderer displays a URL happily — it is an `<img>`
 * src — but `createImageBitmap` cannot take one, which is why a claim filled by
 * hand produced a PDF and an auto-filled one failed with "Could not upload
 * six-side images PDF".
 *
 * `credentials: 'omit'` because these are signed URLs: sending cookies to S3
 * can turn a working link into a 403.
 */
const asBlob = async (image: File | string): Promise<Blob> => {
	if (typeof image !== "string") return image;
	// A local capture needs no round trip — and `fetch` could not read it anyway
	// (see dataUrlToBlob).
	if (image.startsWith("data:")) return dataUrlToBlob(image);

	/*
	 * THROUGH THE MAIN PROCESS, not `fetch` here.
	 *
	 * These are signed S3 links. An `<img>` renders one without CORS, so the
	 * grid shows every image perfectly — but `fetch` of the same link is a
	 * cross-origin request and S3 does not return the headers that would let
	 * this page read the body. The images were visible and unreadable at the
	 * same time, which is why this failed only for auto-filled claims.
	 *
	 * The main process has no such rule, and already downloads these very files
	 * for "Download resources".
	 */
	const read = await invoke<string>(CLAIM_RESOURCE_CHANNELS.readImage, { url: image });

	if (read.success) return dataUrlToBlob(read.data);

	/*
	 * FALLING BACK TO A DIRECT FETCH when the main process could not do it.
	 *
	 * Mostly this means the running app predates the channel — the main process
	 * does NOT reload on a renderer edit, so a dev session happily runs a new
	 * renderer against an old main, and every image fails for a reason that has
	 * nothing to do with the images. The fallback also covers a URL that is
	 * already local (`data:` or `blob:`), which main cannot read and the renderer
	 * can.
	 *
	 * It is a fallback and not the first choice because of CORS: for a signed S3
	 * link this throws, and the message below says so rather than reporting the
	 * fallback's failure as the whole story.
	 */
	try {
		const direct = await fetch(image, { credentials: "omit" });

		if (!direct.ok) throw new Error(`HTTP ${direct.status}`);

		return await direct.blob();
	} catch (error) {
		const why = error instanceof Error ? error.message : String(error);

		throw new Error(`${read.error.message}; reading it here failed too (${why})`, {
			cause: error,
		});
	}
};

const toJpegPage = async (image: File | string): Promise<Page | null> => {
	/*
	 * INSIDE THE GUARD, not before it. A URL that will not fetch — expired
	 * signature, no network — must cost ONE page, exactly as an undecodable file
	 * does. Left outside, a single bad link rejected the whole batch and the
	 * claim lost all nine images to it.
	 */
	let source: Blob;

	try {
		source = await asBlob(image);
	} catch (error) {
		// Named, because "could not be read" about nine images says nothing about
		// which one or why — and the reasons differ: an expired link, a page
		// instead of a file, no network.
		console.error("[six-side] image could not be read", { image, error });

		return null;
	}

	const url = URL.createObjectURL(source);

	try {
		const bitmap = await createImageBitmap(source);
		const scale = Math.min(1, MAX_IMAGE_PIXELS / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement("canvas");

		canvas.width = width;
		canvas.height = height;

		const context = canvas.getContext("2d");

		if (!context) return null;

		// A PNG with transparency would otherwise become black where it is clear,
		// because JPEG has no alpha channel.
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, width, height);
		context.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
		});

		if (!blob) return null;

		return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
	} catch (error) {
		console.error("[imageToPdf] could not read an image", error);

		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
};

/** The page box for a photograph: its own shape, capped. */
const pageBox = (page: Page): { width: number; height: number } => {
	const scale = Math.min(1, MAX_PAGE_POINTS / Math.max(page.width, page.height));

	return {
		width: Math.max(1, Math.round(page.width * scale)),
		height: Math.max(1, Math.round(page.height * scale)),
	};
};

/** Assembles the PDF. Everything above this is preparation. */
const buildPdf = (pages: Page[]): Blob => {
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let length = 0;

	const push = (bytes: Uint8Array): void => {
		chunks.push(bytes);
		length += bytes.length;
	};

	const write = (text: string): void => push(encoder.encode(text));

	/** Records where this object starts, then writes it. Objects are 1-indexed. */
	const openObject = (id: number): void => {
		offsets[id] = length;
		write(`${id} 0 obj\n`);
	};

	// Object ids: 1 catalog, 2 page tree, then three per page.
	const pageIds = pages.map((_, index) => 3 + index * 3);

	write("%PDF-1.4\n");
	// A comment of high bytes, which is what tells a transport this is binary.
	push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

	openObject(1);
	write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

	openObject(2);
	write(
		`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`,
	);

	pages.forEach((page, index) => {
		const pageId = pageIds[index] as number;
		const contentId = pageId + 1;
		const imageId = pageId + 2;
		const box = pageBox(page);

		openObject(pageId);
		write(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${box.width} ${box.height}] ` +
				`/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
		);

		// Place the image at the origin, scaled to fill the page. `cm` is the
		// transformation matrix; `Do` draws the named XObject into it.
		const content = `q\n${box.width} 0 0 ${box.height} 0 0 cm\n/Im0 Do\nQ\n`;

		openObject(contentId);
		write(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

		openObject(imageId);
		write(
			`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
				`/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
		);
		push(page.jpeg);
		write("\nendstream\nendobj\n");
	});

	const total = 3 + pages.length * 3;
	const xref = length;

	write(`xref\n0 ${total}\n0000000000 65535 f \n`);

	for (let id = 1; id < total; id += 1) {
		write(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
	}

	write(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

	return new Blob(chunks as BlobPart[], { type: "application/pdf" });
};

/**
 * A grid entry as a File. VMS screenshots sit in the grid as keys (or URLs
 * ending in one), exactly as on the web app, which fetches them from
 * `/order/view/<key>` before drawing — so does this, through the main process,
 * because the renderer may not fetch.
 */
const toFile = async (input: File | string, index: number): Promise<File> => {
	if (typeof input !== "string") return input;

	const response = await orderImage(input);

	if (!response.success) throw new Error(response.error.message);

	return new File([response.data.bytes as BlobPart], `image_${index}.jpg`, {
		type: response.data.contentType,
	});
};

/**
 * The six-side grid, as the file the claim carries.
 *
 * Named as TrackVid-FE names it so the submit reads the same on both surfaces.
 * Takes what the grid holds — files the operator picked or captured, and VMS
 * screenshots as keys — as the web version does. Taking files only is what
 * broke every claim whose side images came from VMS: each key failed to
 * decode, and the save stopped at "Could not upload six-side images PDF".
 */
export const createPdfFromImages_old = async (imageInputs: (File | string)[]): Promise<File> => {
	const files = await Promise.all(imageInputs.map((input, index) => toFile(input, index)));
	const decoded = await Promise.all(files.map((file) => toJpegPage(file)));
	//  * FILES AND URLs BOTH, because the grid holds both: what the operator captured
	//  * here, and what the AWB auto-fetch pulled from the claim's stored resources.
	//  * It used to take files only — a fair description when every image was a local
	//  * capture, and wrong the moment auto-fill started putting URLs in the same
	//  * array. An auto-filled claim then failed at Create Ticket with "Could not
	//  * upload six-side images PDF", while the identical images uploaded by hand
	//  * worked.
	//  */
	const pages = decoded.filter((page): page is Page => page !== null);

	if (pages.length === 0) {
		// The caller checks the count before getting here, so this means every
		// image failed to decode — worth saying out loud rather than uploading an
		// empty PDF that looks like a successful save.
		throw new Error(
			`None of the ${imageInputs.length} six-side images could be read — see the console for each.`,
		);
	}

	return new File([buildPdf(pages)], "sixSideImages.pdf", { type: "application/pdf" });
};
