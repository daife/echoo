export function canRetryDelivery(attempts: number) {
  return attempts < 5;
}
