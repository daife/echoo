export function shouldRetrySyncTask(retryCount: number): boolean {
  return retryCount < 5;
}
