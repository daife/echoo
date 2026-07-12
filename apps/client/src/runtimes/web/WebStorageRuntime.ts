import type { StorageRuntime } from "../contracts";

export class WebStorageRuntime implements StorageRuntime {
  async getSetting<T>(key: string) {
    const value = localStorage.getItem(`echoo.setting.${key}`);
    return value ? (JSON.parse(value) as T) : null;
  }
  async setSetting<T>(key: string, value: T) {
    localStorage.setItem(`echoo.setting.${key}`, JSON.stringify(value));
  }
  async removeSetting(key: string) {
    localStorage.removeItem(`echoo.setting.${key}`);
  }
}
