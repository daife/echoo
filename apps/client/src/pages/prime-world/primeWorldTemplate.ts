import type { JsonObject, PrimeWorldDetail, WorldView } from "@echoo/shared";

const choiceView = (title: string, body: string): WorldView => ({
  revision: 0,
  title,
  root: {
    id: "root",
    type: "stack",
    children: [
      { id: "heading", type: "text", tone: "title", text: title },
      { id: "body", type: "text", text: body },
      { id: "divider", type: "divider" },
      {
        id: "next-step",
        type: "choices",
        actionId: "choose-path",
        choices: [
          {
            id: "explore",
            label: "走进发光的森林",
            description: "寻找声音的来源。",
          },
          {
            id: "rest",
            label: "留在营火旁",
            description: "整理线索并恢复体力。",
          },
        ],
      },
    ],
  },
  input: {
    mode: "text",
    placeholder: "也可以输入自己的行动…",
    submitLabel: "行动",
  },
});
const viewConfig = (title: string, body: string) =>
  choiceView(title, body) as unknown as JsonObject;

export const DEFAULT_PRIME_WORLD_DETAIL: PrimeWorldDetail = {
  schemaVersion: 1,
  definitionRevision: 0,
  initialState: { lastChoice: null, lastText: "" },
  presentation: {
    theme: "dark",
    accentColor: "#8b5cf6",
    startView: choiceView(
      "无名营地",
      "夜色落下，远处的森林正发出微弱蓝光。你准备怎么做？",
    ),
  },
  workflow: {
    version: 1,
    editor: {
      positions: {
        start: { x: 40, y: 40 },
        "start-view": { x: 280, y: 40 },
        action: { x: 40, y: 180 },
        branch: { x: 280, y: 180 },
        explore: { x: 520, y: 130 },
        rest: { x: 520, y: 250 },
        "explore-view": { x: 760, y: 130 },
        "rest-view": { x: 760, y: 250 },
        text: { x: 40, y: 380 },
        "save-text": { x: 280, y: 380 },
        "text-view": { x: 520, y: 380 },
      },
    },
    nodes: [
      { id: "start", type: "trigger.worldStart", version: 1, config: {} },
      {
        id: "start-view",
        type: "view.render",
        version: 1,
        config: {
          view: viewConfig(
            "无名营地",
            "夜色落下，远处的森林正发出微弱蓝光。你准备怎么做？",
          ),
        },
      },
      { id: "action", type: "trigger.uiAction", version: 1, config: {} },
      {
        id: "branch",
        type: "logic.switch",
        version: 1,
        config: {
          value: "{{input.choiceId}}",
          cases: { explore: "explore", rest: "rest" },
        },
      },
      {
        id: "explore",
        type: "state.set",
        version: 1,
        config: { path: "/lastChoice", value: "explore" },
      },
      {
        id: "rest",
        type: "state.set",
        version: 1,
        config: { path: "/lastChoice", value: "rest" },
      },
      {
        id: "explore-view",
        type: "view.render",
        version: 1,
        config: {
          view: viewConfig(
            "林间回声",
            "你拨开枝叶，发现蓝光来自一枚悬浮的种子。它似乎记得你的选择。",
          ),
        },
      },
      {
        id: "rest-view",
        type: "view.render",
        version: 1,
        config: {
          view: viewConfig(
            "营火余烬",
            "你在灰烬里找到半张旧地图，上面标着森林深处的一座塔。",
          ),
        },
      },
      { id: "text", type: "trigger.textInput", version: 1, config: {} },
      {
        id: "save-text",
        type: "state.set",
        version: 1,
        config: { path: "/lastText", value: "{{input.text}}" },
      },
      {
        id: "text-view",
        type: "view.render",
        version: 1,
        config: {
          view: viewConfig(
            "行动已记录",
            "你决定：{{input.text}}。世界记住了这次行动。",
          ),
        },
      },
    ],
    edges: [
      {
        id: "e-start",
        kind: "control",
        source: { nodeId: "start", port: "control" },
        target: { nodeId: "start-view", port: "control" },
      },
      {
        id: "e-action",
        kind: "control",
        source: { nodeId: "action", port: "control" },
        target: { nodeId: "branch", port: "control" },
      },
      {
        id: "e-explore",
        kind: "control",
        source: { nodeId: "branch", port: "explore" },
        target: { nodeId: "explore", port: "control" },
      },
      {
        id: "e-explore-view",
        kind: "control",
        source: { nodeId: "explore", port: "control" },
        target: { nodeId: "explore-view", port: "control" },
      },
      {
        id: "e-rest",
        kind: "control",
        source: { nodeId: "branch", port: "rest" },
        target: { nodeId: "rest", port: "control" },
      },
      {
        id: "e-rest-view",
        kind: "control",
        source: { nodeId: "rest", port: "control" },
        target: { nodeId: "rest-view", port: "control" },
      },
      {
        id: "e-text",
        kind: "control",
        source: { nodeId: "text", port: "control" },
        target: { nodeId: "save-text", port: "control" },
      },
      {
        id: "e-text-view",
        kind: "control",
        source: { nodeId: "save-text", port: "control" },
        target: { nodeId: "text-view", port: "control" },
      },
    ],
  },
};
