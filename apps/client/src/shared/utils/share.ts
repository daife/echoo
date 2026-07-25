export type ShareResult = "shared" | "copied" | "cancelled";

export async function shareOrCopy(input: {
  title: string;
  text?: string;
  url: string;
}): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share(input);
      return "shared";
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
    }
  }
  await copyText(input.url);
  return "copied";
}

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some WebViews expose the Clipboard API without write permission.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("无法访问剪贴板，请检查系统权限。");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError";
}
