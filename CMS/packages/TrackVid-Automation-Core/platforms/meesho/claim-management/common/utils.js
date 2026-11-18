const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const { saveClaimResource } = require("../../../../common/resourceSaver");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");

/**
 * Helper function to download file from URL to temp folder.
 * Optional saveCtx = { companyId, companyName, awbNumber } mirrors the file
 * into resource/Reports/{Company}/{Date}/{AWB}/ when SAVE_RESOURCE=true.
 */
async function downloadFile(url, filename, tempPath, saveCtx = null) {
    if (!url || !url.startsWith('http')) {
        // Already a local path, return as-is
        return url;
    }
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        const filePath = path.join(tempPath, `${filename}_${Date.now()}${path.extname(url) || '.tmp'}`);
        await fs.writeFile(filePath, response.data);
        console.log(`    📥 Downloaded: ${filename} -> ${filePath}`);
        if (saveCtx) {
            await saveClaimResource({
                srcPath: filePath,
                companyId: saveCtx.companyId,
                companyName: saveCtx.companyName,
                awbNumber: saveCtx.awbNumber,
                filename: `${filename}${path.extname(url) || '.tmp'}`,
            });
        }
        return filePath;
    } catch (err) {
        console.error(`    ❌ Failed to download ${filename}: ${err.message}`);
        throw err;
    }
}

/**
 * Fill Sub Order Number
 */
async function fillSubOrderNumber(page, subOrderNumber) {
    console.log("  - Filling Sub Order Number...");
    const subOrderSelector = "xpath=//input[contains(@placeholder, 'Sub Order Number')]";
    const subOrderHandle = await page.waitForSelector(subOrderSelector, { visible: true });
    const expectedSubOrder = String(subOrderNumber);
    let subOrderOk = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
        await subOrderHandle.focus();
        await subOrderHandle.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await new Promise(resolve => setTimeout(resolve, 300));
        await subOrderHandle.focus();
        await page.keyboard.type(expectedSubOrder, { delay: 80 });
        await new Promise(resolve => setTimeout(resolve, 500));
        const actual = await page.evaluate(el => el.value, subOrderHandle);
        if (actual === expectedSubOrder) {
            console.log(`    ✅ Sub Order Number entered: ${actual}`);
            subOrderOk = true;
            break;
        }
        console.warn(`    ⚠️ Sub Order mismatch (attempt ${attempt}/4): expected "${expectedSubOrder}", got "${actual}". Retrying...`);
    }
    if (!subOrderOk) {
        throw new Error(`Sub Order Number failed to enter correctly (expected "${expectedSubOrder}")`);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
}

/**
 * Fill AWB Number
 */
async function fillAwbNumber(page, awbNumber) {
    console.log("  - Filling AWB Number...");
    const expectedAwb = String(awbNumber);

    // Detect which AWB field variant is present.
    //   "combobox" → legacy searchable dropdown (uses .floating_label + role=combobox)
    //   "plain"    → newer MUI OutlinedInput with placeholder="AWB Number"
    const variant = await page.evaluate(() => {
        const hasCombobox = Array.from(document.querySelectorAll('.floating_label'))
            .some(lbl => lbl.textContent.includes('AWB Number') && lbl.closest('[role="combobox"]'));
        if (hasCombobox) return 'combobox';

        const plain = document.querySelector('input[placeholder="AWB Number"]');
        if (plain && plain.offsetParent !== null) return 'plain';

        return null;
    });

    if (variant === 'plain') {
        return fillAwbNumberPlainInput(page, expectedAwb);
    }
    if (variant !== 'combobox') {
        throw new Error("AWB Number field not found (neither combobox nor plain input present)");
    }

    // ---- Combobox / searchable dropdown flow ----
    await page.evaluate(() => {
        const labels = document.querySelectorAll('.floating_label');
        for (const lbl of labels) {
            if (lbl.textContent.includes('AWB Number')) {
                const combobox = lbl.closest('[role="combobox"]');
                if (!combobox) continue;
                const openBtn = combobox.querySelector('button[aria-label="Open menu"]');
                (openBtn || combobox).click();
                return;
            }
        }
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    const inputHandle = await page.waitForFunction(() => {
        const inputs = document.querySelectorAll('input[aria-autocomplete="list"]');
        for (const inp of inputs) {
            const cb = inp.closest('[role="combobox"]');
            const lbl = cb && cb.querySelector('.floating_label');
            if (lbl && lbl.textContent.includes('AWB Number')) return inp;
        }
        return null;
    }, { timeout: 5000 });

    const inputEl = inputHandle.asElement();
    let awbOk = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
        await inputEl.focus();
        await inputEl.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await new Promise(resolve => setTimeout(resolve, 300));
        await inputEl.focus();
        await page.keyboard.type(expectedAwb, { delay: 80 });
        await new Promise(resolve => setTimeout(resolve, 500));
        const actual = await page.evaluate(el => el.value, inputEl);
        if (actual === expectedAwb) {
            console.log(`    ✅ AWB Number entered: ${actual}`);
            awbOk = true;
            break;
        }
        console.warn(`    ⚠️ AWB mismatch (attempt ${attempt}/4): expected "${expectedAwb}", got "${actual}". Retrying...`);
    }
    if (!awbOk) {
        throw new Error(`AWB Number failed to enter correctly (expected "${expectedAwb}")`);
    }

    await new Promise(resolve => setTimeout(resolve, 800));
    const picked = await page.evaluate(awb => {
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        const visible = options.filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && el.offsetParent !== null;
        });
        const exact = visible.find(el => el.textContent.trim() === awb);
        if (exact) {
            exact.scrollIntoView({ block: 'center' });
            exact.click();
            return 'matched';
        }
        const addOpt = visible.find(el => /add\s+awb/i.test(el.textContent));
        if (addOpt) {
            addOpt.scrollIntoView({ block: 'center' });
            addOpt.click();
            return 'added';
        }
        return null;
    }, expectedAwb);

    if (picked === 'matched') {
        console.log(`    ✅ Selected existing AWB option: ${expectedAwb}`);
    } else if (picked === 'added') {
        console.log(`    ✅ Created new AWB entry via "Add AWB": ${expectedAwb}`);
    } else {
        // Dropdown opened but no option/Add-AWB rendered — fall back to plain input.
        console.warn(`    ⚠️ No selectable AWB option found in dropdown; falling back to plain input flow`);
        return fillAwbNumberPlainInput(page, expectedAwb);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
}

// MUI OutlinedInput variant: just type the AWB into the plain text input.
async function fillAwbNumberPlainInput(page, expectedAwb) {
    console.log("    ↪ Using plain MUI input variant for AWB Number");
    const selector = 'input[placeholder="AWB Number"]';
    await page.waitForSelector(selector, { visible: true, timeout: 5000 });
    const inputEl = await page.$(selector);
    if (!inputEl) {
        throw new Error('Plain AWB Number input not found');
    }

    for (let attempt = 1; attempt <= 4; attempt++) {
        await inputEl.focus();
        await inputEl.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await new Promise(resolve => setTimeout(resolve, 200));
        await page.keyboard.type(expectedAwb, { delay: 80 });
        await new Promise(resolve => setTimeout(resolve, 400));
        const actual = await page.evaluate(el => el.value, inputEl);
        if (actual === expectedAwb) {
            console.log(`    ✅ AWB Number entered (plain input): ${actual}`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            return;
        }
        console.warn(`    ⚠️ AWB mismatch (attempt ${attempt}/4): expected "${expectedAwb}", got "${actual}". Retrying...`);
    }
    throw new Error(`AWB Number failed to enter correctly in plain input (expected "${expectedAwb}")`);
}

/**
 * Select Logistics Partner Name (dropdown)
 * Used for "Return/RTO product not received but marked delivered - Need Proof of Delivery" claim type
 */
async function selectLogisticsPartner(page, courierPartner) {
    console.log(`  - Selecting Logistics Partner Name: ${courierPartner}...`);
    try {
        const dropdownClicked = await page.evaluate(() => {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el.textContent.includes('Logistics Partner Name') && !el.classList.contains('selected_text')) {
                    const innerContainer = el.closest('.MuiBox-root');
                    if (innerContainer && innerContainer.parentElement) {
                        const dropdownContainer = innerContainer.parentElement;
                        const arrowContainer = innerContainer.querySelector('.css-ie6h5v');
                        if (arrowContainer) {
                            arrowContainer.click();
                            return true;
                        }
                        dropdownContainer.click();
                        return true;
                    }
                }
            }
            return false;
        });

        if (!dropdownClicked) {
            throw new Error("Could not click Logistics Partner Name dropdown");
        }

        await new Promise(resolve => setTimeout(resolve, 800));

        await page.waitForFunction((optionText) => {
            const elements = document.querySelectorAll('*');
            for (const el of elements) {
                if (el.textContent.trim() === optionText) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0 && el.offsetParent !== null) {
                        return true;
                    }
                }
            }
            return false;
        }, { timeout: 5000 }, courierPartner);

        await new Promise(resolve => setTimeout(resolve, 300));

        const optionClicked = await page.evaluate((optionText) => {
            const elements = document.querySelectorAll('*');
            for (const el of elements) {
                if (el.textContent.trim() === optionText) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0 && el.offsetParent !== null) {
                        el.scrollIntoView({ block: 'center' });
                        el.click();
                        return true;
                    }
                }
            }
            return false;
        }, courierPartner);

        if (optionClicked) {
            console.log(`    ✅ Selected: ${courierPartner}`);
        } else {
            throw new Error(`Could not click option: ${courierPartner}`);
        }
    } catch (err) {
        console.error(`    ❌ Failed to select Logistics Partner Name: ${err.message}`);
        throw err;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Select State of the packet (dropdown)
 */
/**
 * Pick a value from one of Meesho's dropdowns, by the LABEL above it.
 *
 * Meesho rebuilt these controls: they used to be MUI, and the old code found
 * them by hunting for `.MuiBox-root` and a `.css-ie6h5v` arrow. Those classes
 * are gone. The replacement is a plain ARIA listbox — a
 * `button[aria-haspopup="listbox"]` holding the value in a `<span>`, and
 * options as `div[role="option"]` — with Tailwind classes that will be churned
 * again the next time the design changes.
 *
 * So this navigates by ROLE and LABEL, not by class. `aria-haspopup`,
 * `role="option"` and the label's `for` are contract, not styling: they are
 * what a screen reader uses, and they survive a redesign that renames every
 * class in the file.
 *
 * @param {string} labelText  the visible label, e.g. "State of the packet"
 * @param {string} optionText the option to pick, e.g. "Intact"
 */
async function selectFromLabelledListbox(page, labelText, optionText) {
    const opened = await page.evaluate((label) => {
        const wanted = label.trim().toLowerCase();

        // The label owns the control through `for` → the hidden input's id, so
        // start there and walk up to whatever wrapper holds the button.
        for (const el of document.querySelectorAll("label")) {
            const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();

            if (!text.startsWith(wanted)) continue;

            let node = el;

            for (let depth = 0; node && depth < 5; depth++) {
                const button = node.querySelector('button[aria-haspopup="listbox"]');

                if (button) {
                    button.scrollIntoView({ block: "center" });
                    button.click();

                    return true;
                }

                node = node.parentElement;
            }
        }

        return false;
    }, labelText);

    if (!opened) {
        throw new Error(`Could not open the "${labelText}" dropdown — no listbox button under that label`);
    }

    // The options render into a `[role="listbox"]` once the button is pressed.
    await page.waitForFunction(
        (option) => {
            const wanted = option.trim().toLowerCase();

            return [...document.querySelectorAll('[role="listbox"] [role="option"]')].some(
                (el) => (el.textContent || "").trim().toLowerCase() === wanted
            );
        },
        { timeout: 8000 },
        optionText,
    ).catch(() => {
        throw new Error(`The "${labelText}" dropdown opened but never listed "${optionText}"`);
    });

    const picked = await page.evaluate((option) => {
        const wanted = option.trim().toLowerCase();

        for (const el of document.querySelectorAll('[role="listbox"] [role="option"]')) {
            if ((el.textContent || "").trim().toLowerCase() !== wanted) continue;
            if (el.getAttribute("aria-disabled") === "true") continue;

            el.scrollIntoView({ block: "center" });
            el.click();

            return true;
        }

        return false;
    }, optionText);

    if (!picked) {
        throw new Error(`Could not click "${optionText}" in the "${labelText}" dropdown`);
    }

    // VERIFY IT TOOK. Clicking an option is not the same as the form accepting
    // it: these controls re-render, and a click that lands mid-render leaves the
    // button empty and the form invalid — which then fails at Submit, several
    // steps away from the cause.
    await page.waitForFunction(
        (label, option) => {
            const wantedLabel = label.trim().toLowerCase();
            const wantedOption = option.trim().toLowerCase();

            for (const el of document.querySelectorAll("label")) {
                const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();

                if (!text.startsWith(wantedLabel)) continue;

                let node = el;

                for (let depth = 0; node && depth < 5; depth++) {
                    const button = node.querySelector('button[aria-haspopup="listbox"]');

                    if (button) {
                        return (button.textContent || "").trim().toLowerCase().includes(wantedOption);
                    }

                    node = node.parentElement;
                }
            }

            return false;
        },
        { timeout: 5000 },
        labelText,
        optionText,
    ).catch(() => {
        throw new Error(
            `"${optionText}" was clicked in the "${labelText}" dropdown but the field did not take it`
        );
    });
}

async function selectStateOfPacket(page, stateOfPacket) {
    console.log(`  - Selecting State of the packet: ${stateOfPacket}...`);

    try {
        await selectFromLabelledListbox(page, "State of the packet", stateOfPacket);
        console.log(`    ✅ Selected: ${stateOfPacket}`);
    } catch (err) {
        console.error(`    ❌ Failed to select State dropdown: ${err.message}`);
        throw err;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Fill Packet ID
 */
async function fillPacketId(page, packetId) {
    console.log("  - Filling Packet ID...");
    const packetIdSelector = "xpath=//input[contains(@placeholder, 'Packet ID')]";
    await page.waitForSelector(packetIdSelector, { visible: true });
    await page.click(packetIdSelector);
    await page.evaluate((selector, value) => {
        const input = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (input) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, "//input[contains(@placeholder, 'Packet ID')]", packetId);
}

// Human-readable name for a config image URL, used verbatim in error messages
// so a failure points at the exact CMS asset ("<name> not uploaded").
function imageNameFromUrl(url, fallback) {
    try {
        const base = path.basename(new URL(url).pathname);
        return decodeURIComponent(base) || fallback;
    } catch (_) {
        return fallback;
    }
}

/**
 * Resolve the first upload input matching `idPrefix` (e.g. "barcode_image_link_").
 *
 * Why prefix matching: Meesho assigns sequential numeric suffixes to upload
 * inputs based on field order in the rendered form. When optional fields are
 * absent for certain claim types (e.g. Barcode Image is hidden for
 * "wrong barcoded package in RTO"), every subsequent input's suffix shifts
 * down. A hardcoded "#barcode_image_link_6" would silently break.
 *
 * Returns null if the field isn't on the page within `timeoutMs` — callers
 * treat that as "this claim type doesn't require this upload" and skip.
 */
async function findUploadInput(page, idPrefix, timeoutMs = 4000) {
    const selector = `input[type="file"][id^="${idPrefix}"]`;
    try {
        await page.waitForSelector(selector, { timeout: timeoutMs });
    } catch {
        return null;
    }
    return await page.$(selector);
}

/**
 * Upload Barcode Image
 */
async function uploadBarcodeImage(page, barcodeImage, tempPath, saveCtx = null) {
    const barcodeInput = await findUploadInput(page, 'barcode_image_link_');
    if (!barcodeInput) {
        console.log("  ↪ Barcode Image field not present in form — skipping");
        return;
    }
    console.log("  - Uploading Barcode Image...");
    const barcodePath = await downloadFile(barcodeImage, 'barcode', tempPath, saveCtx);
    await barcodeInput.uploadFile(barcodePath);
}

/**
 * Upload Product Images
 */
async function uploadProductImages(page, productImages, tempPath, saveCtx = null) {
    const productInput = await findUploadInput(page, 'product_image_link_');
    if (!productInput) {
        console.log("  ↪ Product Image field not present in form — skipping");
        return;
    }

    // Every image the config supplies is uploaded, once each. The old code
    // sliced this to a single image (while logging "first 2 only"), silently
    // dropping the rest. Duplicates by URL are collapsed so the same photo is
    // never attached twice; anything that fails to upload names the image.
    const rawList = (Array.isArray(productImages) ? productImages : [productImages]).filter(Boolean);

    // Upstream sometimes serializes a missing S3 key as the literal string
    // "undefined"/"null", producing URLs like ".../trackvid/undefined". Those
    // pass a truthy check but 403 on download, aborting the whole upload. Drop
    // them here with a visible warning so the valid images still go through.
    const requested = [];
    for (const url of rawList) {
        const key = String(url).split("/").pop().split("?")[0].trim().toLowerCase();
        if (key === "undefined" || key === "null" || key === "") {
            console.log(`  ⚠️ Skipping product image with invalid S3 key: ${url}`);
            continue;
        }
        requested.push(url);
    }
    if (requested.length === 0) {
        console.log("  ↪ No product images supplied — skipping");
        return;
    }

    const seenUrls = new Set();
    let uploaded = 0;
    for (let i = 0; i < requested.length; i++) {
        const url = requested[i];
        const imgName = imageNameFromUrl(url, `product_${i + 1}`);
        if (seenUrls.has(url)) {
            console.log(`  ℹ️ ${imgName} listed twice — attaching once`);
            continue;
        }
        seenUrls.add(url);

        console.log(`  - Uploading Product Image ${i + 1}/${requested.length}...`);
        let productImagePath;
        try {
            productImagePath = await downloadFile(url, `product_${i}`, tempPath, saveCtx);
        } catch (err) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — download failed: ${err.message}`);
        }
        if (!productImagePath) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — download returned no file`);
        }

        if (uploaded > 0) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Re-query after the first upload: Meesho renders a fresh input for the
        // next slot, and reusing the old handle would overwrite the previous file.
        const inputForUpload = uploaded === 0 ? productInput : await findUploadInput(page, 'product_image_link_');
        if (!inputForUpload) {
            throw new Error(`UPLOAD_FAILED: ${imgName} not uploaded — no upload input available for image ${i + 1}`);
        }
        await inputForUpload.uploadFile(productImagePath);
        await new Promise(resolve => setTimeout(resolve, 2000));
        uploaded++;
        console.log(`    ✅ ${imgName} uploaded`);
    }
    console.log(`  📎 ${uploaded} product image(s) attached (all distinct)`);
}

/**
 * Upload Reverse Waybill
 */
async function uploadReverseWaybill(page, reverseWaybill, tempPath, saveCtx = null) {
    const waybillInput = await findUploadInput(page, 'product_reverse_way_bill_link_');
    if (!waybillInput) {
        console.log("  ↪ Reverse Waybill field not present in form — skipping");
        return;
    }
    console.log("  - Uploading Reverse Waybill...");
    const reverseWaybillPath = await downloadFile(reverseWaybill, 'waybill', tempPath, saveCtx);
    await waybillInput.uploadFile(reverseWaybillPath);
}

/**
 * Upload Unpacking Video
 */
async function uploadUnpackingVideo(page, unpackingVideo, tempPath, saveCtx = null) {
    const videoInput = await findUploadInput(page, 'product_openingvideo_link_');
    if (!videoInput) {
        console.log("  ↪ Unpacking Video field not present in form — skipping");
        return;
    }
    console.log("  - Uploading Unpacking Video...");
    const videoPath = await downloadFile(unpackingVideo, 'video', tempPath, saveCtx);
    await videoInput.uploadFile(videoPath);
    await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * Fill Description
 */
async function fillDescription(page, description) {
    console.log("  - Filling Description...");
    const descriptionSelector = "xpath=//textarea | //input[contains(@placeholder, 'Description')]";
    await page.waitForSelector(descriptionSelector, { visible: true });
    await page.click(descriptionSelector);
    await page.evaluate((value) => {
        const el = document.querySelector('textarea') || document.querySelector("input[placeholder*='Description']");
        if (el) {
            const setter = Object.getOwnPropertyDescriptor(
                el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value'
            ).set;
            setter.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, description);
}

/**
 * Upload Attachments (PDF)
 */
async function uploadAttachments(page, attachments, tempPath, saveCtx = null) {
    const attachmentInput = await findUploadInput(page, 'attachments_');
    if (!attachmentInput) {
        console.log("  ↪ Attachments field not present in form — skipping");
        return;
    }
    if (!attachments) {
        console.log("  ↪ No attachment provided — skipping");
        return;
    }
    console.log("  - Uploading Attachments...");
    const attachmentPath = await downloadFile(attachments, 'attachment', tempPath, saveCtx);
    await attachmentInput.uploadFile(attachmentPath);
}

/**
 * Fill Callback Number
 */
async function fillCallbackNumber(page, callbackNumber) {
    console.log("  - Verifying Callback Number...");
    const callbackSelector = "xpath=//input[contains(@placeholder, 'Callback Number')]";
    await page.waitForSelector(callbackSelector, { visible: true });
    const callbackValue = await page.$eval(callbackSelector, (el) => el.value);
    if (!callbackValue) {
        await page.click(callbackSelector);
        await page.type(callbackSelector, callbackNumber, { delay: 50 });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
}

/**
 * Handle Advertisement Popup
 */
async function handleAdvertisementPopup(page) {
    try {
        console.log("🔍 Checking for popup/modal after login...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Meesho's OLDER modal, matched by the class names it shipped with.
        // Tried first because it is exact, and exact beats a heuristic when it
        // applies.
        const modalSelector = "body > div.Overlay__mtdbh40.Modal__1jp7csq1 > div > div > div";
        const closeButtonSelector = "body > div.Overlay__mtdbh40.Modal__1jp7csq1 > div > div > div > div > div.fidtkkg.fidtkkf > div.fidtkkj.fmg7c3m.fmg7c3r.fmg7c3l > div > img";
        const overlaySelector = "body > div.Overlay__mtdbh40.Modal__1jp7csq1";

        const modal = await page.$(modalSelector);
        if (modal) {
            console.log("📢 Modal popup detected!");
            const closeButton = await page.$(closeButtonSelector);
            if (closeButton) {
                console.log("🔘 Close button found, clicking...");
                await closeButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log("✅ Modal closed via close button.");
                return;
            }
            console.log("⚠️ Close button not found in modal.");
        }

        const overlay = await page.$(overlaySelector);
        if (overlay) {
            console.log("📢 Overlay detected! Removing it...");
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) el.remove();
            }, overlaySelector);
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log("✅ Overlay removed.");
            return;
        }

        // Anything NEWER. Meesho's current promos ("Aage Badho!", Pay Later
        // Lite) use `growth-` utility classes, carry no role or aria-modal, and
        // close through an <img src="…cross-grey.svg"> inside a plain <div> —
        // none of which the selectors above can see, so every run stopped at
        // the first click behind the popup. See common/dismissPopup.js.
        const { dismissMeeshoPopup } = require("../../common/dismissPopup");
        const result = await dismissMeeshoPopup(page);

        if (!result.found) {
            console.log("✅ No popup/modal/overlay detected.");
        } else if (!result.closed) {
            console.warn("⚠️ A Meesho popup is still on screen — the next click may not land.");
        }
    } catch (error) {
        console.warn(`⚠️ Error while handling popup: ${error.message}`);
    }
}

/**
 * Navigate to Claims and click Raise Claim, then select reason and Raise a Ticket.
 * Retries up to 3 times by going Home and re-entering Claims if Raise Claim is not found.
 */
async function navigateToClaims(page, claimReason) {
    try {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const RAISE_CLAIM_SELECTOR = "#mainWrapper > div > div.css-1u3coc5 > div.css-pm4x2h > button";
        const MAX_RAISE_CLAIM_ATTEMPTS = 4; // 1 initial + 3 retries
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RAISE_CLAIM_ATTEMPTS; attempt++) {
            try {
                if (attempt > 1) {
                    console.log(`🔄 Retry ${attempt - 1}/${MAX_RAISE_CLAIM_ATTEMPTS - 1}: Navigating to Home then back to Claims...`);
                    try {
                        // Try clicking Home tab first
                        await page.click('text=Home');
                    } catch (homeErr) {
                        console.warn(`  ⚠️ Home tab click failed (${homeErr.message}), navigating via URL...`);
                        await page.goto('https://supplier.meesho.com/panel/v3/new/dashboard', { waitUntil: 'networkidle2' });
                    }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await handleAdvertisementPopup(page);
                }

                // Go to Claims tab
                console.log("📋 Navigating to Claims tab...");
                await page.waitForSelector('#mainWrapper', { timeout: 10000 });
                await page.click('text=Claims');

                await new Promise(resolve => setTimeout(resolve, 3000));

                // Meesho occasionally renders a "Reload" button on the Claims
                // tab when the listing didn't fetch on first paint. Match by
                // visible text plus the CSS-in-JS class prefix (the hash
                // suffix is volatile so a loose startsWith is safer).
                const reloadClicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const reloadBtn = buttons.find(btn =>
                        (btn.innerText || '').trim() === 'Reload' &&
                        Array.from(btn.classList).some(c => c.startsWith('Button__'))
                    );
                    if (reloadBtn) { reloadBtn.click(); return true; }
                    return false;
                });
                if (reloadClicked) {
                    console.log("🔄 Clicked 'Reload' on Claims tab, waiting for page to repopulate...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                // Click Raise Claim
                console.log("🔓 Clicking Raise Claim...");
                await new Promise(resolve => setTimeout(resolve, 2000));

                let clicked = false;
                try {
                    console.log(`  🔍 Trying selector: ${RAISE_CLAIM_SELECTOR}`);
                    await page.waitForSelector(RAISE_CLAIM_SELECTOR, { timeout: 5000, visible: true });
                    await page.click(RAISE_CLAIM_SELECTOR);
                    clicked = true;
                    console.log("  ✅ Clicked via selector");
                } catch (err) {
                    console.warn(`  ⚠️ Selector failed or timed out: ${err.message}. Trying text-based search...`);
                    clicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const raiseBtn = buttons.find(btn => btn.innerText.includes('Raise Claim'));
                        if (raiseBtn) {
                            raiseBtn.click();
                            return true;
                        }
                        return false;
                    });
                    if (clicked) console.log("  ✅ Clicked via text-based search");
                }

                if (!clicked) {
                    throw new Error(`Raise Claim button not found on page. Checked selector: ${RAISE_CLAIM_SELECTOR} and text 'Raise Claim'`);
                }

                break;
            } catch (err) {
                lastError = err;
                console.warn(`  ⚠️ Raise Claim attempt ${attempt}/${MAX_RAISE_CLAIM_ATTEMPTS} failed: ${err.message}`);
                if (attempt === MAX_RAISE_CLAIM_ATTEMPTS) {
                    throw lastError;
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Select reason
        console.log(`🔍 Selecting reason: ${claimReason}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await page.waitForSelector(`text=${claimReason}`, { timeout: 10000 });
        await page.click(`text=${claimReason}`);

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Click "Raise a Ticket" button
        const RAISE_TICKET_BUTTON = "Raise a Ticket";
        console.log(`🎫 Clicking '${RAISE_TICKET_BUTTON}' button...`);
        const ticketClicked = await page.evaluate((btnText) => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const ticketBtn = buttons.find(btn => btn.innerText.includes(btnText));
            if (ticketBtn) {
                ticketBtn.click();
                return true;
            }
            return false;
        }, RAISE_TICKET_BUTTON);

        if (!ticketClicked) {
            throw new Error("Raise a Ticket button not found");
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log("✅ Claims navigation completed!");
        return true;
    } catch (error) {
        console.error(`🚨 Claims navigation failed: ${error.message}`);
        throw error;
    }
}

/**
 * Look for a MUI error helper text rendered directly under the AWB Number field
 * (e.g. "You can create this ticket only if your return order has been delivered...").
 * Returns the trimmed text or null when no such helper is present.
 */
/**
 * Has Meesho already got a ticket for this AWB?
 *
 * After the AWB is entered the form answers, inline:
 *
 *   Ticket [7788934011637] has already been raised for this issue.
 *   Please reply on the same ticket.
 *
 * That is not a failure and it is not something to push past. The claim EXISTS —
 * filling in the rest of the form and submitting would either be rejected or,
 * worse, raise a second ticket for one return. What the CMS actually needs is
 * the number Meesho just showed us, so the row can be updated and closed.
 *
 * Read by ROLE and TEXT, not by class: the message sits in a
 * `[data-error="true"]` block whose Tailwind classes have already churned once
 * (see selectFromLabelledListbox). The sentence and the button holding the
 * number are the stable parts.
 *
 * POLLS, because the answer is not instant. Meesho validates the AWB on its
 * server and renders this a second or two after the field is filled — a single
 * read the moment typing finishes finds an empty form and the run sails past it
 * into a claim that cannot be submitted.
 *
 * @param {object} [options]
 * @param {number} [options.waitMs=0] how long to keep looking. 0 reads once,
 *        for callers that only want to know what is on screen right now.
 * @returns {Promise<{ticketId: string, message: string}|null>}
 */
async function readAlreadyRaisedTicket(page, { waitMs = 0, intervalMs = 500 } = {}) {
    const deadline = Date.now() + waitMs;

    for (;;) {
        const found = await readAlreadyRaisedTicketOnce(page);

        if (found) return found;
        if (Date.now() >= deadline) return null;

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

async function readAlreadyRaisedTicketOnce(page) {
    try {
        return await page.evaluate(() => {
            const ALREADY = /has already been raised for this issue/i;

            // Smallest element carrying the sentence — going wider would pick up
            // a container holding half the form and the wrong button with it.
            let match = null;

            for (const el of document.querySelectorAll("div, span, p")) {
                const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

                if (!ALREADY.test(text)) continue;
                if (match && match.text.length <= text.length) continue;

                match = { el, text };
            }

            if (!match) return null;

            // The number is a button — it links to the ticket — but fall back to
            // the first long digit run so a markup change costs the link, not
            // the number.
            const button = match.el.querySelector("button");
            const fromButton = button && (button.innerText || button.textContent || "").trim();
            const ticketId = /^\d{5,}$/.test(fromButton || "")
                ? fromButton
                : (match.text.match(/\b(\d{5,})\b/) || [])[1] || null;

            if (!ticketId) return null;

            return { ticketId, message: match.text };
        });
    } catch {
        return null;
    }
}

async function captureAwbFieldHelperError(page) {
    try {
        return await page.evaluate(() => {
            let awbInput = document.querySelector('input[placeholder="AWB Number"]');
            if (!awbInput) {
                const floating = Array.from(document.querySelectorAll('.floating_label'))
                    .find(lbl => lbl.textContent.includes('AWB Number'));
                if (floating) {
                    const combo = floating.closest('[role="combobox"]');
                    awbInput = combo ? combo.querySelector('input') : null;
                }
            }
            if (!awbInput) return null;

            const describedBy = awbInput.getAttribute('aria-describedby');
            if (describedBy) {
                for (const id of describedBy.split(/\s+/)) {
                    const node = document.getElementById(id);
                    if (node && node.classList.contains('Mui-error')) {
                        const text = (node.innerText || node.textContent || '').trim();
                        if (text) return text;
                    }
                }
            }

            // The rebuilt form marks the message with data-error rather than a
            // Mui class. Checked before the Mui paths below, which stay for
            // accounts still served the old UI.
            let node = awbInput.parentElement;

            for (let depth = 0; node && depth < 6; depth++) {
                const flagged = node.querySelector('[data-error="true"]');

                if (flagged) {
                    const text = (flagged.innerText || flagged.textContent || '').trim();

                    if (text) return text;
                }

                node = node.parentElement;
            }

            const control = awbInput.closest('.MuiFormControl-root')
                || awbInput.closest('[class*="MuiFormControl"]');
            if (control) {
                const helper = control.querySelector('.MuiFormHelperText-root.Mui-error');
                if (helper) {
                    const text = (helper.innerText || helper.textContent || '').trim();
                    if (text) return text;
                }
            }

            return null;
        });
    } catch {
        return null;
    }
}

/**
 * Check whether Submit button is enabled. Throws if it remains disabled.
 */
async function checkSubmitButtonEnable(page) {
    console.log("  ⌛ Waiting for Submit button to be enabled...");
    try {
        await page.waitForFunction(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Submit'));
            return btn && !btn.disabled && !btn.classList.contains('Mui-disabled');
        }, { timeout: 15000 });
        console.log("  ✅ Submit button is enabled");
    } catch (err) {
        // Submit stayed disabled — Meesho often blocks the form with a MUI error
        // helper directly below the AWB Number field (return not yet delivered,
        // retry-after window, etc.). Capture that text as scriptProcessingError
        // so the caller can surface the actual reason instead of a generic
        // "Submit button not enabled".
        const scriptProcessingError = await captureAwbFieldHelperError(page);
        if (scriptProcessingError) {
            console.error(`  ❌ scriptProcessingError (AWB field): ${scriptProcessingError}`);
            const wrapped = new Error(scriptProcessingError);
            wrapped.scriptProcessingError = scriptProcessingError;
            throw wrapped;
        }
        throw new Error(`Submit button is not enabled: ${err.message}`);
    }
}

/**
 * Perform Submit button click action.
 */
async function submitAction(page) {
    // DESABLE_SAVE=true → the claim form stays filled but is never submitted.
    // Note this function normally swallows click failures; the guard throws so a
    // skipped submit can never be mistaken for a filed claim.
    assertClaimSubmitEnabled("Meesho", "'Submit' click");

    console.log("🚀 Clicking Submit button...");
    try {
        const submitClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const submitBtn = buttons.find(btn => btn.innerText.includes('Submit'));
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
                return true;
            }
            return false;
        });

        if (submitClicked) {
            console.log("  ✅ Submit button clicked successfully");
        } else {
            const userSelector = "#mainWrapper > div > div > form > div.css-1n18ugs > div > button";
            await page.waitForSelector(userSelector, { visible: true, timeout: 5000 });
            await page.click(userSelector);
            console.log("  ✅ Submit button clicked via fallback selector");
        }
    } catch (err) {
        console.error(`  ❌ Failed to click Submit button: ${err.message}`);
        try {
            const userSelector = "#mainWrapper > div > div > form > div.css-1n18ugs > div > button";
            await page.click(userSelector);
            console.log("  ✅ Submit button clicked via final attempt selector");
        } catch (finalErr) {
            console.warn("  ⚠️ All submit attempts failed. Form may already be submitted or button is unreachable.");
        }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
}

module.exports = {
    downloadFile,
    fillSubOrderNumber,
    fillAwbNumber,
    selectLogisticsPartner,
    selectStateOfPacket,
    selectFromLabelledListbox,
    fillPacketId,
    uploadBarcodeImage,
    uploadProductImages,
    uploadReverseWaybill,
    uploadUnpackingVideo,
    fillDescription,
    uploadAttachments,
    fillCallbackNumber,
    handleAdvertisementPopup,
    navigateToClaims,
    checkSubmitButtonEnable,
    submitAction,
    captureAwbFieldHelperError,
    readAlreadyRaisedTicket,
};
