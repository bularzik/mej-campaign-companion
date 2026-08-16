import { describe, it, expect } from "vitest";
import {
  MAX_RELAY_FILE_BYTES, RELAY_CHUNK_SIZE, MAX_RELAY_CHUNKS, DEFAULT_MAX_RELAY_BUFFERS,
  base64ByteLength, chunkBase64, isRelayableImageType, chunkProblem, createRelayAssembler,
  enforcedImageName
} from "../scripts/logic/media-relay.mjs";

describe("base64ByteLength", () => {
  it("computes decoded size accounting for padding", () => {
    expect(base64ByteLength(btoa("a"))).toBe(1);      // "YQ=="
    expect(base64ByteLength(btoa("ab"))).toBe(2);     // "YWI="
    expect(base64ByteLength(btoa("abc"))).toBe(3);    // "YWJj"
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength(null)).toBe(0);
  });
});

describe("chunkBase64", () => {
  it("splits into RELAY_CHUNK_SIZE pieces preserving order", () => {
    const body = "x".repeat(RELAY_CHUNK_SIZE + 5);
    const chunks = chunkBase64(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(RELAY_CHUNK_SIZE);
    expect(chunks[1]).toBe("xxxxx");
    expect(chunks.join("")).toBe(body);
  });
  it("yields a single empty chunk for an empty body", () => {
    expect(chunkBase64("")).toEqual([""]);
  });
});

describe("isRelayableImageType", () => {
  it("accepts renderable image MIME types case-insensitively", () => {
    expect(isRelayableImageType("image/png")).toBe(true);
    expect(isRelayableImageType("image/JPEG")).toBe(true);
    expect(isRelayableImageType("image/svg+xml")).toBe(true);
  });
  it("rejects videos, non-renderable images, and junk", () => {
    expect(isRelayableImageType("video/webm")).toBe(false);
    expect(isRelayableImageType("image/x-emf")).toBe(false);
    expect(isRelayableImageType("application/pdf")).toBe(false);
    expect(isRelayableImageType(null)).toBe(false);
  });
});

const chunk = (over = {}) => ({
  requestId: "req1", groupId: "g1", name: "map.png", type: "image/png",
  seq: 0, total: 1, data: btoa("abc"), ...over
});

describe("chunkProblem", () => {
  it("passes a well-formed chunk", () => {
    expect(chunkProblem(chunk())).toBeNull();
  });
  it("names the defect for malformed chunks", () => {
    expect(chunkProblem(chunk({ requestId: "" }))).toBe("bad-request-id");
    expect(chunkProblem(chunk({ groupId: 7 }))).toBe("bad-group");
    expect(chunkProblem(chunk({ name: "" }))).toBe("bad-name");
    expect(chunkProblem(chunk({ type: "video/webm" }))).toBe("bad-type");
    expect(chunkProblem(chunk({ seq: -1 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ seq: 1, total: 1 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ total: 0 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ data: 42 }))).toBe("bad-data");
    expect(chunkProblem(null)).toBe("bad-request-id");
  });
  it("bounds total to MAX_RELAY_CHUNKS so a hostile total can't OOM the assembler", () => {
    expect(chunkProblem(chunk({ seq: 0, total: MAX_RELAY_CHUNKS + 1 }))).toBe("bad-seq");
    expect(chunkProblem(chunk({ seq: 0, total: MAX_RELAY_CHUNKS }))).toBeNull();
    expect(chunkProblem(chunk({ seq: 0, total: 1e8 }))).toBe("bad-seq");
  });
  it("keeps a legitimate max-size upload's chunk count within MAX_RELAY_CHUNKS", () => {
    // Worst-case base64 length for a MAX_RELAY_FILE_BYTES-sized body (no padding).
    const body = "A".repeat(Math.ceil((MAX_RELAY_FILE_BYTES * 4) / 3));
    const chunks = chunkBase64(body);
    expect(chunks.length).toBeLessThanOrEqual(MAX_RELAY_CHUNKS);
    expect(chunkProblem(chunk({ seq: 0, total: chunks.length }))).toBeNull();
  });
});

describe("enforcedImageName", () => {
  it("forces the extension to match the validated MIME, ignoring the caller's extension", () => {
    expect(enforcedImageName("evil.html", "image/png")).toBe("evil.png");
  });
  it("leaves a name whose extension already matches unchanged", () => {
    expect(enforcedImageName("map.png", "image/png")).toBe("map.png");
  });
  it("appends an extension when the name has none", () => {
    expect(enforcedImageName("map", "image/png")).toBe("map.png");
  });
  it("returns null for a mime with no known renderable extension", () => {
    expect(enforcedImageName("evil.png", "image/x-emf")).toBeNull();
    expect(enforcedImageName("evil.png", "video/webm")).toBeNull();
  });
});

describe("createRelayAssembler", () => {
  it("completes a single-chunk request", () => {
    const a = createRelayAssembler();
    const out = a.accept(chunk(), 1000);
    expect(out.status).toBe("complete");
    expect(out.request).toEqual({
      requestId: "req1", groupId: "g1", name: "map.png", type: "image/png", base64: btoa("abc")
    });
    expect(a.size()).toBe(0);
  });
  it("assembles multi-chunk requests in seq order regardless of arrival order", () => {
    const a = createRelayAssembler();
    expect(a.accept(chunk({ seq: 1, total: 2, data: "BBBB" }), 1000).status).toBe("pending");
    const out = a.accept(chunk({ seq: 0, total: 2, data: "AAAA" }), 1001);
    expect(out.status).toBe("complete");
    expect(out.request.base64).toBe("AAAABBBB");
  });
  it("ignores duplicate seqs without double-counting", () => {
    const a = createRelayAssembler();
    a.accept(chunk({ seq: 0, total: 2, data: "AAAA" }), 1000);
    expect(a.accept(chunk({ seq: 0, total: 2, data: "AAAA" }), 1001).status).toBe("pending");
    expect(a.accept(chunk({ seq: 1, total: 2, data: "BBBB" }), 1002).status).toBe("complete");
  });
  it("rejects over-size accumulations and drops the buffer", () => {
    const a = createRelayAssembler({ maxBytes: 3 });
    const out = a.accept(chunk({ data: btoa("abcd") }), 1000); // 4 bytes > 3
    expect(out).toEqual({ status: "invalid", reason: "too-large" });
    expect(a.size()).toBe(0);
  });
  it("rejects a chunk whose total disagrees with the open buffer", () => {
    const a = createRelayAssembler();
    a.accept(chunk({ seq: 0, total: 3, data: "A" }), 1000);
    expect(a.accept(chunk({ seq: 1, total: 2, data: "B" }), 1001))
      .toEqual({ status: "invalid", reason: "bad-seq" });
    expect(a.size()).toBe(0);
  });
  it("evicts stale buffers", () => {
    const a = createRelayAssembler({ staleMs: 100 });
    a.accept(chunk({ seq: 0, total: 2, data: "A" }), 1000);
    expect(a.size()).toBe(1);
    a.accept(chunk({ requestId: "req2", seq: 0, total: 2, data: "A" }), 2000);
    expect(a.size()).toBe(1); // req1 evicted, req2 open
  });
  it("respects MAX_RELAY_FILE_BYTES as the default cap", () => {
    expect(MAX_RELAY_FILE_BYTES).toBe(10 * 1024 * 1024);
  });
  it("caps concurrent reassembly buffers without evicting live ones", () => {
    const a = createRelayAssembler({ maxBuffers: 2 });
    expect(a.accept(chunk({ requestId: "req1", seq: 0, total: 2, data: "A" }), 1000).status).toBe("pending");
    expect(a.accept(chunk({ requestId: "req2", seq: 0, total: 2, data: "A" }), 1000).status).toBe("pending");
    expect(a.size()).toBe(2);
    expect(a.accept(chunk({ requestId: "req3", seq: 0, total: 2, data: "A" }), 1000))
      .toEqual({ status: "invalid", reason: "too-many" });
    expect(a.size()).toBe(2);
    // Live buffers are untouched and can still complete.
    expect(a.accept(chunk({ requestId: "req1", seq: 1, total: 2, data: "B" }), 1001).status).toBe("complete");
  });
  it("uses DEFAULT_MAX_RELAY_BUFFERS as the default cap", () => {
    expect(DEFAULT_MAX_RELAY_BUFFERS).toBe(16);
  });
});
