import {
  type Agent,
  type AgentAttribute,
  type CreatePrimeWorldRequest,
  type PrimeWorldDetail,
  type PrimeWorldExportBundle,
} from "@echoo/shared";
import { useState } from "react";
import type { PrimeWorldService } from "../../services/PrimeWorldService";
import { PrimeWorldEditorPage } from "../prime-world/PrimeWorldEditorPage";
import { DEFAULT_PRIME_WORLD_DETAIL } from "../prime-world/primeWorldTemplate";
import {
  PrimeWorldBundleInput,
  PrimeWorldMetadataFields,
  parsePrimeWorldBundleText,
} from "./PrimeWorldAuthoringFields";

export function PrimeWorldCreateForm({
  onCreate,
  onImport,
  service,
}: {
  onCreate: (input: CreatePrimeWorldRequest) => Promise<Agent>;
  onImport: (bundle: PrimeWorldExportBundle) => Promise<Agent>;
  service: PrimeWorldService;
}) {
  const [name, setName] = useState("");
  const [attributes, setAttributes] = useState<AgentAttribute[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [introduction, setIntroduction] = useState("");
  const [detail, setDetail] = useState<PrimeWorldDetail>(DEFAULT_PRIME_WORLD_DETAIL);
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
    <div className="glass-panel space-y-4 rounded-2xl p-5 md:p-7">
      <div>
        <h2 className="text-2xl font-semibold text-white">本初世界</h2>
        <p className="mt-1 text-sm leading-6 text-white/45">
          超高自由度，可以自创各种玩法，但配置偏复杂。可以在画布中编辑节点，也可以切换到JSON精确编辑。适合有一定基础的专业玩家。推荐在电脑或者平板编辑
        </p>
      </div>
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
      <div className="h-[46rem] min-h-[36rem] overflow-hidden rounded-xl border border-white/10 bg-[#0b0b0d]">
        <PrimeWorldEditorPage
          key={editorRevision}
          detail={detail}
          service={service}
          saveLabel="创建世界"
          onSave={async (nextDetail) => {
            if (!name.trim()) throw new Error("请先填写世界名称。");
            const metadata = {
              name: name.trim(),
              attributes,
              tags: tags.map((tag) => tag.trim()).filter(Boolean),
              introduction: introduction.trim(),
              detail: nextDetail,
            };
            if (bundle) {
              await onImport({ ...bundle, ...metadata });
              return;
            }
            await onCreate({
              type: "prime-world",
              ...metadata,
              isPublic: false,
            });
          }}
        />
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
