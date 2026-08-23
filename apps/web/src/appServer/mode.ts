export function isDirectAppServerDesktop(): boolean {
  return typeof window !== "undefined" && window.desktopBridge?.connectAppServer !== undefined;
}
