export const DEVICE_STORAGE_KEY = "perch-device";

export function normalizeDeviceId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return id;
}

type DeviceStorage = { getItem(key: string): string | null };

export function readStoredDeviceId(storage: DeviceStorage | null | undefined) {
  if (!storage) return null;
  const raw = storage.getItem(DEVICE_STORAGE_KEY);
  if (typeof raw !== "string") return null;
  return normalizeDeviceId(raw);
}
