import type { MessageService } from "../../services/MessageService";

export function syncOnResume(messageService: MessageService) {
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void messageService.syncMessages();
    }
  };

  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
