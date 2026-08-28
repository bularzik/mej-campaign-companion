import { describe, it, expect } from "vitest";
import { dataUriToFile } from "../scripts/apps/import-upload.mjs";

// C3: a docx carrying an inline image with a corrupt base64 body used to kill
// the whole import silently. parseImageDataUri accepts any `(.*)` as the
// payload, so the corrupt body reached atob(), which throws - and that call
// sat OUTSIDE uploadInlineImages' per-image try (which wrapped only the
// upload). The throw propagated out of #onCreate past its `finally`, so
// this.close() and #showResult never ran: no error, no result dialog, and
// some documents already created.
//
// dataUriToFile is made total instead, reporting a skip the way it already
// does for an unparseable URI or an undecodable subtype.
describe("dataUriToFile", () => {
  it("decodes a well-formed image data URI", async () => {
    const result = await dataUriToFile(`data:image/png;base64,${btoa("fake-png-bytes")}`, "img-1");
    expect(result.skipped).toBeUndefined();
    expect(result.file).toBeInstanceOf(File);
    expect(result.file.name).toBe("img-1.png");
    expect(result.file.type).toBe("image/png");
  });

  it("reports a skip for a URI it cannot parse at all", async () => {
    expect(await dataUriToFile("not-a-data-uri", "img-1")).toEqual({ skipped: "unknown" });
    expect(await dataUriToFile(null, "img-1")).toEqual({ skipped: "unknown" });
  });

  it("reports a corrupt skip rather than throwing on an undecodable base64 body", async () => {
    const result = await dataUriToFile("data:image/png;base64,####not-base64####", "img-1");
    expect(result.file).toBeUndefined();
    expect(result.skipped).toBe("png");
    expect(result.corrupt).toBe(true);
  });

  it("reports a corrupt skip for a truncated base64 body", async () => {
    const result = await dataUriToFile("data:image/jpeg;base64,QUJD=X", "img-1");
    expect(result.file).toBeUndefined();
    expect(result.corrupt).toBe(true);
  });

  it("never throws for any of the malformed shapes an imported docx can carry", async () => {
    const inputs = [
      "data:image/png;base64,",
      "data:image/png;base64,=",
      "data:image/png;base64,%%%%",
      "data:image/unknownsubtype;base64,####",
      "",
      undefined
    ];
    for (const uri of inputs) {
      await expect(dataUriToFile(uri, "img-1")).resolves.toBeTypeOf("object");
    }
  });
});
