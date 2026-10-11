/**
 * Reads the parts export (WS-A1): turns the raw bytes of `parts_export.csv` into one
 * `NormalizedRow` per data line, accepted or rejected with a reason, for the loader (WS-A2).
 */
import { pipeline } from "node:stream";
import { parse } from "csv-parse";
import type { NormalizedRow } from "@/contracts/import-rows";
import { isHeader, normalizeRow } from "./normalize-row";

/**
 * Reads a parts export and yields one `NormalizedRow` per data line, in file order.
 *
 * `input` is the file's bytes, such as a file stream or a gunzip stream, and is streamed, never
 * held whole. `lineNumber` is the physical line where the record starts, counting the header as 1.
 *
 * Throws, failing the whole import, when no row can be trusted: when line 1 isn't the export's
 * header, so the columns can't be matched by position, or when quoting is broken past repair, such
 * as a quote that never closes. Errors from `input`, such as a corrupt gzip, are thrown as they are.
 */
export async function* readRows(input: AsyncIterable<Uint8Array>): AsyncGenerator<NormalizedRow> {
  const parser = parse({
    bom: true,
    // Auto-detection would pick one line ending from line 1, and a later line ending in a bare LF
    // would then merge with the next line into one record.
    record_delimiter: ["\r\n", "\n"],
    // Rows with too many or too few fields reach normalizeRow, which repairs or rejects them.
    relax_column_count: true,
    // Keeps a quote inside an unquoted field, such as an inch mark in a description, as text
    // instead of failing the file.
    relax_quotes: true,
    // A quote that never closes would otherwise buffer the rest of the file into one field.
    max_record_size: 65_536,
  });
  // `pipeline` destroys the parser when `input` fails, so the error surfaces from the loop below,
  // and destroys `input` when the caller stops early.
  pipeline(input, parser, () => {});

  let lineNumber = 1;
  for await (const fields of parser as AsyncIterable<string[]>) {
    if (lineNumber > 1) {
      yield normalizeRow(lineNumber, fields);
    } else if (!isHeader(fields)) {
      throw new Error("Line 1 is not the parts export header, so this is not a parts export.");
    }
    // A quoted field can contain line breaks. csv-parse's own `info.lines` can't be used instead,
    // because it counts a CRLF inside quotes as two lines.
    lineNumber += 1 + lineBreaks(fields);
  }
  if (lineNumber === 1) throw new Error("The file is empty, so this is not a parts export.");
}

function lineBreaks(fields: string[]): number {
  let count = 0;
  for (const field of fields) {
    if (field.includes("\n")) count += field.split("\n").length - 1;
  }
  return count;
}
