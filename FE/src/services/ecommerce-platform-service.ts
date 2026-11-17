import { clone, delay, newId } from "@/mocks/delay";
import { sampleEcommercePlatformRecords } from "@/mocks/integrations";
import type { MessageResponse } from "@/types/common";
import type { CreateEcommercePlatformPayload, IEcommercePlatformRecord, UpdateEcommercePlatformPayload } from "@/types/integrations";

/** Mock of TrackVid-FE `api/ecommerce-platform-service.ts` (`/ecommerce-platform`). */

let platforms: IEcommercePlatformRecord[] = clone(sampleEcommercePlatformRecords);

const createECommercePlatform = async (data: CreateEcommercePlatformPayload): Promise<IEcommercePlatformRecord> => {
  await delay(500);
  const name = data.name.trim();
  if (!name) throw new Error("Platform name is required.");
  if (platforms.some((p) => !p.isDeleted && p.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} already exists.`);
  const record: IEcommercePlatformRecord = { ...data, name, _id: newId(), isDeleted: false, createdAt: new Date().toISOString() };
  platforms = [...platforms, record];
  return clone(record);
};

/** Sets a platform's logo (TrackVid uploads the file; the mock stores the given URL / data URL). */
const storeLogo = async (data: { id: string; logo: string }): Promise<MessageResponse> => {
  await delay(400);
  if (!platforms.some((p) => p._id === data.id)) throw new Error("Platform not found.");
  platforms = platforms.map((p) => (p._id === data.id ? { ...p, logo: data.logo } : p));
  return { message: "Logo saved." };
};

const getECommercePlatforms = async (): Promise<IEcommercePlatformRecord[]> => {
  await delay();
  return clone(platforms.filter((p) => !p.isDeleted));
};

const updateECommercePlatform = async (data: UpdateEcommercePlatformPayload): Promise<IEcommercePlatformRecord> => {
  await delay(450);
  const current = platforms.find((p) => p._id === data.id && !p.isDeleted);
  if (!current) throw new Error("Platform not found.");
  const { id, ...rest } = data;
  const next: IEcommercePlatformRecord = { ...current, ...rest };
  platforms = platforms.map((p) => (p._id === id ? next : p));
  return clone(next);
};

const deleteECommercePlatform = async (data: { id: string[] }): Promise<MessageResponse> => {
  await delay(400);
  platforms = platforms.map((p) => (data.id.includes(p._id) ? { ...p, isDeleted: true } : p));
  return { message: `${data.id.length} platform(s) deleted.` };
};

export const ECommercePlatformService = {
  createECommercePlatform,
  storeLogo,
  getECommercePlatforms,
  updateECommercePlatform,
  deleteECommercePlatform,
};
