import { initials } from "@/lib/format";

export function Avatar({ name, photo, className = "" }: { name: string; photo?: string | null; className?: string }) {
  return <span className={`avatar ${className}`.trim()}>{photo ? <img src={photo} alt="" /> : initials(name || "?") || "?"}</span>;
}
