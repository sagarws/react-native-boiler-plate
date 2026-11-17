"use client";

import { useState } from "react";
import Link from "next/link";
import { addDays, startOfDay } from "date-fns";
import { Icon } from "@/components/icons/icon";
import type { DateRange } from "@/components/ui/date-range-picker";
import { PageHeading } from "@/components/ui/page-heading";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Tabs } from "@/components/ui/tabs";
import { canAccess } from "@/lib/permissions";
import { useSelector } from "@/store";
import { MasterOrdersTable } from "./master-orders-table";
import { PlatformMasterTable } from "./platform-master-table";
import { useDebouncedValue } from "./use-debounced-value";

type MasterPlatform = "AJIO" | "D2C" | "MEESHO" | "SNAPDEAL" | "MYNTRA";

const PLATFORMS: { key: MasterPlatform; label: string }[] = [
  { key: "AJIO", label: "AJIO" },
  { key: "D2C", label: "D2C" },
  { key: "MEESHO", label: "MEESHO" },
  { key: "SNAPDEAL", label: "SNAPDEAL" },
  { key: "MYNTRA", label: "MYNTRA" },
];

const lastSevenDays = (): DateRange => ({ startDate: startOfDay(addDays(new Date(), -6)), endDate: new Date() });

/** TrackVid `pages/MasterData.tsx`: platform segmented control + per-platform master table. */
export function MasterDataPage() {
  const user = useSelector((s) => s.profile.userProfile);
  const [platform, setPlatform] = useState<MasterPlatform>("AJIO");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<DateRange>(lastSevenDays);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const debouncedSearch = useDebouncedValue(search, 500);

  const hasMasterImportPermission = canAccess(user, ["admin"], ["master_data::edit"]);
  const canImport = hasMasterImportPermission || canAccess(user, ["admin"], ["external_imports::edit"]);

  const shared = {
    search,
    debouncedSearch,
    onSearch: (v: string) => {
      setSearch(v);
      setPage(1);
    },
    range,
    onRange: (r: DateRange) => {
      setRange(r);
      setPage(1);
    },
    page,
    limit,
    onPage: setPage,
    onLimit: setLimit,
  };

  return (
    <div className="tv-page tv-master-page">
      <PageHeading
        title="Master Data"
        subtitle="Marketplace order and return master records imported from your seller panels."
        actions={
          canImport ? (
            <Link href="/imports" className="secondary-button">
              <Icon name="upload" /> Import data
            </Link>
          ) : undefined
        }
      />
      <section className="glass-card tv-table-card">
        <div className="tv-master-platforms">
          <Tabs
            label="Master data platform"
            value={platform}
            onChange={(p) => {
              setPlatform(p);
              setPage(1);
            }}
            items={PLATFORMS.map((p) => ({
              key: p.key,
              label: p.key === "D2C" ? (
                <span className="tv-platform">
                  <span className="status-dot tv-master-d2c-dot" aria-hidden="true" />
                  <span>D2C</span>
                </span>
              ) : (
                <PlatformLogo name={p.label} />
              ),
            }))}
          />
        </div>
        {platform === "AJIO" || platform === "D2C" ? (
          <MasterOrdersTable key={platform} platform={platform} companyId={user?.companyId} canEdit={hasMasterImportPermission} {...shared} />
        ) : (
          <PlatformMasterTable key={platform} kind={platform} {...shared} />
        )}
      </section>
    </div>
  );
}
