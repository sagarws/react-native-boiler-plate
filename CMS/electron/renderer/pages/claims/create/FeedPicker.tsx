import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { getCommonFeeds } from "./api";
import type { CommonFeed as ICommonFeed } from "@shared/types/cmsCreate";

const STORAGE_KEY = "trackvid.cms.create.selectedFeedId";

/** Waits before each retry of a failed feed fetch; three retries, then the picker stays empty. */
const FEED_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

/**
 * The feed this operator picked last time.
 *
 * A per-viewer convenience, which is the one thing browser storage is for here
 * — a machine with site data cleared, or a first run, simply starts on the
 * first feed. Both accessors are guarded because reading `localStorage` can
 * throw outright depending on how the window was opened, and a claim form that
 * fails to render because it could not remember a dropdown would be absurd.
 */
const readStoredFeedId = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const rememberFeedId = (feedId: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, feedId);
  } catch {
    // Nothing to do and nothing worth saying: the picker still works.
  }
};

interface Props {
  feedId: string;
  onChange: (feedId: string) => void;
  required?: boolean;
  compact?: boolean;
}

const FeedPicker = ({ feedId, onChange, required = true, compact = false }: Props) => {
  const [feeds, setFeeds] = useState<ICommonFeed[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // A failed fetch is retried a few times: the picker loads once, so one
    // network blip used to leave the Feed empty for the whole session — and
    // createCMS refuses a claim without one.
    const load = (attempt: number): void => {
      setLoading(true);
      getCommonFeeds()
        .then((res) => {
          if (cancelled) return;
          // Already filtered to the active feeds by the main process, which is
          // where the disabled/deleted flags are read.
          const active = res.data.data ?? [];
          setFeeds(active);
          setLoading(false);

          // Auto-select: prefer the remembered feed if it is still one of this
          // company's, else the first.
          const first = active[0];

          if (!feedId && first) {
            const stored = readStoredFeedId();
            const storedIsValid = stored && active.some((f) => f._id === stored);
            onChange(storedIsValid ? stored : first._id);
          }
        })
        .catch(() => {
          if (cancelled) return;
          const delay = FEED_RETRY_DELAYS_MS[attempt];

          if (delay === undefined) {
            setFeeds([]);
            setLoading(false);
            return;
          }
          retryTimer = setTimeout(() => load(attempt + 1), delay);
        });
    };

    load(0);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (nextId: string) => {
    onChange(nextId);
    rememberFeedId(nextId);
  };

  const selected = feeds.find((f) => f._id === feedId) || null;

  if (compact) {
    return (
      <Autocomplete
        size="small"
        loading={loading}
        options={feeds}
        value={selected}
        getOptionLabel={(option) => option.feedName || ""}
        onChange={(_, value) => handleChange(value?._id || "")}
        isOptionEqualToValue={(a, b) => a._id === b._id}
        sx={{ width: 200 }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Feed"
            name="feedId"
            sx={{
              "& .MuiOutlinedInput-root": { height: 34, fontSize: 13 },
              "& .MuiInputBase-input": { fontSize: 13 },
            }}
          />
        )}
      />
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "5px", width: "100%" }}>
      <Typography>
        Feed {required && <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>}
      </Typography>
      <Autocomplete
        size="small"
        loading={loading}
        options={feeds}
        value={selected}
        getOptionLabel={(option) => option.feedName || ""}
        onChange={(_, value) => handleChange(value?._id || "")}
        isOptionEqualToValue={(a, b) => a._id === b._id}
        renderInput={(params) => (
          <TextField {...params} placeholder="Select Feed" name="feedId" />
        )}
      />
    </Box>
  );
};

export default FeedPicker;
