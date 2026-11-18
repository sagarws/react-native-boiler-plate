import { Box, Dialog, IconButton, Stack, Typography } from "@mui/material";
import { Close, GridOnOutlined, ListAltOutlined } from "../icons";
import { tint } from "../tint";

export type BulkClaimKind = "normal" | "increff";

interface Props {
  open: boolean;
  onClose: () => void;
  onChoose: (kind: BulkClaimKind) => void;
  /**
   * Whether the Increff import can be used here. It is gated on the company's
   * `increffBulkClaim` flag and on an allowed Increff platform; without both,
   * every row of its report would be dropped, so the option is shown disabled
   * rather than leading to an empty result.
   */
  increffAvailable: boolean;
}

const OPTIONS: {
  kind: BulkClaimKind;
  title: string;
  blurb: string;
  Icon: typeof GridOnOutlined;
}[] = [
  {
    kind: "normal",
    title: "Normal Claim",
    blurb:
      "Download the template, fill one row per claim on each platform's sheet, and upload it back. Video and images are taken from VMS by Return AWB.",
    Icon: GridOnOutlined,
  },
  {
    kind: "increff",
    title: "Increff Claim",
    blurb:
      "Upload the Increff QC CSV / Excel report. Each row's Return AWB is matched against your VMS records.",
    Icon: ListAltOutlined,
  },
];

/** The first step of Bulk Claim: which kind of sheet the operator has. */
const BulkClaimChooser = ({ open, onClose, onChoose, increffAvailable }: Props) => (
  <Dialog
    open={open}
    onClose={onClose}
    maxWidth="sm"
    fullWidth
    PaperProps={{ sx: { borderRadius: "6px", bgcolor: "background.paper" } }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 2.5,
        py: 1.5,
        borderBottom: (t) => `1px solid ${t.palette.divider}`,
      }}
    >
      <Box>
        <Typography sx={{ fontSize: 16, fontWeight: 700, color: "text.primary" }}>
          Bulk Claim
        </Typography>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          Choose the kind of sheet you are uploading.
        </Typography>
      </Box>
      <IconButton
        aria-label="close"
        onClick={onClose}
        size="small"
        sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: "6px" }}
      >
        <Close sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
    <Stack spacing={1.5} sx={{ p: 2.5 }}>
      {OPTIONS.map(({ kind, title, blurb, Icon }) => {
        const disabled = kind === "increff" && !increffAvailable;

        return (
          <Box
            key={kind}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={() => !disabled && onChoose(kind)}
            onKeyDown={(e) => {
              if (!disabled && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onChoose(kind);
              }
            }}
            sx={(t) => ({
              display: "flex",
              gap: 1.5,
              alignItems: "flex-start",
              p: 2,
              borderRadius: "6px",
              border: `1px solid ${t.palette.divider}`,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
              transition: "border-color .15s ease, background .15s ease",
              "&:hover, &:focus-visible": disabled
                ? undefined
                : { borderColor: t.palette.primary.main, background: tint("primary.main", 0.04) },
              outline: "none",
            })}
          >
            <Box
              sx={{
                width: 36,
                height: 36,
                flexShrink: 0,
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: tint("primary.main", 0.1),
                color: "primary.main",
              }}
            >
              <Icon sx={{ fontSize: 20 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: "text.primary" }}>
                {title}
              </Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>
                {disabled
                  ? "Not enabled for this company — turn on the Increff report and allow a platform in Settings."
                  : blurb}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Stack>
  </Dialog>
);

export default BulkClaimChooser;
