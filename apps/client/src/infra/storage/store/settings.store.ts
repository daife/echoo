export const settingsStore = {
  get<T>(key: string): T | null {
    const value = localStorage.getItem(`echoo.setting.${key}`);
    return value ? (JSON.parse(value) as T) : null;
  }
};
