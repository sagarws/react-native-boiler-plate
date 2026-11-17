// @ts-nocheck
import { usePeriod } from "@/components/layout/app-shell";
import { RouteContent } from "@/components/layout/route-content";
import { useRoute } from "@/components/layout/use-route";

export default function RouteViewContent() {
  const { route, path, params } = useRoute();
  const period = usePeriod();
  return <RouteContent route={route} path={path} params={params} period={period} />;
}
