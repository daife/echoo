import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProfileEditorDialog } from "./ProfilePage";

describe("ProfileEditorDialog", () => {
  it("prefills persisted profile fields and exposes avatar controls", () => {
    const html = renderToStaticMarkup(
      <ProfileEditorDialog
        user={{
          id: "user_1",
          email: "aether@example.test",
          displayName: "Aether",
          signature: "安静地共创角色。",
          avatarUrl: "/api/resources/avatar/file",
          createdAt: 1,
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('value="Aether"');
    expect(html).toContain("安静地共创角色。");
    expect(html).toContain("选择图片");
    expect(html).toContain("移除头像");
    expect(html).toContain("保存修改");
  });
});
