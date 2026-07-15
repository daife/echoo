import type { LocalMessage } from "@echoo/shared";
import { mergeIncomingMessage } from "../../services/localMessageState";

export interface TimelineWindowResult {
  messages: LocalMessage[];
  overflowed: boolean;
  oppositeEdgeMissing: boolean;
}

export function mergeOlderTimelineWindow(input: {
  current: LocalMessage[];
  incoming: LocalMessage[];
  maximumMessages: number;
  hasNewer: boolean;
}): TimelineWindowResult {
  const merged = mergeMessagePages(input.incoming, input.current);
  const overflowed = merged.length > input.maximumMessages;
  return {
    messages: overflowed ? merged.slice(0, input.maximumMessages) : merged,
    overflowed,
    oppositeEdgeMissing: overflowed || input.hasNewer,
  };
}

export function mergeNewerTimelineWindow(input: {
  current: LocalMessage[];
  incoming: LocalMessage[];
  maximumMessages: number;
  hasOlder: boolean;
}): TimelineWindowResult {
  const merged = mergeMessagePages(input.current, input.incoming);
  const overflowed = merged.length > input.maximumMessages;
  return {
    messages: overflowed ? merged.slice(-input.maximumMessages) : merged,
    overflowed,
    oppositeEdgeMissing: overflowed || input.hasOlder,
  };
}

export function mergeMessagePages(...pages: LocalMessage[][]) {
  return pages.reduce<LocalMessage[]>((current, page) => {
    return page.reduce(
      (merged, message) => mergeIncomingMessage(merged, message),
      current,
    );
  }, []);
}
