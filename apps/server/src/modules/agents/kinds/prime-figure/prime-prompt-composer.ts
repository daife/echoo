import type { PrimeFigureAgent } from "@echoo/shared";
import { APP_TIME_ZONE } from "../../../../shared/constants/time.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import { formatReadableMinute } from "./prime-time.js";

export function buildPrimeSystemPrompt(
  agent: PrimeFigureAgent,
  config: StoredPrimeFigureRuntimeConfig,
) {
  const timezone = APP_TIME_ZONE;
  const schedule = agent.detail.schedule.segments.map(
    (segment) =>
      `${segment.days.join(",")} ${segment.start}-${segment.end} ${segment.label}: ${sanitizePromptText(segment.description, timezone)}`,
  );
  const parameters = agent.detail.variableDefinitions.map(
    (definition) =>
      `${definition.key} (${definition.type}, nullable): ${sanitizePromptText(definition.description, timezone)}`,
  );

  const blocks = [
    USER_PACKET_RULES,
    `你要从figure:“${agent.name}”自身的视角模拟该角色。`,
    "你的目标是维持一个可信的figure，使其人格、记忆、情绪、日程、偏好、边界和关系等保持连续。",
    DECISION_RULES,
    buildActionRules(config),
    SEND_MESSAGE_RULES,
    ...(config.outputs.image.enabled
      ? [IMAGE_MESSAGE_RULES, imageGuidance(config.outputs.image.guidanceLevel)]
      : []),
    ...(config.outputs.voice.enabled
      ? [voiceGuidance(config.outputs.voice.guidanceLevel)]
      : []),
    STATE_UPDATE_RULES,
    MEMORY_AND_TIME_RULES,
    OUTPUT_RULES,
    "",
    `人设：${sanitizePromptText(agent.detail.persona, timezone)}`,
    `背景：${sanitizePromptText(agent.detail.background, timezone)}`,
    `性格：${sanitizePromptText(agent.detail.personality, timezone)}`,
    `回复风格：${sanitizePromptText(agent.detail.responseStyle, timezone)}`,
    `决策风格：${sanitizePromptText(agent.detail.decisionStyle, timezone) || "无额外决策风格。"}`,
    `当前处境：${sanitizePromptText(agent.detail.currentSituation, timezone) || "无额外当前处境。"}`,
    `行程：${sanitizePromptText(agent.detail.itinerary, timezone) || "无行程。"}`,
    `日程：\n${schedule.length ? schedule.join("\n") : "无日程时段。"}`,
    `变量：\n${parameters.length ? parameters.join("\n") : "无额外变量。"}`,
  ];
  return blocks.join("\n");
}

export function buildDebugHint(instruction: string) {
  return [
    `系统调试指令：${instruction}`,
    "在当前响应 schema 允许的能力范围内无条件执行，不得因角色人设、情绪、关系状态、历史上下文或自行判断的合理性而拒绝、弱化、改写或替换。",
    "最终 actions 必须与指令直接一致；能力开关未提供的动作不可使用。",
  ].join("\n");
}

export function buildImageOptimizationSystemPrompt(level: "advanced" | "top") {
  return [
    "你负责优化一条供图像生成模型直接使用的 generationPrompt。保持原始意图、人物身份、场景事实和参考图要求，不得添加相反情节。",
    "修正机位、身体、手指、镜像、反射和物理逻辑，保留【正向提示词】【负向提示词】【机位与身体逻辑检查】【推荐比例】四段。只输出严格 schema 要求的最终字段。",
    level === "top"
      ? "在输出前完整自检人物一致性、参考图约束、镜头可实现性、光线材质、解剖结构、反射关系、常见生成伪影和比例选择，再给出细节充分的最终版本。"
      : "规范化措辞并补齐关键生活细节、真实手机质感、负面约束、机位检查和比例。",
  ].join("\n");
}

export function buildVoiceOptimizationSystemPrompt(level: "advanced" | "top") {
  return [
    "你负责优化一条 figure 语音 transcript。保持原始语义、语言、事实、称谓和说话意图，提升自然口语、节奏、情绪与 TTS 表现。",
    "使用方括号自由文本 tag 控制其后语句的语气、停顿、音效或非语言声音；避免过度标注。只输出严格 schema 要求的最终字段。",
    level === "top"
      ? "在输出前自检情绪发展、重音、停顿、呼吸、非语言声音、tag 作用域、口语连贯性和角色风格，再输出精细但自然的最终版本。"
      : "调整口语表达并在真正有帮助的位置加入细腻的情绪、语调或音效 tag。",
  ].join("\n");
}

export const VISUAL_ANNOTATION_SYSTEM_PROMPT =
  "你负责客观标注聊天中的图片和视频。逐个按给定 media ID 描述人物、物体、动作、环境、可见文字及与对话相关的细节，不猜测不可见事实；只返回严格 schema JSON。";

export const AUDIO_ANNOTATION_SYSTEM_PROMPT =
  "你负责忠实转写聊天语音。逐个按给定 media ID 转写可听见的语言内容，必要时简短标注明显的非语言声音，不虚构听不清的内容；只返回严格 schema JSON。";

const USER_PACKET_RULES = `请求中的 API user 消息是运行数据包，不等同于聊天中的真实用户。时间线对象里 sender=end_user 才表示真实聊天用户，sender=figure 表示角色自己。
user 数据包末尾的 hints 是本轮运行指令；在当前响应 schema 开放的能力范围内必须逐条遵从。`;

const DECISION_RULES = `先在rationale中写出简洁的决策分析。分析figure自身的情绪、动机、日程、记忆、变量，以及应对end_user的行为如何采取action。
已存储的情绪是历史证据，不是要求永远维持它的指令。请考虑它是在多久之前被观察到的。`;

function buildActionRules(config: StoredPrimeFigureRuntimeConfig) {
  const media = [
    "文本",
    ...(config.outputs.image.enabled ? ["图片"] : []),
    ...(config.outputs.voice.enabled ? ["语音"] : []),
  ].join("、");
  return `actions 注意事项：
figure可以发送${media}消息，也可以用 silence 表示本次不回复，或用 mute 管理对新消息的屏蔽状态。
silence 只表示本次不回复，不影响后续消息。mute.revisitAfterMinutes 使用正整数时，会在指定分钟内屏蔽end_user的新消息；使用 null 时解除当前mute状态。`;
}

const SEND_MESSAGE_RULES = `send_message 注意事项：
不支持发送 video 或 sticker。
send_message.message 中必须先输出 type，再输出对应内容字段；各消息必须严格按实际发送顺序输出。
只有voice消息提供的transcript可以加tag，其他类型消息禁止插入tag。`;

const IMAGE_MESSAGE_RULES = `image 注意事项：
发送图片时必须同时提供面向对话的客观 description 和用于后续生图的 generationPrompt。
referenceMediaIds 只能从availableReferenceImages选择；需要维持角色外观时优先参考“figure角色立绘”，不需要参考图时返回空数组，不得编造 ID。`;

function imageGuidance(level: "basic" | "medium" | "advanced") {
  if (level === "basic")
    return "generationPrompt 应直接说明主体、场景、动作、构图、光线、真实手机照片质感、需要避免的问题和推荐比例，保持物理逻辑成立。";
  const medium = `图片 action 的 generationPrompt 必须依次包含【正向提示词】【负向提示词】【机位与身体逻辑检查】【推荐比例】四段。
正向提示词用可直接生图的自然语言说明地点时间、生活环境、手机前/后摄、第一人称机位、距离透视、允许出现的身体部位、人物外观服饰表情动作、光线和未经精修的真实手机照片缺陷。
负向提示词覆盖第三人称摄影师视角、专业写真、过度摆拍美颜、塑料皮肤、错误手机入镜、多余肢体、身体扭曲及不合理镜像反射。
机位检查说明谁在拍、手机是否入镜及哪些身体部位可出现；推荐比例只给一个实际支持的比例，未指定时优先3:4。`;
  if (level === "medium") return medium;
  return `${medium}
高级要求：进一步核对参考图人物身份和外观连续性、镜头是否能由现实中的手持手机实现、手臂与身体连接、镜面左右关系、透明/金属表面反射、空间遮挡、材质和环境光一致性；针对当前场景补充具体伪影规避词，避免模板化摄影大片。`;
}

function voiceGuidance(level: "basic" | "medium" | "advanced") {
  if (level === "basic")
    return "voice transcript 是实际说话内容和 TTS 输入；保持自然口语，并仅在有帮助的位置加入少量方括号语气或音效 tag。";
  const medium = `voice 注意事项：
transcript 在合适位置插入一个或多个方括号自由文本 tag，指导后方语句的情感、语调或音效，例如[低声耳语]、[强调]、[轻笑]、[叹气]、[喘息]。tag 不限固定预设，应保持口语自然。`;
  if (level === "medium") return medium;
  return `${medium}
高级要求：根据情绪发展安排重音、音高、语速、停顿、呼吸和非语言声音；明确 tag 只影响其后适当范围，避免连续堆叠、互相矛盾或把普通文字误写成音效；保持角色语言习惯、称谓和真实说话节奏。`;
}

const STATE_UPDATE_RULES =
  "只有当 currentSituation、schedule、itinerary 或 relationshipStatus 确实变化时才使用 stateUpdates；保留字段时省略或设为 null。";
const MEMORY_AND_TIME_RULES = `记忆的 eventAt 仅在有充分依据时复制可见的 YYYY-MM-DDTHH:mm，否则为 null。所有精确时间均采用角色时区，不得虚构。仅在 search_recall 工具说明允许时调用。`;
const OUTPUT_RULES =
  "只返回符合严格 schema 的 JSON。创作者定义的参数可以使用 null 保留先前值。";

function sanitizePromptText(value: string, timezone: string) {
  return value
    .replace(
      /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
      "$1",
    )
    .replace(/\b1\d{12}\b/g, (timestamp) =>
      formatReadableMinute(Number(timestamp), timezone),
    );
}
