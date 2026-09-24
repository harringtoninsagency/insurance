import { Transform, type Readable } from "node:stream";
import unzipper from "unzipper";
import streamArray from "stream-json/streamers/stream-array.js";

// Helpers for PCPAO's official Raw Database Files bulk export
// (https://www.pcpao.gov/tools-data/data-downloads/raw-database-files) — a
// sanctioned data feed, unlike the property-detail pages robots.txt
// disallows. Used by the offline sync scripts only; never run these inside a
// Next.js request (the files are hundreds of MB).

const BASE_URL = "https://www.pcpao.gov";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function downloadTableJsonStream(tableName: string): Promise<Readable> {
  const res = await fetch(`${BASE_URL}/dal/databasefile/downloadDatabaseFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Referer: `${BASE_URL}/tools-data/data-downloads/raw-database-files`,
    },
    body: new URLSearchParams({ hdn_tbl_name: tableName, hdn_ftype: "json" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to download ${tableName}: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const directory = await unzipper.Open.buffer(buffer);
  const entry = directory.files[0];
  if (!entry) {
    throw new Error(`${tableName}.zip contained no entries`);
  }
  console.log(`Downloaded ${tableName} (${(buffer.length / 1e6).toFixed(1)} MB zipped)`);
  return entry.stream();
}

// PCPAO's JSON export has a trailing comma before the closing `]`, which is
// invalid strict JSON that stream-json's parser rejects. Buffers only the
// last `tailSize` bytes (bounded memory even for a 1.3GB stream) and strips
// a trailing comma from them on flush.
function fixTrailingComma(tailSize = 64): Transform {
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      const combined = Buffer.concat([tail, chunk]);
      if (combined.length > tailSize) {
        const emitLen = combined.length - tailSize;
        this.push(combined.subarray(0, emitLen));
        tail = Buffer.from(combined.subarray(emitLen));
      } else {
        tail = combined;
      }
      callback();
    },
    flush(callback) {
      this.push(tail.toString("utf8").replace(/,(\s*\])\s*$/, "$1"));
      callback();
    },
  });
}

export async function streamEachRecord(
  source: Readable,
  onRecord: (record: Record<string, string>) => void
): Promise<number> {
  let count = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const pipeline = source.pipe(fixTrailingComma()).pipe(streamArray.withParserAsStream());
    pipeline.on("data", ({ value }: { value: Record<string, string> }) => {
      onRecord(value);
      count += 1;
      if (count % 100_000 === 0) console.log(`  ...${count.toLocaleString()} rows`);
    });
    pipeline.on("end", () => resolvePromise());
    pipeline.on("error", reject);
  });
  return count;
}
