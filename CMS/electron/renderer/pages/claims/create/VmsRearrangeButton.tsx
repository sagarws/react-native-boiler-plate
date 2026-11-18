import { Box, Button } from "@mui/material";
import { tint } from "./tint";

interface Props {
  /** Only render when there is something in the pool to rearrange. */
  show: boolean;
  onClick: () => void;
}

/**
 * Opens the Rearrange modal so the user can shuffle / reset the images
 * auto-populated from VMS recordings.
 */
const VmsRearrangeButton = ({ show, onClick }: Props) => {
  if (!show) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
      <Button
        size="small"
        variant="tonal"
                color="secondary"
        onClick={onClick}
        sx={{
          textTransform: "none",
          borderColor: "primary.main",
          color: "primary.main",
          "&:hover": {
            borderColor: "primary.dark",
            backgroundColor: tint('primary.main', 0.08),
          },
        }}
      >
        Rearrange Images
      </Button>
    </Box>
  );
};

export default VmsRearrangeButton;
