import type { Metadata } from "next";
import { FavoritePage } from "@/features/favorite/favorite-page";

export const metadata: Metadata = { title: "Favorites" };

export default function Page() {
  return <FavoritePage />;
}
