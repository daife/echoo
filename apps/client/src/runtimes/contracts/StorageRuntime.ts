export interface StorageRuntime {
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
  removeSetting(key: string): Promise<void>;
}
