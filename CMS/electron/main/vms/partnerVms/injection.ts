import type { CameraFormat } from './types'

/**
 * The script injected into Flipkart's page at document start, before their
 * bundle runs. Ported VERBATIM from TrackVid-App @ c188745
 * (src/main/partnerVms/controller.ts `buildInjection`): its camera-picking and
 * format rules were measured on packing PCs and must not drift.
 */

/**
 * Injected in the MAIN world at document start, before their bundle runs.
 *
 * Does two jobs:
 *
 *  1. Pins page visibility, so Chromium keeps the page running at full rate
 *     while the view sits off-screen behind the packing screen.
 *
 *  2. Locks their camera to the SAME physical device TrackVid is recording
 *     from. Without this their page takes the system default — on a laptop with
 *     an external webcam that is the built-in camera, so TrackVid records the
 *     parcel while Flipkart records the packer's face. Two videos of different
 *     things makes the Flipkart copy worthless as claim evidence.
 *
 *     Matching is by LABEL, not deviceId: deviceIds are salted per origin, so
 *     TrackVid's id for a camera is a different string from the one their page
 *     sees for the same hardware. Labels are stable across origins.
 */
export const buildInjection = (cameraLabel: string | null, format: CameraFormat | null): string => `
(() => {
  if (window.__tvInjected) {
    window.__tvCameraLabel = ${JSON.stringify(cameraLabel)};
    window.__tvCameraFormat = ${JSON.stringify(format)};
    return;
  }
  window.__tvInjected = true;
  window.__tvCameraLabel = ${JSON.stringify(cameraLabel)};
  window.__tvCameraFormat = ${JSON.stringify(format)};

  // ---- keep the page awake while hidden ---------------------------------
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.addEventListener('visibilitychange', (e) => { e.stopImmediatePropagation(); }, true);
  } catch (e) { /* the probe will surface the consequences */ }

  // ---- pin the camera ----------------------------------------------------
  try {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return;
    const original = md.getUserMedia.bind(md);

    // Laptop and all-in-one built-in cameras, by the names the OS gives them.
    const BUILT_IN = /facetime|built[- ]?in|integrated|internal|isight/i;

    // Cameras that are attached but are not the desk webcam. A nearby iPhone
    // offers itself as a Continuity Camera and looks 'external', so preferring
    // simply 'not built-in' handed the packing feed to whichever phone was on
    // the bench - and switching cameras reloads their VMS page, costing ~20s of
    // feed reconnection. Virtual cameras (OBS and friends) are excluded for the
    // same reason: they are not pointed at the parcel.
    const NOT_A_DESK_CAM =
      /iphone|ipad|continuity|desk view|obs|virtual|snap camera|droidcam|epoccam|ivcam|manycam/i;

    const isDeskWebcam = (d) => d.label && !BUILT_IN.test(d.label) && !NOT_A_DESK_CAM.test(d.label);

    const cameras = async () => {
      let list = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      // Labels are blank until camera permission has been granted once. Take a
      // throwaway stream to unlock them, then re-enumerate.
      if (list.length && !list.some((d) => d.label)) {
        try {
          const probe = await original({ video: true });
          probe.getTracks().forEach((t) => t.stop());
          list = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        } catch (e) { /* fall through with blank labels */ }
      }
      return list;
    };

    // Self-sufficient by design. It honours the exact camera TrackVid named,
    // but if that never arrived - a timing race, a fresh profile, a failed IPC
    // - it still does the right thing alone: an attached external webcam always
    // beats the laptop's built-in one. At a packing counter the external camera
    // points at the parcel; the built-in points at the packer's face, which is
    // useless as claim evidence.
    const choose = (list, want) => {
      if (!list.length) return null;
      if (want) {
        const exact = list.find((d) => d.label === want);
        if (exact) return { dev: exact, why: 'exact label from TrackVid' };
        const partial = list.find((d) => d.label && d.label.indexOf(want) !== -1);
        if (partial) return { dev: partial, why: 'partial label from TrackVid' };
      }
      const usb = list.find(isDeskWebcam);
      if (usb) return { dev: usb, why: 'USB webcam preferred' };
      // No desk webcam. A phone still beats the built-in camera, which points
      // at the packer's face and is useless as claim evidence.
      const anyExternal = list.find((d) => d.label && !BUILT_IN.test(d.label));
      if (anyExternal) return { dev: anyExternal, why: 'no USB webcam; external preferred over built-in' };
      return null;
    };

    md.getUserMedia = async function (constraints) {
      try {
        if (constraints && constraints.video) {
          const want = window.__tvCameraLabel;
          const video = constraints.video === true ? {} : Object.assign({}, constraints.video);
          const list = await cameras();
          const pick = choose(list, want);
          if (pick) {
            // Override even when the page named a device: if TrackVid records
            // camera X, the mirror must record camera X, or the two videos show
            // different things and the Flipkart copy is worthless.
            video.deviceId = { exact: pick.dev.deviceId };

            // Record what they asked for BEFORE replacing it.
            //
            // The 640x480 and 1280x720 figures that were quoted in these
            // comments and in the handover came from the probe's own mock page,
            // which picks deliberately mismatched sizes to force the conflict -
            // they were never read off fkvms.synlabs.io. Their real ask, logged
            // here on the packing PC, turned out to be 1280x720. This is the
            // only place it still exists, since the next few lines replace it.
            const asked = {
              width: video.width,
              height: video.height,
              frameRate: video.frameRate,
              aspectRatio: video.aspectRatio,
            };
            const named = Object.keys(asked).filter((k) => asked[k] !== undefined);
            console.info(
              named.length
                ? '[trackvid] their page asked for ' + JSON.stringify(asked)
                : '[trackvid] their page asked for no particular format',
            );

            // Ask for EXACTLY the format TrackVid is already running.
            //
            // Their own numbers have to go either way - a 1280x720 ask against
            // our 1920x1080 stream is the direct conflict Windows refuses. But
            // replacing them with nothing is worse than it looks: "nothing" is
            // not "join what is open", it is the browser's 640x480 default, and
            // that default then becomes the format for every consumer of the
            // device. Measured on the packing PC, it pulled TrackVid's own
            // 1920x1080 stream down to 640x480.
            //
            // Naming our format makes the second request identical to the one
            // already open, which is the case Windows is happy to share. Stated
            // as 'ideal' rather than 'exact' on purpose: if their page genuinely
            // cannot run at our format we want it to degrade and keep recording,
            // not fail and record nothing.
            delete video.aspectRatio;
            delete video.resizeMode;

            const want = window.__tvCameraFormat;
            if (want && want.width && want.height) {
              video.width = { ideal: want.width };
              video.height = { ideal: want.height };
              if (want.frameRate) video.frameRate = { ideal: want.frameRate };
              console.info(
                '[trackvid] asking for TrackVid\\'s format instead: ' +
                  want.width + 'x' + want.height +
                  (want.frameRate ? ' @' + want.frameRate + 'fps' : ''),
              );
            } else {
              // TrackVid has not reported a format yet, so there is nothing to
              // match. Dropping the sizes is still better than leaving a known
              // mismatch in place.
              delete video.width;
              delete video.height;
              delete video.frameRate;
              console.info('[trackvid] TrackVid format unknown — asking for the device alone');
            }

            constraints = Object.assign({}, constraints, { video });
            console.info('[trackvid] camera pinned to', pick.dev.label, '-', pick.why);
          }
        }
      } catch (e) {
        // Never block their page's camera on our preference logic - fall
        // through and let the original request run unmodified.
      }

      const stream = await original(constraints);

      // And what they actually GOT. This is the number that answers whether
      // TrackVid won the race for the format: if it matches the packing
      // screen's resolution then both recordings are at full quality, and if it
      // is lower then their page opened the camera first and ours is the one
      // that got downgraded.
      try {
        const s = stream.getVideoTracks()[0].getSettings();
        console.info(
          '[trackvid] their stream opened on "' + s.deviceId + '" at ' +
            s.width + 'x' + s.height + ' @' + Math.round(s.frameRate || 0) + 'fps',
        );
      } catch (e) { /* a stream we cannot inspect still works for them */ }

      return stream;
    };
  } catch (e) { /* leave their page alone if anything here fails */ }
})();
`;
