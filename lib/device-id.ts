export function normalizeDeviceId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return id;
}
