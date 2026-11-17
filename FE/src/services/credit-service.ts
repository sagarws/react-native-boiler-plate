import { COMPANY_ID, COMPANY_NAME, accountsDb, nextHistoryId } from "@/mocks/accounts";
import { clone, delay } from "@/mocks/delay";
import { UserService } from "@/services/user-service";
import type { IUpgradeStorageResponse } from "@/types/accounts";

/** Mock of TrackVid-FE `api/credit-service.ts`. */

/** Activates a storage plan; its price is paid from the credit wallet. */
const upgradeStorage = async (payload: { planId: string }): Promise<IUpgradeStorageResponse> => {
  await delay(600);
  const plan = (await UserService.getPlans()).find((p) => p._id === payload.planId);
  if (!plan || plan.type !== "STORAGE") throw new Error("Invalid storage plan.");
  const w = accountsDb.wallet;
  const remaining = w.totalCredit - w.usedCredit;
  if (remaining < plan.price) {
    throw new Error(`Insufficient credits: ${plan.name} needs ${plan.price} credits, you have ${remaining}.`);
  }
  w.usedCredit += plan.price;
  w.totalStorage = plan.storage ?? w.totalStorage;
  accountsDb.creditHistory = [
    {
      _id: nextHistoryId(),
      feedId: null,
      actionType: 11,
      companyId: COMPANY_ID,
      credit: plan.price,
      orderId: null,
      cmsId: null,
      paymentId: null,
      createdAt: new Date().toISOString(),
      companyData: { name: COMPANY_NAME },
    },
    ...accountsDb.creditHistory,
  ];
  return { message: `${plan.name} plan activated successfully.`, plan: clone(plan), creditDeducted: plan.price };
};

export const CreditService = {
  upgradeStorage,
};
