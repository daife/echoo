export type ConversationTimelineRequestKind = "older" | "newer" | "latest";

export interface ConversationTimelineRequestLease {
  kind: ConversationTimelineRequestKind;
  token: symbol;
}

export class ConversationTimelineRequestGate {
  private activeLease: ConversationTimelineRequestLease | null = null;

  acquire(
    kind: ConversationTimelineRequestKind,
  ): ConversationTimelineRequestLease | null {
    if (this.activeLease) return null;
    const lease = { kind, token: Symbol(kind) };
    this.activeLease = lease;
    return lease;
  }

  release(lease: ConversationTimelineRequestLease) {
    if (this.activeLease?.token !== lease.token) return false;
    this.activeLease = null;
    return true;
  }

  reset() {
    this.activeLease = null;
  }
}
