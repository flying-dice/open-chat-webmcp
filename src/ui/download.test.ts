import { describe, it, expect, vi } from "vitest";
import { downloadTextFile } from "./download";

describe("downloadTextFile", () => {
  it("clicks a download anchor carrying the filename and a data: URI of the content", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadTextFile("chat-export.md", "# Title\n\nHello", "text/markdown");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("chat-export.md");
    expect(anchor.href).toBe(
      `data:text/markdown;charset=utf-8,${encodeURIComponent("# Title\n\nHello")}`,
    );

    clickSpy.mockRestore();
  });

  it("defaults the mime type to text/markdown", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadTextFile("notes.md", "content");

    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.href.startsWith("data:text/markdown;charset=utf-8,")).toBe(true);

    clickSpy.mockRestore();
  });
});
