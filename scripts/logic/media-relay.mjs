import { IMAGE_SUBTYPE_EXT, imageExtension } from "./import-images.mjs";

/**
 * Pure protocol helpers for relaying a player's media upload to the active
 * GM over the module socket. No Foundry globals — unit-tested with vitest.
 * The socket transport caps message size, so file bytes travel as
 * sequence-numbered base64 chunks reassembled GM-side.
 */

export const MAX_RELAY_FILE_BYTES = 10 * 1024 * 1024;
export const RELAY_CHUNK_SIZE = 256 * 1024; // base64 chars per socket message
export const RELAY_BUFFER_STALE_MS = 60 * 1000;
// Chunk count a MAX_RELAY_FILE_BYTES upload actually produces, plus one
// rounding-error margin. Bounds `total` so a hostile huge value can't drive
// `new Array(total)` into an OOM before any size check runs.
export const MAX_RELAY_CHUNKS = Math.ceil((MAX_RELAY_FILE_BYTES * 4) / 3 / RELAY_CHUNK_SIZE) + 1;
// Concurrent in-flight reassembly buffers allowed per GM before new
// requestIds are refused; bounds worst-case memory fan-out independent of
// per-buffer size caps.
export const DEFAULT_MAX_RELAY_BUFFERS = 16;

/** Decoded byte length of a base64 string. */
export function base64ByteLength(base64) {
  if (typeof base64 !== "string" || !base64.length) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

/** Split a base64 body into RELAY_CHUNK_SIZE-char chunks; never empty. */
export function chunkBase64(base64) {
  const chunks = [];
  for (let i = 0; i < base64.length; i += RELAY_CHUNK_SIZE) {
    chunks.push(base64.slice(i, i + RELAY_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [""];
}

/** Only image types Foundry can render may travel over the relay. */
export function isRelayableImageType(mime) {
  const m = /^image\/([a-z0-9.+-]+)$/i.exec(mime ?? "");
  return !!m && m[1].toLowerCase() in IMAGE_SUBTYPE_EXT;
}

/** Shape-check one relayed chunk. Null when valid, else a reason slug. */
export function chunkProblem(p) {
  if (typeof p?.requestId !== "string" || !p.requestId) return "bad-request-id";
  if (typeof p.groupId !== "string" || !p.groupId) return "bad-group";
  if (typeof p.name !== "string" || !p.name) return "bad-name";
  if (!isRelayableImageType(p.type)) return "bad-type";
  if (!Number.isInteger(p.seq) || p.seq < 0) return "bad-seq";
  if (!Number.isInteger(p.total) || p.total < 1 || p.total > MAX_RELAY_CHUNKS || p.seq >= p.total) {
    return "bad-seq";
  }
  if (typeof p.data !== "string") return "bad-data";
  return null;
}

/**
 * Force `name`'s extension to match the validated MIME's subtype, ignoring
 * whatever extension the caller supplied. Guards against a mismatched pair
 * like {name:"evil.html", type:"image/png"} landing on disk as .html.
 * Returns null when `mime` has no known renderable extension.
 */
export function enforcedImageName(name, mime) {
  const m = /^image\/([a-z0-9.+-]+)$/i.exec(mime ?? "");
  const ext = m ? imageExtension(m[1].toLowerCase()) : null;
  if (!ext) return null;
  const base = (name ?? "").replace(/\.[^./\\]+$/, "");
  return `${base || "media"}.${ext}`;
}

/**
 * Chunk reassembly for the GM side. `now` is injected so tests control time;
 * buffers untouched for staleMs are evicted on the next accept().
 */
export function createRelayAssembler({
  maxBytes = MAX_RELAY_FILE_BYTES, staleMs = RELAY_BUFFER_STALE_MS, maxBuffers = DEFAULT_MAX_RELAY_BUFFERS
} = {}) {
  const buffers = new Map(); // requestId -> {groupId,name,type,total,parts,received,bytes,touched}
  return {
    accept(payload, now) {
      for (const [id, buf] of buffers) if (now - buf.touched > staleMs) buffers.delete(id);
      const reason = chunkProblem(payload);
      if (reason) return { status: "invalid", reason };
      let buf = buffers.get(payload.requestId);
      if (!buf) {
        if (buffers.size >= maxBuffers) return { status: "invalid", reason: "too-many" };
        buf = {
          groupId: payload.groupId, name: payload.name, type: payload.type,
          total: payload.total, parts: new Array(payload.total).fill(null),
          received: 0, bytes: 0, touched: now
        };
        buffers.set(payload.requestId, buf);
      }
      buf.touched = now;
      if (payload.total !== buf.total) {
        buffers.delete(payload.requestId);
        return { status: "invalid", reason: "bad-seq" };
      }
      if (buf.parts[payload.seq] === null) {
        buf.parts[payload.seq] = payload.data;
        buf.received += 1;
        buf.bytes += base64ByteLength(payload.data);
      }
      if (buf.bytes > maxBytes) {
        buffers.delete(payload.requestId);
        return { status: "invalid", reason: "too-large" };
      }
      if (buf.received < buf.total) return { status: "pending" };
      buffers.delete(payload.requestId);
      return {
        status: "complete",
        request: {
          requestId: payload.requestId, groupId: buf.groupId,
          name: buf.name, type: buf.type, base64: buf.parts.join("")
        }
      };
    },
    size() { return buffers.size; }
  };
}
