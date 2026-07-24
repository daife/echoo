import {
  Archive,
  FloppyDisk,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import type {
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
  PrimeFigureRuntimeConfigPatch,
  PrimeFigureRuntimeConfigView,
  PrimeWorldRuntimeConfigPatch,
  PrimeWorldRuntimeConfigView,
  PrimeWorldExportBundle,
  SliceFigureRuntimeConfigPatch,
  SliceFigureRuntimeConfigView,
} from "@echoo/shared";
import type { PublicAssetDraft } from "@echoo/shared/public-assets";
import { useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import {
  buildSlicePayload,
  PrimeFigureForm,
  SliceFigureFormFields,
} from "../create-agent/CreateAgentPage";
import {
  PrimeWorldRuntimeConfigForm,
  PrimeRuntimeConfigForm,
  SliceRuntimeConfigForm,
} from "../../features/runtime-config/RuntimeConfigForms";
import type { PublicAssetService } from "../../services/PublicAssetService";
import { useServices } from "../../app/providers/ServicesProvider";
import { PrimeWorldEditorPage } from "../prime-world/PrimeWorldEditorPage";
import { BackButton } from "../../shared/components/BackButton";
import {
  PrimeWorldBundleInput,
  PrimeWorldMetadataFields,
  parsePrimeWorldBundleText,
} from "../create-agent/PrimeWorldAuthoringFields";

export function PublicAssetEditorPage({
  draft,
  service,
  onDraftChange,
  onDeleted,
  onBack,
}: {
  draft: PublicAssetDraft;
  service: PublicAssetService;
  onDraftChange: (draft: PublicAssetDraft) => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"content" | "recommendation">("content");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await service.publishDraft(draft.id);
      const next = await service.getDraft(draft.id);
      onDraftChange(next);
      setNotice(next.status === "published" ? "公共版本已发布。" : "已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发布失败。");
    } finally {
      setBusy(false);
    }
  };

  const unlist = async () => {
    setBusy(true);
    try {
      await service.unlist(draft.id);
      const next = await service.getDraft(draft.id);
      onDraftChange(next);
      setNotice("公共资产已下架，草稿仍可继续编辑。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "下架失败。");
    } finally {
      setBusy(false);
    }
  };

  const deletePermanently = async () => {
    const confirmed = window.confirm(
      draft.status === "draft"
        ? "确定删除这个未发布草稿吗？草稿内容将无法恢复。"
        : "确定彻底删除这个公共作品吗？作品、历史版本、点赞和评论将无法恢复；其他用户已经添加的角色不会被删除，但之后无法再从该作品更新。",
    );
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    try {
      await service.delete(draft.id);
      onDeleted();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "彻底删除失败。");
      setBusy(false);
    }
  };

  return (
    <section className="space-y-7 pb-20">
      <header className="sticky top-3 z-30 rounded-2xl border border-white/10 bg-[#0d0d10]/90 p-4 backdrop-blur-2xl md:top-5 md:p-5">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-4 md:flex md:flex-wrap md:gap-4">
          <BackButton onClick={onBack} />
          <div className="min-w-0 md:flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-white">
                {draft.snapshot.name}
              </h1>
              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/42">
                {statusLabel(draft.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-white/38">
              公共草稿独立于本地会话
              {draft.latestVersionNumber
                ? ` · 当前 v${draft.latestVersionNumber}`
                : ""}
            </p>
          </div>
          <div className="col-span-2 flex items-center justify-end gap-2 border-t border-white/8 pt-3 md:ml-auto md:border-0 md:pt-0">
            {draft.status === "published" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void unlist()}
                className="flex items-center gap-2 rounded-full px-3 py-2 text-xs text-white/48 hover:bg-white/[0.05] hover:text-white disabled:opacity-40 md:px-4"
              >
                <Archive size={15} /> 下架
              </button>
            ) : null}
            {draft.status === "draft" || draft.status === "unlisted" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void deletePermanently()}
                className="flex items-center gap-2 rounded-full px-3 py-2 text-xs text-red-200/65 hover:bg-red-400/10 hover:text-red-100 disabled:opacity-40 md:px-4"
              >
                <Trash size={15} />
                {draft.status === "draft" ? "删除草稿" : "彻底删除"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={
                busy ||
                (draft.status === "published" && !draft.hasUnpublishedChanges)
              }
              onClick={() => void publish()}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-xs font-medium text-black disabled:cursor-default disabled:bg-white/10 disabled:text-white/35 md:px-5"
            >
              <UploadSimple size={15} />
              {draft.status === "unlisted" && !draft.hasUnpublishedChanges
                ? "重新上架"
                : draft.latestVersionNumber
                  ? "发布新版本"
                  : "首次发布"}
            </button>
          </div>
        </div>
        {notice ? <p className="mt-3 text-xs text-white/52">{notice}</p> : null}
      </header>

      <div className="grid grid-cols-2 gap-1 rounded-full border border-white/8 bg-white/[0.025] p-1">
        {(
          [
            ["content", draft.snapshot.type === "prime-world" ? "世界内容" : "角色内容"],
            ["recommendation", "推荐配置"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full py-3 text-sm transition ${tab === id ? "bg-white text-black" : "text-white/45 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "content" ? (
        <CharacterDraftForm
          key={`${draft.id}-${draft.updatedAt}`}
          draft={draft}
          service={service}
          onSaved={(next) => {
            onDraftChange(next);
            setNotice("资产草稿已保存，线上版本没有变化。");
          }}
        />
      ) : (
        <RecommendationDraftForm
          key={`${draft.id}-${draft.updatedAt}`}
          draft={draft}
          service={service}
          onSaved={(next) => {
            onDraftChange(next);
            setNotice("推荐配置草稿已保存。");
          }}
        />
      )}
    </section>
  );
}

function CharacterDraftForm({
  draft,
  service,
  onSaved,
}: {
  draft: PublicAssetDraft;
  service: PublicAssetService;
  onSaved: (draft: PublicAssetDraft) => void;
}) {
  const { user } = useAuth();
  const { primeWorldService } = useServices();
  const snapshot = draft.snapshot;
  if (snapshot.type === "prime-world") {
    return (
      <WorldDraftForm
        draft={draft as PublicAssetDraft & {
          snapshot: Extract<PublicAssetDraft["snapshot"], { type: "prime-world" }>;
        }}
        service={service}
        primeWorldService={primeWorldService}
        onSaved={onSaved}
      />
    );
  }
  if (snapshot.type === "prime-figure") {
    const form: CreatePrimeFigureRequest = {
      type: "prime-figure",
      name: snapshot.name,
      attributes: snapshot.attributes,
      tags: snapshot.tags,
      introduction: snapshot.introduction,
      prologueHtml: snapshot.detail.prologueHtml,
      linkedAgentIds: snapshot.detail.linkedAgentIds,
      unlockConditions: snapshot.detail.unlockConditions ?? null,
      isPublic: false,
      persona: snapshot.detail.persona,
      background: snapshot.detail.background,
      personality: snapshot.detail.personality,
      responseStyle: snapshot.detail.responseStyle,
      decisionStyle: snapshot.detail.decisionStyle,
      currentSituation: snapshot.detail.currentSituation,
      schedule: snapshot.detail.schedule,
      itinerary: snapshot.detail.itinerary,
      variableDefinitions: snapshot.detail.variableDefinitions,
      referenceImages: snapshot.detail.referenceImages.map((item) => ({
        resourceId: item.resourceId,
        description: item.description,
      })),
      stickers: (snapshot.detail.stickers ?? []).map((item) => ({
        resourceId: item.resourceId,
        description: item.description,
      })),
      initialMood: snapshot.detail.initialMood,
      initialRelationshipStatus: snapshot.detail.initialRelationshipStatus,
    };
    return (
      <PrimeFigureForm
        mode="edit"
        initialForm={form}
        existingAvatarUrl={snapshot.avatarResourcePath}
        existingCoverUrl={snapshot.coverResourcePath}
        existingReferenceImages={snapshot.detail.referenceImages}
        existingStickers={snapshot.detail.stickers ?? []}
        onSubmit={async (input) => {
          onSaved(await service.saveDraftContent(draft.id, input));
        }}
      />
    );
  }
  return (
    <SliceDraftForm
      draft={draft}
      service={service}
      user={user}
      onSaved={onSaved}
    />
  );
}

function WorldDraftForm({
  draft,
  service,
  primeWorldService,
  onSaved,
}: {
  draft: PublicAssetDraft & {
    snapshot: Extract<PublicAssetDraft["snapshot"], { type: "prime-world" }>;
  };
  service: PublicAssetService;
  primeWorldService: ReturnType<typeof useServices>["primeWorldService"];
  onSaved: (draft: PublicAssetDraft) => void;
}) {
  const [name, setName] = useState(draft.snapshot.name);
  const [introduction, setIntroduction] = useState(
    draft.snapshot.introduction,
  );
  const [attributes, setAttributes] = useState(draft.snapshot.attributes);
  const [tags, setTags] = useState(draft.snapshot.tags);
  const [detail, setDetail] = useState(draft.snapshot.detail);
  const [bundle, setBundle] = useState<PrimeWorldExportBundle | null>(null);
  const [bundleText, setBundleText] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const applyBundle = () => {
    try {
      const parsed = parsePrimeWorldBundleText(bundleText);
      setBundle(parsed);
      setName(parsed.name);
      setAttributes(parsed.attributes ?? []);
      setTags(parsed.tags ?? []);
      setIntroduction(parsed.introduction ?? "");
      setDetail(parsed.detail);
      setEditorRevision((current) => current + 1);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `bundle JSON 无效：${cause.message}`
          : "bundle JSON 无效。",
      );
    }
  };
  return (
    <div className="space-y-5">
      <div className="glass-panel space-y-4 rounded-2xl p-5 md:p-6">
        <PrimeWorldBundleInput
          value={bundleText}
          onChange={setBundleText}
          onApply={applyBundle}
        />
        <PrimeWorldMetadataFields
          name={name}
          tags={tags}
          introduction={introduction}
          onNameChange={setName}
          onTagsChange={setTags}
          onIntroductionChange={setIntroduction}
        />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
      <div className="h-[min(46rem,calc(100dvh-2rem))] min-h-[32rem] overflow-hidden rounded-2xl border border-white/8 bg-[#0b0b0d]">
        <PrimeWorldEditorPage
          key={editorRevision}
          detail={detail}
          service={primeWorldService}
          saveLabel="校验并保存世界草稿"
          onSave={async (detail) => {
            const metadata = {
              name: name.trim(),
              attributes,
              tags: tags.map((tag) => tag.trim()).filter(Boolean),
              introduction: introduction.trim(),
              detail,
            };
            if (bundle) {
              onSaved(await service.saveDraftBundle(draft.id, {
                bundle: { ...bundle, ...metadata },
              }));
              return;
            }
            const payload: CreatePrimeWorldRequest = {
              type: "prime-world",
              ...metadata,
              isPublic: false,
            };
            onSaved(await service.saveDraftContent(draft.id, payload));
          }}
        />
      </div>
    </div>
  );
}

function SliceDraftForm({
  draft,
  service,
  user,
  onSaved,
}: {
  draft: PublicAssetDraft;
  service: PublicAssetService;
  user: { displayName: string } | null;
  onSaved: (draft: PublicAssetDraft) => void;
}) {
  const snapshot = draft.snapshot as Extract<
    typeof draft.snapshot,
    { type: "slice-figure" }
  >;
  const [form, setForm] = useState<CreateSliceFigureRequest>({
    type: "slice-figure",
    name: snapshot.name,
    attributes: snapshot.attributes,
    tags: snapshot.tags,
    introduction: snapshot.introduction,
    prologueHtml: snapshot.detail.prologueHtml,
    currentSituation: snapshot.detail.currentSituation,
    openingLine: snapshot.detail.openingLine,
    linkedAgentIds: snapshot.detail.linkedAgentIds,
    unlockConditions: snapshot.detail.unlockConditions ?? null,
    isPublic: false,
    persona: snapshot.detail.persona,
    background: snapshot.detail.background,
    personality: snapshot.detail.personality,
    responseStyle: snapshot.detail.responseStyle,
    systemPrompt: snapshot.detail.systemPrompt,
    memorySummaryPrompt: snapshot.detail.memorySummaryPrompt,
  });
  const [unlockText, setUnlockText] = useState(
    snapshot.detail.unlockConditions
      ? JSON.stringify(snapshot.detail.unlockConditions, null, 2)
      : "",
  );
  const [jsonInput, setJsonInput] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="glass-panel rounded-2xl p-6 md:p-8"
      onSubmit={async (event) => {
        event.preventDefault();
        const payload = buildSlicePayload(form, unlockText);
        if (typeof payload === "string") return setError(payload);
        setSaving(true);
        setError(null);
        try {
          onSaved(await service.saveDraftContent(draft.id, payload));
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "保存失败。");
        } finally {
          setSaving(false);
        }
      }}
    >
      <SliceFigureFormFields
        form={form}
        jsonInput={jsonInput}
        unlockText={unlockText}
        promptPreview={preview}
        user={user}
        existingAvatarUrl={snapshot.avatarResourcePath}
        existingCoverUrl={snapshot.coverResourcePath}
        onApplyJson={() => {
          try {
            setForm({
              ...form,
              ...JSON.parse(jsonInput),
              type: "slice-figure",
              isPublic: false,
            });
            setError(null);
          } catch {
            setError("JSON 无法解析，请检查格式。");
          }
        }}
        onJsonInputChange={setJsonInput}
        onUnlockTextChange={setUnlockText}
        onPromptPreviewChange={setPreview}
        onChange={(key, value) =>
          setForm((current) => ({ ...current, [key]: value }))
        }
      />
      {error ? <p className="mt-5 text-sm text-red-200/75">{error}</p> : null}
      <button
        type="submit"
        disabled={saving}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-40"
      >
        <FloppyDisk size={16} /> {saving ? "保存中……" : "保存角色草稿"}
      </button>
    </form>
  );
}

function RecommendationDraftForm({
  draft,
  service,
  onSaved,
}: {
  draft: PublicAssetDraft;
  service: PublicAssetService;
  onSaved: (draft: PublicAssetDraft) => void;
}) {
  const [enabled, setEnabled] = useState(
    Boolean(draft.recommendedRuntimeConfig),
  );
  const config = draft.recommendedRuntimeConfig?.config;
  const saveDisabled = async () =>
    onSaved(
      await service.saveDraftRecommendation(draft.id, { enabled: false }),
    );
  return (
    <div className="glass-panel rounded-2xl p-6 md:p-8">
      <div className="mb-7 flex items-center justify-between gap-5 border-b border-white/8 pb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">推荐运行配置</h2>
          <p className="mt-2 text-sm leading-6 text-white/42">
            只包含平台模型和参数，不包含你的密钥或本地会话设置。
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (event) => {
            const next = event.target.checked;
            setEnabled(next);
            if (!next) await saveDisabled();
            else
              onSaved(
                await service.saveDraftRecommendation(draft.id, {
                  enabled: true,
                }),
              );
          }}
          className="accent-white"
        />
      </div>
      {!enabled ? (
        <p className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-white/35">
          此公共版本不会附带推荐运行配置。
        </p>
      ) : !config ? (
        <p className="text-sm text-white/38">正在载入平台默认配置……</p>
      ) : draft.snapshot.type === "slice-figure" ? (
        <SliceRuntimeConfigForm
          value={
            withSecretViews(config) as unknown as SliceFigureRuntimeConfigView
          }
          platformOnly
          onSave={async (patch: SliceFigureRuntimeConfigPatch) => {
            const merged = stripSecrets(
              deepMerge(config, patch as unknown as Record<string, unknown>),
            );
            onSaved(
              await service.saveDraftRecommendation(draft.id, {
                enabled: true,
                config: merged,
              }),
            );
          }}
        />
      ) : draft.snapshot.type === "prime-figure" ? (
        <PrimeRuntimeConfigForm
          value={
            withSecretViews(config) as unknown as PrimeFigureRuntimeConfigView
          }
          platformOnly
          onSave={async (patch: PrimeFigureRuntimeConfigPatch) => {
            const merged = stripSecrets(
              deepMerge(config, patch as unknown as Record<string, unknown>),
            );
            onSaved(
              await service.saveDraftRecommendation(draft.id, {
                enabled: true,
                config: merged,
              }),
            );
          }}
        />
      ) : (
        <PrimeWorldRuntimeConfigForm
          value={
            withSecretViews(config) as unknown as PrimeWorldRuntimeConfigView
          }
          onSave={async (patch: PrimeWorldRuntimeConfigPatch) => {
            const merged = stripSecrets(
              deepMerge(config, patch as unknown as Record<string, unknown>),
            );
            onSaved(
              await service.saveDraftRecommendation(draft.id, {
                enabled: true,
                config: merged,
              }),
            );
          }}
        />
      )}
    </div>
  );
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    )
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    else if (value !== undefined) result[key] = value;
  }
  return result;
}

function withSecretViews(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSecretViews);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, withSecretViews(item)]),
  );
  if ("source" in source) result.apiKey = { configured: false };
  return result;
}

function stripSecrets(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["apiKey", "baseUrl", "httpUrl", "wsUrl"].includes(key)) continue;
    result[key] =
      item && typeof item === "object" && !Array.isArray(item)
        ? stripSecrets(item as Record<string, unknown>)
        : item;
  }
  return result;
}

function statusLabel(status: PublicAssetDraft["status"]) {
  if (status === "published") return "已发布";
  if (status === "unlisted") return "已下架";
  return "未发布草稿";
}
