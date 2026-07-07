export function createBrowserWsClient(url: string) {
  return new WebSocket(url);
}
