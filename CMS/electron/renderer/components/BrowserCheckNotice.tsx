import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  BROWSER_DOWNLOAD_LINKS,
  type BrowserCheck,
} from "@shared/types/browserCheck";
import {
  checkBrowser,
  importChromeDriver,
} from "@renderer/services/browserCheck.service";

/**
 * The foot of the rail: what is missing for Myntra's sign-in, if anything.
 *
 * Mounted inside the signed-in shell, which TermsGate only renders once the
 * company has agreed — so the check runs after the agreement, never before.
 *
 * SILENT ON THE NORMAL PATH. Nothing renders while checking, when Chrome and
 * its driver are both ready, or when the check itself could not be asked: a
 * warning that appears on doubt would teach operators to ignore it.
 *
 * Links open in the operator's browser — the main window hands every
 * `target="_blank"` http(s) link to the OS.
 *
 * NO PATHS FOR THE OPERATOR. When the app cannot download the driver itself,
 * the operator downloads the one file in their own browser and picks it here;
 * the app unzips it, checks its version and puts it where it belongs.
 */
export const BrowserCheckNotice = () => {
  const [check, setCheck] = useState<BrowserCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setChecking(true);

    const response = await checkBrowser();

    setChecking(false);
    if (response.success) setCheck(response.data);
  }, []);

  const importDriver = useCallback(async () => {
    setChecking(true);
    setImportError(null);

    const response = await importChromeDriver();

    setChecking(false);
    if (response.success) setCheck(response.data);
    // Closing the picker is not an error worth showing.
    else if (response.error.message !== "Cancelled")
      setImportError(response.error.message);
  }, []);

  // The first check, on mount. State is only set once the answer is in — not
  // synchronously inside the effect — and not at all once unmounted.
  useEffect(() => {
    let alive = true;

    void checkBrowser().then((response) => {
      if (alive && response.success) setCheck(response.data);
    });

    return () => {
      alive = false;
    };
  }, []);

  if (!check) return null;

  const chromeMissing = !check.chrome.found;
  const driverMissing = !chromeMissing && !check.driver.ready;

  if (!chromeMissing && !driverMissing) return null;

  const major = check.chrome.version?.split(".")[0];

  return (
    // The rail is ~190px wide, so the Alert's own icon and action columns are
    // switched off: they each took a slice of the width and left the text a
    // thin strip to wrap in. The icon and the refresh sit in the title row
    // instead, and everything below it gets the full width.
    <Alert
      severity="warning"
      icon={false}
      className="whitespace-normal"
      sx={{
        paddingInline: 1.5,
        paddingBlock: 1.25,
        fontSize: "0.75rem",
        "& .MuiAlert-message": { inlineSize: "100%", minWidth: 0, padding: 0, overflow: "visible" },
      }}
    >
      <div className="flex items-center gap-1.5">
        <i className="tabler-alert-triangle text-base shrink-0" />
        <Typography
          variant="body2"
          sx={{ flex: 1, minWidth: 0, fontSize: "0.75rem", fontWeight: 600, lineHeight: 1.3 }}
        >
          {chromeMissing
            ? "Chrome not found"
            : `ChromeDriver${major ? ` ${major}` : ""} needed`}
        </Typography>
        <Tooltip title="Check again">
          <span>
            <IconButton
              size="small"
              color="inherit"
              aria-label="Check again"
              disabled={checking}
              onClick={() => void run()}
              sx={{ padding: 0.25, marginInlineEnd: -0.5 }}
            >
              <i
                className={`tabler-refresh text-sm ${checking ? "animate-spin" : ""}`}
              />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <Typography
        variant="body2"
        sx={{ fontSize: "0.75rem", color: "text.secondary", lineHeight: 1.4, marginBlockStart: 0.75 }}
      >
        {chromeMissing
          ? "Install it for Myntra sign-in."
          : "Needed for Myntra sign-in. Download it, then choose the file."}
      </Typography>

      <div className="flex flex-col gap-1 mbs-2">
        {chromeMissing ? (
          <Button
            {...actionProps}
            href={BROWSER_DOWNLOAD_LINKS.chrome}
            target="_blank"
            rel="noreferrer"
            startIcon={<i className="tabler-download text-sm" />}
          >
            Install Chrome
          </Button>
        ) : (
          <>
            <Button
              {...actionProps}
              href={check.driver.downloadUrl ?? BROWSER_DOWNLOAD_LINKS.chromedriver}
              target="_blank"
              rel="noreferrer"
              startIcon={<i className="tabler-download text-sm" />}
            >
              Download driver
            </Button>
            <Button
              {...actionProps}
              disabled={checking}
              onClick={() => void importDriver()}
              startIcon={<i className="tabler-folder-open text-sm" />}
            >
              Choose file…
            </Button>
            {/* The button above links the one matching archive. The full page is
                the escape hatch for when that file will not download — only
                shown then, since without an exact URL the button already opens it. */}
            {check.driver.downloadUrl && (
              <Link
                href={BROWSER_DOWNLOAD_LINKS.chromedriver}
                target="_blank"
                rel="noreferrer"
                color="inherit"
                underline="hover"
                sx={{ fontSize: "0.7rem", textAlign: "center", marginBlockStart: 0.25 }}
              >
                All versions (pick chromedriver{major ? ` ${major}` : ""})
              </Link>
            )}
          </>
        )}
      </div>

      {importError && (
        <Typography
          variant="body2"
          color="error"
          sx={{ fontSize: "0.75rem", marginBlockStart: 1 }}
        >
          {importError}
        </Typography>
      )}
    </Alert>
  );
};

/**
 * The action buttons share one shape: full width and stacked, because two
 * side by side do not fit a label and an icon each in the rail.
 */
const actionProps = {
  size: "small",
  variant: "outlined",
  color: "inherit",
  fullWidth: true,
  sx: {
    justifyContent: "flex-start",
    fontSize: "0.75rem",
    fontWeight: 500,
    paddingBlock: 0.375,
    paddingInline: 1.25,
    whiteSpace: "nowrap",
    borderColor: "divider",
    backgroundColor: "background.paper",
    "& .MuiButton-startIcon": { marginInlineEnd: 0.75 },
  },
} as const;
