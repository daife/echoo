export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type PrimeWorldNodeCategory =
  | "trigger"
  | "state"
  | "data"
  | "logic"
  | "flow"
  | "history"
  | "ai"
  | "audio"
  | "view"
  | "convert";

export type PrimeWorldNodeExecution =
  | "sync"
  | "async"
  | "stream-source"
  | "stream-sink";

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

export interface PrimeWorldPortDefinition {
  name: string;
  type: PrimeWorldPortType;
  required?: boolean;
  multiple?: boolean;
}

export interface PrimeWorldNodeCatalogEntry {
  type: string;
  version: number;
  title: string;
  description: string;
  category: PrimeWorldNodeCategory;
  execution: PrimeWorldNodeExecution;
  configSchema: JsonObject;
  inputs: PrimeWorldPortDefinition[];
  outputs: PrimeWorldPortDefinition[];
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
  | { id: string; type: "image"; resourceId: string; alt?: string }
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
  background?: { color?: string; resourceId?: string };
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

export type PrimeWorldTracePhase = "started" | "completed" | "failed";

export interface PrimeWorldRunTraceEntry {
  sequence: number;
  runId: string;
  nodeId: string;
  nodeType: string;
  phase: PrimeWorldTracePhase;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputSummary?: JsonObject;
  outputSummary?: JsonObject;
  usage?: JsonObject;
  errorCode?: string;
  errorDetail?: string;
}

export interface PrimeWorldRunResource {
  nodeId: string;
  port: string;
  resourceId: string;
  mimeType: string;
}

export interface PrimeWorldSnapshot {
  state: PrimeWorldRuntimeState;
  run?: PrimeWorldRun;
  stateVersion?: number;
  resources?: PrimeWorldRunResource[];
}

export interface PrimeWorldValidationIssue {
  code: string;
  message: string;
  pointer: string;
  nodeId?: string;
  port?: string;
}

export type PrimeWorldRealtimeEvent =
  | {
      type: "world.run.started" | "world.run.completed" | "world.run.cancelled";
      conversationId: string;
      runId: string;
      stateVersion?: number;
    }
  | {
      type: "world.run.failed";
      conversationId: string;
      runId: string;
      errorCode: string;
      message?: string;
    }
  | {
      type: "world.view.committed";
      conversationId: string;
      runId: string;
      view: WorldView;
      stateVersion: number;
    }
  | {
      type: "world.view.text_delta";
      conversationId: string;
      runId: string;
      nodeId: string;
      elementId: string;
      sequence: number;
      delta: string;
    }
  | {
      type: "world.audio.started";
      conversationId: string;
      runId: string;
      nodeId: string;
      port: string;
      mimeType: string;
    }
  | {
      type: "world.audio.completed";
      conversationId: string;
      runId: string;
      nodeId: string;
      port: string;
      resourceId?: string;
    }
  | {
      type: "world.audio.failed";
      conversationId: string;
      runId: string;
      nodeId: string;
      port: string;
      error: string;
    }
  | {
      type: "world.trace.entry";
      conversationId: string;
      runId: string;
      entry: PrimeWorldRunTraceEntry;
    };

export interface PrimeWorldExportedResource {
  key: string;
  usageKind: string;
  mimeType: string;
  fileName: string;
  dataBase64: string;
}

export interface PrimeWorldExportBundle {
  format: "echoo-prime-world";
  formatVersion: 1;
  name: string;
  attributes?: Array<{ key: string; value: string }>;
  tags?: string[];
  introduction?: string;
  isPublic: boolean;
  detail: PrimeWorldDetail;
  resources: PrimeWorldExportedResource[];
}
