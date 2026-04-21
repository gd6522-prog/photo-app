import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_ID_KEY = "hx_device_id_v1";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = generateUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return generateUUID();
  }
}
