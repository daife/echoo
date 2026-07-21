export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type PrimeWorldPortType =
  | "control"
  | "text"
  | "number"
  | "boolean"
  | "json"
  | "messages"
  | "audio"
  | "text-stream"
  | "audio-stream"
  | "state-patch"
  | "event"
  | "view";

export interface PrimeWorldNode {
  id: string;
  type: string;
  version: number;
  name?: string;
  config: JsonObject;
}

export interface PrimeWorldEdge {
  id: string;
  kind: "control" | "data";
  source: { nodeId: string; port: string };
  target: { nodeId: string; port: string };
}

export type WorldViewElement =
  | {
      id: string;
      type: "stack";
      direction?: "vertical" | "horizontal";
      children: WorldViewElement[];
    }
  | {
      id: string;
      type: "text";
      text: string;
      tone?: "body" | "muted" | "title";
    }
  | { id: string; type: "image"; resourceUrl: string; alt?: string }
  | {
      id: string;
      type: "choices";
      actionId: string;
      choices: Array<{
        id: string;
        label: string;
        description?: string;
        payload?: JsonObject;
      }>;
    }
  | { id: string; type: "progress"; value: number; max: number; label?: string }
  | { id: string; type: "divider" };

export interface WorldInputSpec {
  mode: "text" | "voice" | "text-and-voice";
  placeholder?: string;
  submitLabel?: string;
}

export interface WorldView {
  revision: number;
  title?: string;
  background?: { color?: string; resourceUrl?: string };
  root: WorldViewElement;
  input?: WorldInputSpec;
  audio?: { autoPlay: boolean; allowInterrupt: boolean };
}

export interface PrimeWorldWorkflow {
  version: 1;
  nodes: PrimeWorldNode[];
  edges: PrimeWorldEdge[];
  editor: {
    positions: Record<string, { x: number; y: number }>;
    viewport?: { x: number; y: number; zoom: number };
  };
}

export interface PrimeWorldDetail {
  schemaVersion: 1;
  definitionRevision: number;
  workflow: PrimeWorldWorkflow;
  initialState: JsonObject;
  stateSchema?: JsonObject;
  presentation: {
    theme: "system" | "light" | "dark";
    accentColor?: string;
    startView: WorldView;
  };
}

export interface PrimeWorldRuntimeState {
  schemaVersion: 1;
  variables: JsonObject;
  view: WorldView;
  summaries: Record<
    string,
    { text: string; throughSequence: number; updatedAt: number }
  >;
  updatedAt: number;
}

export type PrimeWorldEventType =
  "world.start" | "ui.action" | "input.text" | "input.voice" | "timer.fired";

export interface PrimeWorldEventInput {
  clientEventId: string;
  type: PrimeWorldEventType;
  payload?: JsonObject;
  expectedViewRevision?: number;
  interruptCurrent?: boolean;
}

export interface PrimeWorldRun {
  id: string;
  eventId: string;
  conversationId: string;
  definitionRevision: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stateVersionBefore?: number;
  stateVersionAfter?: number;
  errorCode?: string;
  errorDetail?: string;
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
}

export interface PrimeWorldSnapshot {
  state: PrimeWorldRuntimeState;
  run?: PrimeWorldRun;
  stateVersion?: number;
}

export interface PrimeWorldValidationIssue {
  code: string;
  message: string;
  pointer: string;
  nodeId?: string;
  port?: string;
}
