import { createReadStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { createGunzip, gzipSync } from "node:zlib";
import { describe, expect, test, vi } from "vitest";
import { NormalizedRow } from "@/contracts/import-rows";
import { ImportSummary } from "@/contracts/imports";
import { readRows } from ".";

const HEADER = "Part Number,NSN,Description,Supplier,Qty On Hand,Unit Price,Lead Time,Last Updated";
const ROW = "MS21045L176,,WASHER,Allied Fastener Supply,27,19.11,120,2025-06-13";
const ROW_PART_NUMBER = "MS21045L176";

/** Ends every line with CRLF, as the export does. */
function csv(...lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join("");
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function* chunked(data: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

/** Reads every row, and checks that each one matches the contract exactly. */
async function readAll(input: AsyncIterable<Uint8Array>): Promise<NormalizedRow[]> {
  const rows = await Array.fromAsync(readRows(input));
  // Parsing strips unknown keys, so comparing the result with the input also catches extra fields.
  for (const row of rows) expect(NormalizedRow.parse(row)).toEqual(row);
  return rows;
}

function read(data: string | Uint8Array, chunkSize = 65_536): Promise<NormalizedRow[]> {
  return readAll(chunked(typeof data === "string" ? bytes(data) : data, chunkSize));
}

/** Each row's line, and its part number or rejection reason. */
function outcomes(rows: NormalizedRow[]): [number, string][] {
  return rows.map((row) => [
    row.lineNumber,
    row.outcome === "accepted" ? row.partNumber : row.reason,
  ]);
}

describe("readRows", () => {
  const file = csv(
    `\uFEFF${HEADER}`,
    'MS21045L176,5305-01-468-1993,"SCREW,MACHINE 1/4-28 UNF",Allied Fastener Supply,27,19.11,120,2025-06-13',
    "",
    ",,,,,,,",
    '6036-2327-65,5330148344219,"SEAL,PLAIN ENCASED AS568-114"',
    "AN6C35,5305017414860,SCREW,CAP,HEXAGON HEAD #6-32 UNC,Tri-County Fastener,27,19.11,120,2025-06-13",
    'un16492,,WASHER,Keystone Bearing Co,"1,131","$9,361.09",3 wks,03/18/2026',
    HEADER,
    'D38999/24JG62SC,,"GASKET\r\nØ34MM",Westbrook Seals,5, 0.40 ,STOCK,2025-09-26T11:20:42Z',
    ",,SEAL,Westbrook Seals,5,0.40,STOCK,2025-09-26",
    "NAS1149-500R,,NUT,Mesa Gear Works,N/A,CALL,TBD,2025-01-01",
    "ms28775-218,,SEAL,Coastal Avionics Supply,5,-23.55,7,2025-06-13",
  );

  // 1-byte chunks split the BOM, every CRLF, and the 2-byte Ø.
  test.each([1, 2, 3, 7, 65_536])(
    "yields one row per record, at the line where it starts, in %i-byte chunks",
    async (chunkSize) => {
      const rows = await read(file, chunkSize);
      expect(outcomes(rows)).toEqual([
        [2, "MS21045L176"],
        [3, "row is empty"],
        [4, "row is empty"],
        [5, "row has too few columns"],
        [6, "AN6C35"],
        [7, "UN16492"],
        [8, "row is a repeated header"],
        [9, "D38999/24JG62SC"], // its quoted Description spans lines 9 and 10
        [11, "part number is missing"],
        [12, "NAS1149-500R"],
        [13, "price is negative"],
      ]);
      expect(rows[5]).toEqual({
        outcome: "accepted",
        lineNumber: 7,
        partNumber: "UN16492",
        supplier: "Keystone Bearing Co",
        quantity: 1131,
        price: "9361.09",
        leadTimeDays: 21,
        lastUpdated: new Date("2026-03-18T00:00:00Z"),
      });
      expect(rows[9]).toMatchObject({ quantity: null, price: null, leadTimeDays: null });
      expect(rows[10]).toMatchObject({
        identity: {
          partNumber: "MS28775-218",
          supplier: "Coastal Avionics Supply",
          lastUpdated: new Date("2025-06-13T00:00:00Z"),
        },
      });
    },
  );

  test.each([
    [
      "LF line endings",
      `${HEADER}\n${ROW}\n\n${ROW}\n`,
      [
        [2, ROW_PART_NUMBER],
        [3, "row is empty"],
        [4, ROW_PART_NUMBER],
      ],
    ],
    [
      "both CRLF and LF line endings",
      `${HEADER}\r\n${ROW}\n${ROW}\r\n\n${ROW}\r\n`,
      [
        [2, ROW_PART_NUMBER],
        [3, ROW_PART_NUMBER],
        [4, "row is empty"],
        [5, ROW_PART_NUMBER],
      ],
    ],
    [
      "no line ending on the last line",
      `${HEADER}\r\n${ROW}\r\n${ROW}`,
      [
        [2, ROW_PART_NUMBER],
        [3, ROW_PART_NUMBER],
      ],
    ],
    ["a header without a BOM", csv(HEADER, ROW), [[2, ROW_PART_NUMBER]]],
  ])("reads a file with %s", async (_, text, expected) => {
    expect(outcomes(await read(text))).toEqual(expected);
  });

  test("keeps rows whose Description isn't valid UTF-8 (P2), with no U+FFFD in kept fields", async () => {
    const rows = await read(
      Uint8Array.from([
        ...bytes(csv(HEADER)),
        ...bytes("AS568-218,,GASKET AS568-218 "),
        0xd8, // Ø in Windows-1252
        ...bytes("34MM,Westbrook Seals,5,0.40,STOCK,2025-09-26\r\n"),
        ...bytes("MS35338-44,,WASHER 300"),
        0xb0, // ° in Windows-1252, right before the delimiter
        ...bytes(",Allied Fastener Supply,5,0.40,STOCK,2025-09-26\r\n"),
      ]),
    );
    expect(outcomes(rows)).toEqual([
      [2, "AS568-218"],
      [3, "MS35338-44"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("\uFFFD");
  });

  test("keeps a quote inside an unquoted field as text", async () => {
    const rows = await read(
      csv(HEADER, 'AN960C10,,WASHER 5" OD,Allied Fastener Supply,27,19.11,120,2025-06-13'),
    );
    expect(outcomes(rows)).toEqual([[2, "AN960C10"]]);
  });

  test("reads a gunzip stream", async () => {
    const input = Readable.from([gzipSync(csv(HEADER, ROW, ROW))]).pipe(createGunzip());
    expect(outcomes(await readAll(input))).toEqual([
      [2, ROW_PART_NUMBER],
      [3, ROW_PART_NUMBER],
    ]);
  });

  test.each([
    ["starts with a data row", csv(ROW, ROW)],
    [
      "has two columns swapped",
      csv(HEADER.replace("Qty On Hand,Unit Price", "Unit Price,Qty On Hand"), ROW),
    ],
    ["is missing a column", csv(HEADER.replace(",NSN", ""), ROW)],
    ["starts with an empty line", csv("", HEADER, ROW)],
  ])("throws when the file %s instead of the header", async (_, text) => {
    await expect(read(text)).rejects.toThrow("Line 1 is not the parts export header");
  });

  test.each([
    ["no bytes", ""],
    ["only a BOM", "\uFEFF"],
  ])("throws when the file has %s", async (_, text) => {
    await expect(read(text)).rejects.toThrow("The file is empty");
  });

  test("throws the input's error", async () => {
    async function* failing() {
      yield bytes(csv(HEADER, ROW));
      throw new Error("The disk is on fire");
    }
    await expect(Array.fromAsync(readRows(failing()))).rejects.toThrow("The disk is on fire");
  });

  test("throws when a gzip stream is cut off", async () => {
    const gzip = gzipSync(csv(HEADER, ROW, ROW));
    const input = Readable.from([gzip.subarray(0, gzip.length - 10)]).pipe(createGunzip());
    await expect(Array.fromAsync(readRows(input))).rejects.toThrow("unexpected end of file");
  });

  test("throws on a quote that never closes, without buffering the rest of the file", async () => {
    const rest = Array.from({ length: 5_000 }, () => ROW);
    await expect(
      read(csv(HEADER, ROW, 'X,,"never closed,A,1,1,1,2025-01-01', ...rest)),
    ).rejects.toMatchObject({
      code: "CSV_MAX_RECORD_SIZE",
    });
  });

  test("closes the input when the caller stops early", async () => {
    let closed = false;
    async function* endless() {
      try {
        yield bytes(csv(HEADER));
        while (true) yield bytes(csv(ROW));
      } finally {
        closed = true;
      }
    }
    for await (const _ of readRows(endless())) break;
    await vi.waitFor(() => expect(closed).toBe(true));
  });
});

describe("readRows on the T0.3 import fixtures", () => {
  const fixture = (name: string) =>
    new URL(`../../../../tests/fixtures/imports/${name}`, import.meta.url);
  const { steps } = JSON.parse(readFileSync(fixture("expected.json"), "utf8")) as {
    steps: { file: string; summary: unknown }[];
  };

  // The loader's expected summary for the first import of each file fixes how many rows the
  // normalizer reads and rejects for each reason.
  test.each(["night-1.csv", "night-2.csv"])(
    "reads %s with the counts of its expected summary",
    async (file) => {
      const step = steps.find((candidate) => candidate.file === file);
      const summary = ImportSummary.omit({ durationMs: true }).parse(step?.summary);
      const rows = await readAll(createReadStream(fixture(file)));
      const rejected: Record<string, number> = {};
      for (const row of rows) {
        if (row.outcome === "rejected") rejected[row.reason] = (rejected[row.reason] ?? 0) + 1;
      }
      expect(rows).toHaveLength(summary.rowsRead);
      expect(rejected).toEqual(summary.rejected);
    },
  );

  test("rejects the lines of night-1.csv that its README lists, keeping parts where it can", async () => {
    const rows = await readAll(createReadStream(fixture("night-1.csv")));
    const rejected = rows.filter((row) => row.outcome === "rejected");
    expect(rejected.map((row) => [row.lineNumber, row.reason, row.identity?.partNumber])).toEqual([
      [6, "row is empty", undefined],
      [15, "row is empty", undefined],
      [16, "row has too few columns", undefined],
      [17, "price is negative", "MS28775-218"],
      [18, "row is a repeated header", undefined],
      [19, "part number is missing", undefined],
      [20, "part number has no letters or digits", undefined],
      [21, "supplier is missing", undefined],
      [22, "supplier has no letters or digits", undefined],
      [23, "price is not a number", "MS21045L176"],
      [24, "quantity is not a whole number", "6036-2327-65"],
      [25, "price has more than 2 decimal places", "81H37815-5"],
      [26, "lead time is not a number of days or weeks", "D38999/24JG62SC"],
      [27, "quantity is too large", "M83248/2-390"],
      [28, "price is too large", "UN16492"],
      [29, "lead time is too large", "RNC55H9852FM"],
      [30, "last updated is missing", undefined],
      [31, "last updated is not a valid date", undefined],
      [34, "quantity is negative", "NAS1611-023R"],
    ]);
  });
});
