/** Marketplace / courier logo from `public/assets/marketplaces` (same aliases as TrackVid-FE `platformLogos.ts`). */
const ALIASES: Record<string, string> = {
  nykaa: "nykaa-fashion",
  "nykaa fashion": "nykaa-fashion",
  "tata cliq": "tata-cliq",
  tatacliq: "tata-cliq",
  "ajio dropship": "ajio",
  "amazon fba": "amazon",
  "amazon.in": "amazon",
  "myntra ppmp": "myntra",
  expressbees: "xbees",
  "google drive": "google-drive",
  googledrive: "google-drive",
};

const FILES: Record<string, string> = {
  ajio: "ajio.png",
  amazon: "amazon.png",
  delhivery: "delhivery.png",
  flipkart: "flipkart.png",
  increff: "increff.png",
  meesho: "meesho.png",
  myntra: "myntra.png",
  "nykaa-fashion": "nykaa-fashion.png",
  other: "other.png",
  snapdeal: "snapdeal.png",
  "tata-cliq": "tata-cliq.png",
  xbees: "xbees.png",
  "11za": "11za.svg",
  base: "base.png",
  "google-drive": "google-drive.svg",
  kwikengage: "kwikengage.png",
  mark360: "mark360.svg",
};

export function platformLogoUrl(name: string): string | undefined {
  const raw = name.toLowerCase().trim();
  const slug = ALIASES[raw] ?? raw.replace(/[\s_/]+/g, "-").replace(/[^a-z0-9-.]/g, "");
  const file = FILES[slug] ?? FILES[ALIASES[slug] ?? ""];
  return file ? `/assets/marketplaces/${file}` : undefined;
}

export function PlatformLogo({ name, showName = true, large = false }: { name: string; showName?: boolean; large?: boolean }) {
  const url = platformLogoUrl(name);
  return (
    <span className={`tv-platform ${large ? "is-large" : ""}`.trim()}>
      {url ? (
        <img src={url} alt={showName ? "" : name} />
      ) : (
        <span className="status-dot" aria-hidden="true" style={{ background: "#c9a75a" }} />
      )}
      {showName ? <span>{name}</span> : null}
    </span>
  );
}
