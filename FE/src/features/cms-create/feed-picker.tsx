"use client";

import { useEffect, useRef, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { readStored, removeStored, writeStored } from "@/lib/storage";
import { FeedService } from "@/services/feed-service";
import type { ICommonFeed } from "@/types/feed";

const STORAGE_KEY = "cms.create.selectedFeedId";

/**
 * TrackVid `FeedPicker`: active feeds (not disabled / deleted). With nothing chosen it restores the last feed used
 * on this browser, else the first one. The pick is remembered in localStorage.
 */
export function FeedPicker({ feedId, onChange }: { feedId: string; onChange: (feedId: string) => void }) {
  const [feeds, setFeeds] = useState<ICommonFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const live = useRef({ feedId, onChange });
  useEffect(() => {
    live.current = { feedId, onChange };
  });

  useEffect(() => {
    let cancelled = false;
    FeedService.getCommonFeeds()
      .then((list) => {
        if (cancelled) return;
        const active = list.filter((f) => !f.isDisable && !f.isDeleted);
        setFeeds(active);
        if (!live.current.feedId && active.length > 0) {
          const stored = readStored<string>(STORAGE_KEY, "");
          live.current.onChange(active.some((f) => f._id === stored) ? stored : active[0]._id);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (next: string) => {
    onChange(next);
    if (next) writeStored(STORAGE_KEY, next);
    else removeStored(STORAGE_KEY);
  };

  return (
    <div className="tv-cmsc-feed">
      <Combobox
        label="Feed"
        value={feedId}
        onChange={change}
        options={feeds.map((f) => ({ value: f._id, label: f.feedName }))}
        placeholder={loading ? "Loading feeds…" : failed ? "Feeds unavailable" : "Feed"}
        disabled={loading}
      />
    </div>
  );
}
