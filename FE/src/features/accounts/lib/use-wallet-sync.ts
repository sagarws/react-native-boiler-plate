"use client";

import { refreshWallet } from "@/features/accounts/lib/accounts-helpers";
import { errorMessage, toast } from "@/lib/events";
import { useDispatch, useSelector } from "@/store";
import { setUserProfile } from "@/store/profile-slice";
import type { ICompany } from "@/types/common";

/** After a purchase / approval / storage upgrade: push the new wallet into the store (topbar updates). */
export function useWalletSync(): (patch?: Partial<Pick<ICompany, "creditPlan" | "storagePlan">>) => Promise<void> {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.profile.userProfile);
  return async (patch) => {
    if (!user) return;
    try {
      const next = await refreshWallet(user, patch);
      dispatch(setUserProfile(next));
    } catch (err) {
      toast.error(errorMessage(err, "Could not refresh your credit balance."));
    }
  };
}
