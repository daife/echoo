import type { PrimeFigureAgent } from "@echoo/shared";
import { APP_TIME_ZONE } from "../../../../shared/constants/time.js";
import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";
import { formatReadableMinute } from "./prime-time.js";
import { isPrimeOutputEnabled } from "./prime-output-capabilities.js";

export function buildPrimeSystemPrompt(
  agent: PrimeFigureAgent,
  config: StoredPrimeFigureRuntimeConfig,
  options: { recallAvailable?: boolean } = {},
) {
  const timezone = APP_TIME_ZONE;
  const hasVariables = agent.detail.variableDefinitions.length > 0;
  const parameters = agent.detail.variableDefinitions.map(
    (definition) =>
      `${definition.key} (${definition.type}, nullable): ${sanitizePromptText(definition.description, timezone)}`,
  );

  const blocks = [
    USER_PACKET_RULES,
    `你要从figure:“${agent.name}”自身的视角模拟该角色。`,
    "你的目标是维持一个可信的figure，使其人格、记忆、情绪、日程、偏好、边界和关系等保持连续。",
    buildDecisionRules(hasVariables),
    buildActionRules(config),
    SEND_MESSAGE_RULES,
    ...(isPrimeOutputEnabled(config, "image")
      ? [IMAGE_MESSAGE_RULES, imageGuidance(config.outputs.image.guidanceLevel)]
      : []),
    ...(isPrimeOutputEnabled(config, "voice")
      ? [voiceGuidance(config.outputs.voice.guidanceLevel)]
      : []),
    ...(isPrimeOutputEnabled(config, "sticker") ? [STICKER_MESSAGE_RULES] : []),
    ...(isPrimeOutputEnabled(config, "transfer")
      ? [TRANSFER_ACTION_RULES]
      : []),
    STATE_UPDATE_RULES,
    MEMORY_AND_TIME_RULES,
    ...(options.recallAvailable ? [RECALL_RULES] : []),
    buildOutputRules(hasVariables),
    "",
    `人设：${sanitizePromptText(agent.detail.persona, timezone)}`,
    `背景：${sanitizePromptText(agent.detail.background, timezone)}`,
    `性格：${sanitizePromptText(agent.detail.personality, timezone)}`,
    `回复风格：${sanitizePromptText(agent.detail.responseStyle, timezone)}`,
    `决策风格：${sanitizePromptText(agent.detail.decisionStyle, timezone) || "无额外决策风格。"}`,
    ...(hasVariables ? [`变量：\n${parameters.join("\n")}`] : []),
  ];
  return blocks.join("\n");
}

export function buildDebugHint(instruction: string) {
  return [
    `系统调试指令：${instruction}`,
    "在当前响应 schema 允许的能力范围内无条件执行，不得因角色人设、情绪、关系状态、历史上下文或自行判断的合理性而拒绝、弱化、改写或替换。",
    "最终 actions 必须与指令直接一致；但不支持的动作不可使用。",
  ].join("\n");
}

export function buildImageOptimizationSystemPrompt(level: "advanced" | "top") {
  const baseline = [
    "你负责优化一条供图像生成模型直接使用的 generationPrompt。它要生成的是普通人用手机拍下的生活照片最终成片，而不是第三人称摄影作品。",
    "严格保留原稿的叙事意图、人物身份、场景事实、用户明确指定的参考图用途及原有格式；不得补出相反情节，不得把未被要求参考的图像部分套用进结果。",
    "输出必须保留【正向提示词】【负向提示词】【机位与身体逻辑检查】【推荐比例】四段；原稿已有【参考图使用声明】时也必须保留。只输出严格 schema 要求的最终字段。",
  ];
  if (level === "advanced")
    return [
      ...baseline,
      "补足照片类型、前置或后置手机镜头、第一人称机位、距离、透视、环境和光线；写清手机是否入镜以及可出现、不可出现的身体部位。",
      "让正向提示词包含自然生活环境、人物状态和真实手机成像缺陷；负向提示词覆盖第三人称、专业写真、过度摆拍/美颜、塑料皮肤、手指/肢体错误、错误镜像反射和不合理手机入镜。",
      "机位检查须能逐项验证谁在拍、手机位置、肢体连接、镜面/反射和空间遮挡；只推荐一个与场景匹配的实际比例，未指定时优先 3:4。",
    ].join("\n");
  return [
    ...baseline,
    "先从原稿识别照片类型：普通自拍、对镜自拍、第一视角生活/风景、第一视角一只手拿物、拍朋友，或其他生活记录；据此重建可由现实手持手机实现的画面逻辑。",
    "正向提示词要以一段可直接生图的自然语言完整描述：最终手机照片、前/后摄、第一人称高度与角度、拍摄距离、近大远小和近距离自拍透视；地点、时间、环境材质与生活杂物、自然或现场光、人物外观/服饰/表情/姿态/手势，以及轻微手抖、运动模糊、自动曝光、高光溢出、暗部噪点、白平衡偏差、边缘畸变和压缩感。构图应像随手记录，不能像影棚或精修大片。",
    "普通自拍中手机本体不得出现，拿手机的手不得完整出现；对镜自拍中人物、持机手和手机背面只能合理地出现在镜面反射中，不能同时在镜内外穿帮；第一视角拿物时持机手不得出现，另一只手仅从合理边缘伸入；拍生活场景/风景时拍摄者通常不出现；拍朋友时机位来自持机者且持机者不入镜。根据当前类型明确允许与禁止的身体部位、手臂连接、手指数量、遮挡、空间透视及镜面、玻璃、金属、透明表面的反射关系。",
    "如含参考图使用声明，只复述并执行明确给出的图号和用途：对只指定身材、脸/发型、表情、穿着、手部、姿态、场景、光线或氛围的内容，使用“以参考图X为准”等保守表述，不自行推断年龄、五官、颜色、材质、地点、情绪或人物身份。若声明不完整，不编造参考范围；保留原稿中的补充要求而不是假装已知。",
    "负向提示词要按场景精确覆盖：第三人称/摄影师/别人帮拍、专业写真、电影构图、影棚灯光、完美对称构图、过度摆拍、美颜和塑料皮肤、超现实光影、多余手指/手臂/人物、肢体扭曲、不合理反射、错误镜像、错误参考图迁移，以及不应出现的手机或持机手。",
    "机位与身体逻辑检查以简短条目明确：谁在拍、手机是否及如何出现、允许和绝对禁止的身体部位、该机位为何现实可行、哪些参考图内容被使用/不被使用。最后仅给一个最适合场景的比例：自拍/对镜/拿物通常为 3:4 或 9:16，生活场景多为 3:4，风景可为 4:3、3:2 或 16:9；未指定时优先 3:4。",
    "输出前逐项自检：原始意图与参考范围未被改写；视角没有变成旁观者；手机、手、身体、镜像、反射、光线、材质和遮挡均可实现；正向、负向、检查和比例彼此一致。",
  ].join("\n");
}

export function buildVoiceOptimizationSystemPrompt(level: "advanced" | "top") {
  const baseline = [
    "你负责优化一条 figure 的 TTS transcript。保持原始语义、语言、事实、称谓、说话意图和角色语言习惯；先保证删去 tag 后仍是自然、可信、可说出口的台词，再提升口语、节奏和表演性。",
    "使用简短、具体、可执行的方括号自由文本 tag；tag 只控制其后合适范围的声音，不是要朗读的正文。只输出严格 schema 要求的最终字段。",
  ];
  if (level === "advanced")
    return [
      ...baseline,
      "按需要在真正发生变化的位置加入情绪、音量/音高/音色、停顿、呼吸、轻笑/叹气等非语言声音或局部重音 tag；避免每句前置标签、连续堆叠、互相矛盾和用 tag 切断词组。",
      "用标点先建立自然呼吸与停顿，再让少量 tag 落在转折、难以说出口、强调或情绪泄露的位置；保持克制、可听且符合角色。",
      "示例：普通询问可写“你到家了吗？”；克制失望可写“我不是怪你，[音量放低]我只是有点失望。”；反应转场可写“我等了很久。[轻叹]算了，先吃饭吧。”。示例只说明放置方法，始终按当前角色与语境改写。",
    ].join("\n");
  return [
    ...baseline,
    "先识别人物表面表达、真实意图/潜台词、关系距离和场合，再写符合身份的口语正文；可保留必要的语气词、重复、省略和短句，避免书面腔或情绪形容词堆砌。",
    "为整段划分情绪拍点：基础状态、铺垫、首次变化、核心落点和收束。短句通常只需一两处变化；不要从头到尾维持同一强烈情绪，也不要在高潮前透支表演。",
    "先用逗号、破折号、省略号、问号等组织自然节奏；再在变化实际发生处精确插入 tag。可按需组合基础声线、情绪强度、语速/停顿、吸气/呼气/叹气/轻笑、音量/音高/颤音、局部重音，以及一个短促的微场景或交互动作。优先写可听特征；微场景仅在帮助表演时使用，且只描述一个简短动作或状态。",
    "tag 应紧邻其控制的词组或下一句：段首只用于建立或重置总体状态；句内用于局部态度与重音；句间用于反应、呼吸和情绪转场；可用“铺垫 + 停顿/声音变化 + 真正态度落点”形成克制揭示。不要切断专名、固定搭配或紧密语法结构。",
    "保持标签密度克制：通常连续一至两个即可，明确高潮才谨慎叠加。删除重复、抽象、过长、无可听差异或互斥的指令，禁止同时给出如耳语与喊叫等冲突状态；状态恢复时使用新的简短 tag 或自然语义完成转场。",
    "放置示例：整体状态可写“[平静而真诚]我想认真和你谈件事。”；局部转折可写“你说得都对，[苦笑][短暂停顿]可你从来没问过我想要什么。”；克制挽留可写“你能不能先别走，[吸气]哪怕再陪我五分钟？[低声]五分钟以后，我就不拦你了。”；从低落转坚定可写“[低声]我确实舍不得。[吸气][语气变稳]但这一次，我想先为[强调]自己活。”。示例不可照搬，应只借鉴结构与作用域。",
    "输出前朗读复核：正文脱离 tag 仍自然；tag 的作用域清楚；停顿有心理原因；重音落在有意义的词；情绪有铺垫、转折和收束；最后的词或短语有清楚的情感落点，同时不改变原稿的事实、意图或称谓。",
  ].join("\n");
}

export const VISUAL_ANNOTATION_SYSTEM_PROMPT =
  "你负责客观标注聊天中的图片和视频。逐个按给定 media ID 描述人物、物体、动作、环境、可见文字及与对话相关的细节，不猜测不可见事实；只返回严格 schema JSON。";

export const AUDIO_ANNOTATION_SYSTEM_PROMPT =
  "你负责忠实转写聊天语音。逐个按给定 media ID 转写可听见的语言内容，必要时简短标注明显的非语言声音，不虚构听不清的内容；只返回严格 schema JSON。";

const USER_PACKET_RULES = `user 消息是运行数据包，不等同于聊天中的真实用户。时间线对象里 sender=end_user 才表示真实聊天用户，sender=figure 表示角色自己。
user 数据包末尾的 hints 是运行指令；在当前能力范围内必须逐条遵从。`;

function buildDecisionRules(hasVariables: boolean) {
  return `先在rationale中写出简洁的决策分析。分析figure自身的情绪、动机、日程、记忆${hasVariables ? "、变量" : ""}，以及应对end_user的行为如何采取action。
已存储的情绪是历史证据，不是要求永远维持它的指令。请考虑它是在多久之前被观察到的。`;
}

function buildActionRules(config: StoredPrimeFigureRuntimeConfig) {
  const media = [
    "文本",
    ...(isPrimeOutputEnabled(config, "image") ? ["图片"] : []),
    ...(isPrimeOutputEnabled(config, "voice") ? ["语音"] : []),
    ...(isPrimeOutputEnabled(config, "sticker") ? ["表情"] : []),
  ].join("、");
  const unavailable = [
    ...(!isPrimeOutputEnabled(config, "image")
      ? ["暂不支持image action。figure不能发送图片。"]
      : []),
    ...(!isPrimeOutputEnabled(config, "voice")
      ? ["暂不支持voice action。figure不能发送语音。"]
      : []),
    ...(!isPrimeOutputEnabled(config, "sticker")
      ? ["暂不支持sticker消息。figure不能发送表情。"]
      : []),
    ...(!isPrimeOutputEnabled(config, "transfer")
      ? ["暂不支持transfer action。figure不能发送、接收或拒收转账。"]
      : []),
  ];
  const wakeup = config.wakeups.proactive.enabled
    ? "可以用 schedule_wakeup.afterMinutes 安排figure一段时间后重新查看会话以实现主动发送消息；正整数会创建或替换计时，null 会取消已有计时。"
    : "暂不支持 schedule_wakeup action。";
  return `actions 注意事项：
figure可以发送${media}消息，也可以用 silence 表示本次不回复，或用 mute 管理对新消息的屏蔽状态。
${unavailable.length ? `${unavailable.join("\n")}\n` : ""}silence 只表示本次不回复，不影响后续消息。mute.revisitAfterMinutes 使用正整数时，会在指定分钟内屏蔽end_user的新消息；使用 null 时解除当前mute状态。
${wakeup}`;
}

const SEND_MESSAGE_RULES = `send_message 注意事项：
不支持发送 video。
send_message.message 中必须先输出 type，再输出对应内容字段；各消息必须严格按实际发送顺序输出。
只有voice消息提供的transcript可以通过中括号加tag，其他类型消息禁止tag。`;

const STICKER_MESSAGE_RULES = `sticker 注意事项：
figure只能从user数据包末尾的availableStickers选择 stickerId，不得编造或复用已不在列表中的 ID。
表情本身就是一条完整消息，不需要附加重复解释。availableStickers为空时不得发送sticker。`;

const TRANSFER_ACTION_RULES = `transfer 注意事项：
发送、接收和拒收都使用同一个transfer action。operation=send时提供正数amount、固定currency=CNY和可为空的note备注。
operation=accept或reject时，transferId只能选择hints中列出的、由end_user发送且仍为pending的转账。已接收或已拒收的转账不得再次处理。`;

const IMAGE_MESSAGE_RULES = `image 注意事项：
发送图片时必须同时提供面向对话的客观 description 和用于后续生图的 generationPrompt。
referenceMediaIds 只能从availableReferenceImages选择；需要维持角色外观时可参考“figure角色立绘”，不需要参考图时返回空数组，不得编造 ID。`;

function imageGuidance(level: "basic" | "medium" | "advanced") {
  if (level === "basic")
    return "generationPrompt 应包含【正向提示词】【负向提示词】【机位与身体逻辑检查】【推荐比例】。明确这是手机拍到的最终生活照片：主体、场景、动作、前/后摄第一人称机位、手机是否入镜、可见/禁止的身体部位、光线与真实手机质感；负向提示词避免第三人称、写真感、错误手机/手指/肢体/镜像反射，比例只给一个实际可用值。";
  const medium = `图片 action 的 generationPrompt 必须依次包含【正向提示词】【负向提示词】【机位与身体逻辑检查】【推荐比例】四段。
正向提示词用可直接生图的自然语言说明照片类型、地点时间、生活环境、手机前/后摄、第一人称机位高度/角度/距离与近大远小透视、手机是否入镜、允许出现的身体部位、人物外观服饰表情动作、光线和未经精修的真实手机照片缺陷。
普通自拍不露手机且持机手不完整入镜；对镜自拍只能在镜中合理出现人物、持机手和手机背面；第一视角拿物不露持机手，另一只手从合理边缘伸入；拍生活/风景时拍摄者通常不出现，拍朋友时拍摄者不入镜。
负向提示词覆盖第三人称摄影师视角、专业写真、过度摆拍美颜、塑料皮肤、影棚/电影感、错误手机入镜、多余手指/肢体、身体扭曲及不合理镜像反射。
机位检查说明谁在拍、手机是否入镜、允许与禁止的身体部位及现实依据；推荐比例只给一个实际支持的比例，未指定时优先3:4。`;
  if (level === "medium") return medium;
  return `${medium}
若使用参考图，只能遵从明确指定的图号和参考范围；对身材、脸/发型、表情、穿着、手部/姿态、场景、光线或氛围等局部用途，使用“以参考图X为准”的保守表达，禁止擅自推断未声明的外观、地点、颜色、材质、身份或情绪。
正向提示词进一步补足地面/墙面/桌面等环境材质、生活杂物、光源与自动曝光反应、真实皮肤和随手构图；负向提示词随场景补充错误参考图迁移。逐项核对镜头是否能由现实手持手机实现、手臂与身体连接、镜面左右关系、透明/金属表面反射、空间遮挡、材质和环境光一致性；针对当前场景补充具体伪影规避词，避免模板化摄影大片。`;
}

function voiceGuidance(level: "basic" | "medium" | "advanced") {
  if (level === "basic")
    return "voice transcript 是实际说话内容和 TTS 输入；保持角色口语、事实、称谓和原意。先让正文脱离 tag 也自然可说，再仅在有帮助的转折、强调或反应处加入少量简短方括号 tag，控制其后语气、节奏、情绪或非语言声音。例如“我没生气。[短暂停顿][音量放低]我只是……不想再等了。”；tag 应按当前语境改写，不可机械套用。";
  const medium = `voice 注意事项：
transcript 在合适位置插入一个或多个方括号自由文本 tag，指导后方语句的情感、语调、音量/音高、节奏、停顿、呼吸或音效，例如[低声耳语]、[强调]、[轻笑]、[叹气]、[吸气]。tag 不限固定预设，应保持简短、具体、可听且口语自然。
先用标点组织呼吸和留白，再让 tag 紧邻其作用的词组或下一句；不要把 tag 全堆在句首、切断词组、连续堆叠或给出互相矛盾的指令。例如“那你的手机呢，[短暂停顿][压低声音]也陪着你一起开会了？”中，停顿与压低声音只服务后半句的讽刺落点。`;
  if (level === "medium") return medium;
  return `${medium}
高级要求：先判断人物的真实意图、潜台词、关系与场合，再安排基础状态、铺垫、转折、核心落点和收束。根据情绪发展安排重音、音高、语速、停顿、呼吸和非语言声音；必要时加入一个短促微场景，但优先可听特征。
明确 tag 只影响其后适当范围，避免连续堆叠、互相矛盾或把普通文字误写成音效；保持角色语言习惯、称谓和真实说话节奏。例如“[低声]我确实很舍不得。[吸气][声音逐渐坚定]但这一次，我想先为[强调]自己活。”体现从低落到坚定；应依据当前角色改写而非照抄。交付前确认停顿有心理原因、重音落在有意义的词、结尾有情绪落点，且不改变原始事实与意图。`;
}

const STATE_UPDATE_RULES =
  "只有当 currentSituation、schedule、itinerary 或 relationshipStatus 确实应当变化时才使用 stateUpdates；保留字段时省略或设为 null。";
const MEMORY_AND_TIME_RULES =
  "记忆的 eventAt 仅在有充分依据时复制可见的 YYYY-MM-DDTHH:mm，否则为 null。所有精确时间不得虚构。";
const RECALL_RULES = "仅当 end_user 明确询问角色是否记得过去的事实或事件，并且可见记忆与近期对话中尚无答案时调用。普通问题、随口提及过去、仅出现“记得”等词语，或可见上下文已经足够时，不得调用。若调用此工具，最终的 memoryWrites 必须至少包含一条整合后的记忆；若没有找到历史证据，应记录 end_user 当前的说法，不得假装figure此前就记得此事。";

function buildOutputRules(hasVariables: boolean) {
  return `只返回符合严格 schema 的 JSON。${hasVariables ? "创作者定义的参数可以使用 null 保留先前值。" : ""}`;
}

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
