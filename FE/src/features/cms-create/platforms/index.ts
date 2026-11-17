import type { ComponentType } from "react";
import type { PlatformFormProps } from "@/features/cms-create/form-bits";
import type { PlatformKey } from "@/features/cms-create/platforms";
import { AjioForm } from "@/features/cms-create/platforms/ajio-form";
import { AmazonForm, DelhiveryForm, FlipkartForm, MyntraForm, TataCliqForm, XbeesForm } from "@/features/cms-create/platforms/bundle-forms";
import { MeeshoForm, SnapdealForm } from "@/features/cms-create/platforms/slot-forms";
import { NykaaForm, ShopifyForm } from "@/features/cms-create/platforms/wrapped-forms";

/** TrackVid `PLATFORM_COMPONENTS`. Unknown / custom platforms fall back to the AJIO (common) layout. */
export const PLATFORM_COMPONENTS: Record<PlatformKey, ComponentType<PlatformFormProps>> = {
  ajio: AjioForm,
  meesho: MeeshoForm,
  myntra: MyntraForm,
  snapdeal: SnapdealForm,
  nykaa: NykaaForm,
  amazon: AmazonForm,
  shopify: ShopifyForm,
  flipkart: FlipkartForm,
  tataCliq: TataCliqForm,
  delhivery: DelhiveryForm,
  xbees: XbeesForm,
};
