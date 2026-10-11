# Data Profile: `parts_export.csv`

> **Task:** PRD T0.1, following [`docs/briefs/T0.1-data-profile.md`](briefs/T0.1-data-profile.md).
> **Input:** the generated `mock_data/mock_a/parts_export.csv` (125,653,360 bytes), profiled on 2026-10-10.
> **Method:** DuckDB 1.5.6 and a small Python script, with every number counted on the full file.
> Section 9 has the scripts that reproduce every number.

## 1. Summary

The export is a UTF-8 CSV with a byte-order mark, CRLF line endings, and 8 columns, but about 4% of its rows can't be loaded as they stand.
Most of the mess is formatting that has one clear meaning: prices with `$`, ` USD`, thousands separators, and 4 decimals; quantities like `1,131` and `142.0`; lead times in days, weeks, and `STOCK`; dates in three formats; and suppliers written six ways each.
Those are normalized.
What has no clear meaning is rejected: missing or `N/A` quantities, missing or `CALL` prices, negative quantities and prices, missing timestamps, truncated rows, empty rows, and repeated header rows.
Under these rules 49,203 rows are rejected and the remaining 1,154,284 rows collapse to 1,100,111 parts.

The most important findings are about identity, not formatting:

- **`normalize_key` merges parts that look different.**
  In 251 duplicate groups, part numbers that differ only by a dash, such as `NAS1149500R` and `NAS1149-500R`, have different descriptions and prices that are a median 6.2 times apart.
  True copies of a part never differ in price by more than 25%.
  C10 says these are the same part, so this needs a decision (OQ1).
- **The newest copy of a part is often unusable.**
  In 1,473 groups the newest row is rejected while an older copy is valid (OQ2).
- **Some timestamps are in the future.**
  3,996 rows are dated after the day the file was generated, up to 2027-04-16, and under C3 they win 3,773 duplicate groups (OQ3).
- **The A4 tie case occurs but never matters.**
  5,338 groups have their newest timestamp on two or more rows, and in every one those rows are identical lines.

| Measure | Count |
| --- | ---: |
| Lines in the file (`wc -l`) | 1,203,488 |
| Data lines (after the header) | 1,203,487 |
| Rows rejected | 49,203 (4.1%) |
| Rows accepted | 1,154,284 |
| Distinct parts after cleaning | 1,100,111 |
| Duplicate groups after cleaning | 52,898 |
| Duplicate rows collapsed | 54,173 |
| Parts with no valid row (not imported) | 44,265 |
| Suppliers | 40 (240 spellings) |

## 2. File format

- **Header:** `Part Number,NSN,Description,Supplier,Qty On Hand,Unit Price,Lead Time,Last Updated`, exactly as written, on line 1.
- **Encoding:** UTF-8 with a byte-order mark (`EF BB BF`) before the header, so the first column name reads as `U+FEFF` followed by `Part Number` unless the BOM is stripped (P1).
  The BOM appears once, at the start of the file.
  The only non-ASCII bytes are in 25 lines that are not valid UTF-8 (P2).
- **Delimiter:** comma.
  There are no tabs and no NUL bytes.
- **Quoting:** RFC 4180 double quotes, used only when a field contains a comma.
  Quoted fields appear only in Description (1,130,979), Qty On Hand (1,174), and Unit Price (5,331).
  No field contains an escaped quote (`""`), no quote appears inside an unquoted field, and no quoted field spans lines.
- **Line endings:** CRLF on every line (1,203,488 CRLF, no bare LF, no bare CR), including the last line.

**Line numbers.**
In this profile, a line number is the physical line in the file: the header is line 1, and every line counts, including empty ones.
Because no quoted field spans lines, each row is exactly one line, so `sed -n '<n>p' parts_export.csv` prints line `<n>`.
This was checked for lines 2, 249, 2427, 161309, 811689, and 1203221.
The import's error messages and tests should use the same numbering, for example csv-parse's `info.lines`.

**Fields per line.**

| Fields | Lines | First line | What it is |
| ---: | ---: | ---: | --- |
| 8 | 1,200,908 | 2 | A normal row, including 306 rows of seven commas (P3) and 3 repeated headers (P6) |
| 0 | 299 | 4849 | An empty line (P3) |
| 3 to 6 | 480 | 2427 | A row cut off after a complete field (P4) |
| 9 or 10 | 1,800 | 249 | A row whose Description has unquoted commas (P5) |

**`wc -l` versus DuckDB.**
`wc -l` counts 1,203,488 lines: the header plus 1,203,487 data lines.
DuckDB's `read_csv(..., all_varchar = true, store_rejects = true)` returns 1,200,883 rows.
The 2,604 missing lines are the 299 empty lines, which it skips silently, plus 2,305 lines it moves to `reject_errors`: 480 with too few columns, 1,800 with too many, and the 25 that aren't valid UTF-8.
Because of the silent skips, `row_number() OVER ()` on DuckDB's own read drifts from real line numbers after line 249.
This profile therefore re-emits every line with its real line number first (section 9).

## 3. Columns

| CSV column | PRD field | Postgres type | Nullable | Notes |
| --- | --- | --- | --- | --- |
| `Part Number` | part number: `part_number`, and `part_number_key` from it | `text` | No | Trimmed, as written. Uses `A-Z`, `a-z`, `0-9`, `-`, and `/`. 600 blank (P7). No value is empty after `normalize_key`. |
| `NSN` | None (NATO Stock Number) | Not stored | - | **Recommend dropping.** No requirement uses it, 32% of rows leave it blank, and it comes in three formats, one of them truncated (P30). |
| `Description` | None | `text` | Yes | **Recommend keeping** for display only, so the buyer can confirm what a part is while quoting. Never blank in this file, 583 distinct values, at most 55 characters, upper case. Not part of identity or search. |
| `Supplier` | supplier: `supplier`, and `supplier_key` from it | `text` | No | 40 suppliers, each written six ways (P10). Display spelling is trimmed with inner spaces collapsed. |
| `Qty On Hand` | quantity | `integer` | No | Whole units. 0 to 25,000 after cleaning. `0` is a real value (140,827 rows), not a sentinel. |
| `Unit Price` | price | `numeric(12, 2)` | No | US dollars (section 7). Scale 2 is confirmed: every 4-decimal value ends in `00` (P20). 0.04 to 15,839.85 after cleaning, and no zero prices. |
| `Lead Time` | lead time: `lead_time_days` | `integer` | Yes | Whole calendar days. Blank and `TBD` mean unknown (P24). 0 to 180 after cleaning. |
| `Last Updated` | last updated: `last_updated` | `timestamptz` | No | Three formats, read as UTC (P28). |

### Blank values and sentinels

Counts are over the 1,202,399 rows that carry data, which excludes the empty rows, short rows, and repeated headers.
Whitespace-only values never occur: a field is either blank or has a non-space character.

| Column | Blank | Sentinels and text values |
| --- | ---: | --- |
| `Part Number` | 600 | None |
| `NSN` | 385,411 | None |
| `Description` | 0 | None |
| `Supplier` | 0 | None |
| `Qty On Hand` | 11,988 | `N/A` 3,570. No `-`, `TBD`, `-1` spike, or `9999` (`-1` is 55 rows, in line with the other negatives). |
| `Unit Price` | 14,445 | `CALL` 4,850. No other text. |
| `Lead Time` | 11,986 | `TBD` 5,890, `STOCK` 92,146 |
| `Last Updated` | 10,902 | None. No epochs, no invalid dates, nothing before 2024-03-17. |

### Value shapes

A shape replaces letters with `a` and digits with `9`.

**Part Number** has 142 shapes (top 10 in section 6).
Besides letters and digits it contains `-` (1,162,008 times), `/` (82,113), and space (15,425, all of it leading or trailing padding).
5,413 values contain lower-case letters.

**Qty On Hand:**
`99` 746,831; `9` 375,834; `999` 52,949; blank 11,988; `99.9` 3,796; `a/a` (`N/A`) 3,570; `9999` 2,583; `9.9` 1,947; `9,999` 1,072; `-99` 637; `-9` 560; `999.9` 274; `99999` 229; `99,999` 102; `9999.9` 24; `99999.9` 3.

**Unit Price** has 41 shapes.
The main ones are `9.99` 468,505; `99.99` 286,584; `999.99` 175,444; `9999.99` 53,290; `$9.99` 45,829; `$99.99` 27,846; `9.9999` 22,675; `" 9.99 "` 17,071; `$999.99` 17,026; and blank 14,445.
Section 9 lists the rest.

**Lead Time:**

| Form | Rows | Numbers used |
| --- | ---: | --- |
| `N` (plain number) | 702,894 | 0, 7, 14, 21, 28, 30, 35, 42, 45, 56, 60, 70, 84, 90, 120, 180 |
| `STOCK` | 92,146 | - |
| `N days` | 70,545 | 7 to 180, the same 15 values as plain numbers except 0 |
| `N DAYS` | 69,603 | Same as `N days` |
| `Nd` | 69,194 | Same as `N days` |
| `N weeks` | 45,413 | 1, 2, 3, 4, 5, 6, 8, 10, 12 |
| `N WKS` | 44,972 | Same as `N weeks` |
| `N wks` | 44,902 | Same as `N weeks` |
| `N wk` | 44,854 | Same as `N weeks` |
| Blank | 11,986 | - |
| `TBD` | 5,890 | - |

**Last Updated:**

| Shape | Rows | Range |
| --- | ---: | --- |
| `9999-99-99` (ISO date) | 835,065 | 2024-03-17 to 2027-04-15 |
| `99/99/9999` (US date) | 237,338 | 03/24/2024 to 04/16/2027 |
| `9999-99-99T99:99:99Z` (ISO, UTC) | 119,094 | 2024-03-21T08:48:38Z to 2027-04-10T08:33:53Z |
| Blank | 10,902 | - |

Between 45,584 and 50,952 rows fall in each month from 2024-10 to 2026-09.
Outside that window the counts fall off: 2,914 rows from 2024-03 to 2024-09, and 4,434 rows from 2026-10 to 2027-04.
Among accepted rows, 97% of those outside the window are copies of a part that also appears elsewhere, against 8.7% inside it.

**NSN:** `9999-99-999-9999` 520,795; blank 385,411; `9999999999999` 294,483; `999999999999` 1,710.

### Suppliers

Every supplier is written in exactly the same six ways, and `normalize_key` groups each set into one key.
The columns below are the exact spellings, where `C` is the most common one:

- **As written:** `C` itself, for example `Allied Fastener Supply`.
- **Upper:** `C` in upper case, `ALLIED FASTENER SUPPLY`.
- **Lower:** `C` in lower case, `allied fastener supply`.
- **Padded:** two spaces, `C`, one space, `"  Allied Fastener Supply "`.
- **Period:** `C` followed by a period, `Allied Fastener Supply.`.
- **Double space:** `C` with its first space doubled, `"Allied  Fastener Supply"`.

The check in section 9 confirms that every key has exactly these six spellings and no others.
**No key merges two different suppliers:** within each key, all six spellings are the same name once case, spaces, and a trailing period are ignored, and no two keys are near-duplicates of each other.

| Supplier (`C`) | Key | As written | Upper | Lower | Padded | Period | Double space | Rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Allied Fastener Supply | `ALLIEDFASTENERSUPPLY` | 20,867 | 3,609 | 1,627 | 1,830 | 1,165 | 935 | 30,033 |
| Anchor Fluid Power | `ANCHORFLUIDPOWER` | 21,168 | 3,579 | 1,628 | 1,841 | 1,083 | 898 | 30,197 |
| Apex Machined Parts | `APEXMACHINEDPARTS` | 21,023 | 3,683 | 1,617 | 1,766 | 1,086 | 886 | 30,061 |
| Bay Aero Components | `BAYAEROCOMPONENTS` | 20,848 | 3,685 | 1,688 | 1,743 | 1,088 | 919 | 29,971 |
| Blue Ridge Bearings | `BLUERIDGEBEARINGS` | 20,829 | 3,641 | 1,583 | 1,749 | 1,086 | 889 | 29,777 |
| Bridgewater Avionics | `BRIDGEWATERAVIONICS` | 21,004 | 3,671 | 1,685 | 1,866 | 1,130 | 942 | 30,298 |
| Cascade Aerospace Parts | `CASCADEAEROSPACEPARTS` | 21,019 | 3,667 | 1,630 | 1,831 | 1,138 | 941 | 30,226 |
| Coastal Avionics Supply | `COASTALAVIONICSSUPPLY` | 20,949 | 3,671 | 1,611 | 1,842 | 1,093 | 930 | 30,096 |
| Continental Hose Co | `CONTINENTALHOSECO` | 21,029 | 3,750 | 1,682 | 1,824 | 1,129 | 938 | 30,352 |
| Copperline Electronics | `COPPERLINEELECTRONICS` | 20,625 | 3,615 | 1,607 | 1,849 | 1,082 | 870 | 29,648 |
| Delta Wire & Cable | `DELTAWIRECABLE` | 20,855 | 3,595 | 1,599 | 1,843 | 1,069 | 902 | 29,863 |
| Eagle Rock Electronics | `EAGLEROCKELECTRONICS` | 20,974 | 3,624 | 1,593 | 1,799 | 1,075 | 901 | 29,966 |
| Frontier Turbine Parts | `FRONTIERTURBINEPARTS` | 20,875 | 3,788 | 1,663 | 1,801 | 1,048 | 863 | 30,038 |
| Granite State Fasteners | `GRANITESTATEFASTENERS` | 20,909 | 3,606 | 1,595 | 1,788 | 1,051 | 891 | 29,840 |
| Great Plains Hydraulics | `GREATPLAINSHYDRAULICS` | 20,922 | 3,601 | 1,609 | 1,786 | 1,082 | 928 | 29,928 |
| Harbor Point Industrial | `HARBORPOINTINDUSTRIAL` | 21,075 | 3,725 | 1,696 | 1,876 | 1,127 | 886 | 30,385 |
| Highland Electrical Supply | `HIGHLANDELECTRICALSUPPLY` | 21,010 | 3,767 | 1,660 | 1,868 | 1,123 | 921 | 30,349 |
| Hudson Valley Bearing | `HUDSONVALLEYBEARING` | 20,989 | 3,675 | 1,573 | 1,909 | 1,081 | 911 | 30,138 |
| Ironclad Industrial Supply | `IRONCLADINDUSTRIALSUPPLY` | 20,928 | 3,636 | 1,670 | 1,801 | 1,086 | 901 | 30,022 |
| Keystone Bearing Co | `KEYSTONEBEARINGCO` | 21,003 | 3,647 | 1,602 | 1,881 | 1,078 | 893 | 30,104 |
| Lakeshore Precision | `LAKESHOREPRECISION` | 21,008 | 3,637 | 1,648 | 1,782 | 1,117 | 874 | 30,066 |
| Liberty Hose & Fitting | `LIBERTYHOSEFITTING` | 20,826 | 3,705 | 1,710 | 1,839 | 1,063 | 870 | 30,013 |
| Meridian Connector Corp | `MERIDIANCONNECTORCORP` | 21,169 | 3,637 | 1,640 | 1,825 | 1,089 | 914 | 30,274 |
| Mesa Gear Works | `MESAGEARWORKS` | 20,886 | 3,693 | 1,669 | 1,824 | 1,047 | 883 | 30,002 |
| Northstar Defense Logistics | `NORTHSTARDEFENSELOGISTICS` | 20,810 | 3,712 | 1,667 | 1,837 | 1,126 | 930 | 30,082 |
| Northwind Hydraulics | `NORTHWINDHYDRAULICS` | 20,846 | 3,611 | 1,561 | 1,815 | 1,128 | 935 | 29,896 |
| Orion Microcircuits | `ORIONMICROCIRCUITS` | 20,920 | 3,680 | 1,600 | 1,756 | 1,108 | 877 | 29,941 |
| Pinecrest Industrial | `PINECRESTINDUSTRIAL` | 21,000 | 3,665 | 1,694 | 1,863 | 1,086 | 888 | 30,196 |
| Pioneer Seal & Gasket | `PIONEERSEALGASKET` | 21,086 | 3,689 | 1,657 | 1,860 | 1,134 | 921 | 30,347 |
| Quarry Hill Components | `QUARRYHILLCOMPONENTS` | 21,015 | 3,670 | 1,636 | 1,837 | 1,107 | 880 | 30,145 |
| Redstone Defense Supply | `REDSTONEDEFENSESUPPLY` | 20,911 | 3,552 | 1,664 | 1,884 | 1,062 | 927 | 30,000 |
| Ridgeline MRO Supply | `RIDGELINEMROSUPPLY` | 20,962 | 3,649 | 1,597 | 1,807 | 1,111 | 925 | 30,051 |
| Riverside Precision Bolt | `RIVERSIDEPRECISIONBOLT` | 20,996 | 3,698 | 1,634 | 1,871 | 1,075 | 898 | 30,172 |
| Sentinel Aero Parts | `SENTINELAEROPARTS` | 21,082 | 3,541 | 1,654 | 1,855 | 1,098 | 912 | 30,142 |
| Silver Creek Supply Co | `SILVERCREEKSUPPLYCO` | 20,876 | 3,556 | 1,631 | 1,846 | 1,094 | 912 | 29,915 |
| Sterling Aerospace Hardware | `STERLINGAEROSPACEHARDWARE` | 20,970 | 3,709 | 1,671 | 1,824 | 1,063 | 874 | 30,111 |
| Summit Electronics Distribution | `SUMMITELECTRONICSDISTRIBUTION` | 20,914 | 3,707 | 1,690 | 1,837 | 1,071 | 860 | 30,079 |
| Tri-County Fastener | `TRICOUNTYFASTENER` | 20,813 | 3,585 | 1,640 | 1,740 | 1,096 | 913 | 29,787 |
| Vanguard Aviation Spares | `VANGUARDAVIATIONSPARES` | 20,831 | 3,648 | 1,659 | 1,773 | 1,103 | 914 | 29,928 |
| Westbrook Seals | `WESTBROOKSEALS` | 20,761 | 3,778 | 1,599 | 1,832 | 1,112 | 878 | 29,960 |

## 4. Data problems

Each problem has an ID, a count over the full file, and one of three rules:

- **Normalize:** the intended value is unambiguous, and the row is kept with the value converted exactly as described.
- **Reject:** the row is not imported, and the import summary counts it under the reason shown (PRD R1.6).
- **Needs decision:** listed in section 8 for T0.3.

Counts are rows that have the problem, so a row with two problems counts twice.
Section 4.3 gives the count per reject reason instead, where each rejected row counts once.
Examples are verbatim, with spaces shown inside quotes when they matter.

### 4.1 Problem list

| ID | Column | Problem | Count | Examples (line) | Rule |
| --- | --- | --- | ---: | --- | --- |
| P1 | File | Byte-order mark before the header | 1 | line 1 starts `EF BB BF` | Normalize: strip it before reading the header. |
| P2 | Description | Not valid UTF-8: Windows-1252 bytes `B0` (`°`, 12 lines) and `D8` (`Ø`, 13 lines) | 25 | 11191 `GASKET AS568-218 Ø34MM`; 76831 `WASHER,LOCK #4-40 UNC 300°F`; 153816 `SEMICONDUCTOR DEVICE,DIODE 4.7K OHM 1/4W Ø19MM` (shown decoded) | Normalize: decode a field that isn't valid UTF-8 as Windows-1252. Never abort or substitute `U+FFFD`. |
| P3 | Row | Empty row: an empty line, or a line of seven commas | 605 | empty: 4849, 9860, 11622; `,,,,,,,`: 2559, 8830, and the last five lines, 1203484 to 1203488 | Reject: `row is empty`. |
| P4 | Row | Too few fields: the line stops after a complete field | 480 | 2427 `6036-2327-65,5330148344219,"SEAL,PLAIN ENCASED AS568-114"`; 16367 `M83248/2-390,,"SEAL,PLAIN ENCASED AS568-012",Keystone Bearing Co`; 43032 `RNC55H9852FM,,"RESISTOR,VARIABLE,WIRE WOUND 100 OHM 1/2W",Cascade Aerospace Parts,0,20.67` | Reject: `row has too few columns`. |
| P5 | Row | Too many fields: Description contains commas but isn't quoted (9 fields: 1,132; 10 fields: 668) | 1,800 | 249 `AN6C35,5305017414860,SCREW,CAP,HEXAGON HEAD #6-32 UNC,Tri-County Fastener,27,19.11,120,2025-06-13`; 1457 `AN4C18,5305-01-468-1993,SCREW,MACHINE 1/4-28 UNF,Redstone Defense Supply,13,7.27,120,2025-07-30` | Normalize: see 4.2, step 3. |
| P6 | Row | Repeated header row (without a BOM) | 3 | 161309, 574963, 949053 | Reject: `row is a repeated header`. |
| P7 | Part Number | Blank | 600 | 276, 513, 538 | Reject: `part number is missing`. |
| P8 | Part Number | Leading or trailing spaces (all 7,711 trailing, 4,632 also leading) | 7,711 | 122 `"MS21045L176  "`; 503 `"JANTX2N5921  "`; 695 `" D38999/24JG62SC "` | Normalize: trim. |
| P9 | Part Number | Lower-case letters | 5,413 | 274 `un16492`; 331 `81h37815-5`; 892 `ph34161a` | None needed: `normalize_key` ignores case, and the display keeps the winning row's spelling (OQ5). |
| P10 | Supplier | Written six ways (upper 146,357; lower 65,539; padded 73,000; trailing period 43,790; doubled space 36,130) | 364,816 | 2 `SUMMIT ELECTRONICS DISTRIBUTION`; 61 `harbor point industrial`; 5 `"  Coastal Avionics Supply "`; 39 `Continental Hose Co.`; 38 `"Allied  Fastener Supply"` | Normalize: trim and collapse each run of whitespace to one space for display. `normalize_key` already groups them. The display choice is OQ5. |
| P11 | Qty On Hand | Blank or `N/A` (blank 11,988; `N/A` 3,570) | 15,558 | blank: 44, 106; `N/A`: 112, 827, 915 | Reject: `quantity is missing`. OQ4 asks whether to keep these parts instead. |
| P12 | Qty On Hand | Thousands separators, always valid groups, always quoted | 1,174 | 24 `1,131`; 565 `2,058`; 1831 `1,053` | Normalize: remove the commas when the value matches `^\d{1,3}(,\d{3})+(\.\d+)?$`. |
| P13 | Qty On Hand | Decimal point with a zero fraction (every one is `.0`) | 6,044 | 139 `142.0`; 155 `46.0`; 172 `12.0` | Normalize: drop a fraction made only of zeros. A non-zero fraction is rejected: `quantity is not a whole number` (0 rows). |
| P14 | Qty On Hand | Negative, from -1 to -20 | 1,197 | 587 `-6`; 1294 `-11`; 1421 `-5` | Reject: `quantity is negative`. Stock on hand can't be below zero, and clamping to 0 would be a guess. |
| P15 | Unit Price | Blank | 14,445 | 63, 150, 239 | Reject: `price is missing`. OQ4 asks whether to keep these parts instead. |
| P16 | Unit Price | `CALL` (call for price) | 4,850 | 72, 727, 785 | Reject: `price is CALL`. OQ4 asks whether to keep these parts instead. |
| P17 | Unit Price | Leading `$` | 96,032 | 23 `$14.37`; 40 `$53.85`; 49 `$0.29` | Normalize: strip it. |
| P18 | Unit Price | Trailing ` USD`, never together with `$` | 11,987 | 74 `1.44 USD`; 260 `1.56 USD`; 332 `271.88 USD` | Normalize: strip it. |
| P19 | Unit Price | Thousands separators, only with `$`, always valid groups, always quoted | 5,331 | 527 `$9,361.09`; 772 `$5,356.66`; 1005 `$8,915.29` | Normalize: remove the commas when the value matches `^\d{1,3}(,\d{3})+(\.\d+)?$`. |
| P20 | Unit Price | Four decimals, always ending in `00` | 47,960 | 26 `64.7300`; 57 `3.7700`; 64 `9.1500` | Normalize: drop trailing zeros after the second decimal. Non-zero digits there are rejected: `price has more than 2 decimal places` (0 rows). |
| P21 | Unit Price | One space on each side | 35,836 | 2 `" 0.40 "`; 27 `" 0.12 "`; 31 `" 23.69 "` | Normalize: trim. |
| P22 | Unit Price | Fewer than two decimals (one decimal 4,347; none 390) | 4,737 | 192 `18.1`; 422 `26`; 698 `4` | Normalize: read as is, so `18.1` is 18.10. |
| P23 | Unit Price | Negative, from -0.69 to -11,570.04 | 1,161 | 5198 `-23.55`; 7331 `-42.80`; 7383 `-0.69` | Reject: `price is negative`. A negative unit price has no clear meaning, and R3.2 requires non-negative prices. |
| P24 | Lead Time | Blank or `TBD` (blank 11,986; `TBD` 5,890) | 17,876 | blank: 428, 472; `TBD`: 32, 258, 961 | Normalize: NULL, meaning unknown, which sorts last (R2.2). |
| P25 | Lead Time | `STOCK` | 92,146 | 4, 9, 53 | Normalize: 0 days. See the evidence below the table. |
| P26 | Lead Time | Units written out: days (209,342) and weeks (180,141) | 389,483 | 11 `56d`; 17 `90 days`; 45 `84 DAYS`; 6 `3 wks`; 21 `12 weeks` | Normalize: days as is, weeks times 7 (4.2, step 6). Plain numbers are days. |
| P27 | Last Updated | Blank | 10,902 | 33, 40, 77 | Reject: `last updated is missing`. Without a timestamp the row can't be placed among a part's copies (C3). |
| P28 | Last Updated | Three formats: ISO date 835,065; US `MM/DD/YYYY` 237,338; ISO date-time in UTC 119,094 | 1,191,497 | 3 `2025-04-04`; 2 `03/18/2026`; 6 `12/24/2024`; 15 `2025-09-26T11:20:42Z` | Normalize: see 4.2, step 7. |
| P29 | Last Updated | After 2026-10-10, the day the file was generated, up to 2027-04-16 | 3,996 | 148 `2027-01-20T04:07:54Z`; 331 `2026-10-31`; 366 `2026-11-04` | Needs decision: OQ3. Until then, accept them, as C3 reads. |
| P30 | NSN | Three formats: dashed 520,795; 13 digits 294,483; 12 digits 1,710 (the last digit cut off) | 816,988 | 5 `5935007738798`; 501 `252001311013`; 4338 `530501241626`, whose copy on line 231113 is `5305012416268` | Drop the column (section 3). If T0.3 keeps it: store 13 digits as `9999-99-999-9999`, and anything else as NULL. |
| P31 | Identity | Part numbers that differ only by a dash or slash are different parts in this data | 251 groups | 1397 `NAS620986P` (`SCREW,MACHINE #8-32 UNC`, 26.12) and 22812 `NAS620-986P` (`SCREW,CAP,HEXAGON HEAD #8-32 UNC`, 0.20); 7247 `NAS1611-023R` (`BOLT,INTERNAL WRENCHING 1/4-28 UNF`, 2.54) and 234111 `NAS1611023R` (`NUT,PLAIN,HEXAGON 5/16-24 UNF`, 2.00); 1084704 `NAS1149500R` (`SCREW,TAPPING #10-32 UNF`, 0.62) and 1151084 `NAS1149-500R` (`NUT,PLAIN,HEXAGON #10-32 UNF`, 3.61) | Needs decision: OQ1. Until then, follow C10 and merge them. |
| P32 | Identity | The newest copy of a part is rejected while an older copy is valid | 1,473 groups | 2907 (2025-07-08, quantity missing) and 175949 (2025-05-27, valid); 2340 (2025-11-16, quantity missing) and 1111219 (2025-08-28, valid) | Needs decision: OQ2. |

**Why `STOCK` means 0 days (P25).**
The plain number 0 appears 94,993 times, but no other form ever writes 0: there is no `0 days`, `0d`, or `0 wks`.
`STOCK` appears a similar 92,146 times, so `STOCK` and `0` look like the two ways the export writes a zero lead time.
`STOCK` doesn't mean "has stock": 11.8% of `STOCK` rows have quantity 0, the same share as rows with other lead times (11.7%).

**Why plain lead-time numbers are days (P26).**
Plain numbers use exactly the values the `days` forms use, plus 0, and those include 30, 45, 60, 90, 120, and 180, which are not whole weeks.
The week forms only use 1 to 12, which are 7 to 84 days, all of them values the plain numbers also use.

**Why slash dates are `MM/DD/YYYY` (P28).**
Of the 237,338 slash dates, 143,374 have a second number above 12 and none has a first number above 12.

**Why the long-row repair is safe (P5).**
Part Number, NSN, and Supplier never contain a comma, and the value columns only do as quoted thousands separators.
In all 1,800 long rows the last five fields fit their columns exactly: the supplier is one of the 240 known spellings, the quantity and lead time are whole numbers, the price has two decimals, and the date is an ISO date.
So the only reading is that the extra commas belong to Description.

### 4.2 Normalizer steps

These steps are the rules above in the order WS-A should apply them to each line.
The first step that rejects a line gives its reason.
"Trim" means removing leading and trailing whitespace.

1. **Decode.**
   Strip the BOM from the start of the file (P1).
   Decode each field as UTF-8, or as Windows-1252 if it isn't valid UTF-8 (P2).
2. **Empty rows.**
   If the line is empty or every field is blank, reject: `row is empty` (P3).
3. **Column count.**
   With fewer than 8 fields, reject: `row has too few columns` (P4).
   With more than 8 fields, take fields 1 and 2 as Part Number and NSN, the last 5 as Supplier, Qty On Hand, Unit Price, Lead Time, and Last Updated, and join everything between them with `,` as Description (P5).
4. **Repeated header.**
   If the 8 fields equal the 8 header names, reject: `row is a repeated header` (P6).
5. **Identity.**
   - Part Number: trim (P8).
     If blank, reject: `part number is missing` (P7).
     If `normalize_key` of it is empty, reject: `part number has no letters or digits` (0 rows).
   - Supplier: trim and collapse each run of whitespace to one space (P10).
     If blank, reject: `supplier is missing` (0 rows).
     If `normalize_key` of it is empty, reject: `supplier has no letters or digits` (0 rows).
6. **Values.**
   - Qty On Hand: trim.
     If blank or `N/A` in any case, reject: `quantity is missing` (P11).
     If it starts with `-` and a digit, reject: `quantity is negative` (P14).
     Remove thousands separators (P12), then drop a zero fraction (P13).
     If what's left isn't `^\d+$`, reject: `quantity is not a whole number`.
     If it's above 2,147,483,647, reject: `quantity is too large` (0 rows).
   - Unit Price: trim.
     If blank, reject: `price is missing` (P15).
     If `CALL` in any case, reject: `price is CALL` (P16).
     Strip one leading `$` (P17) and one trailing `USD` in any case with the spaces before it (P18), then trim again.
     If it starts with `-` and a digit, reject: `price is negative` (P23).
     Remove thousands separators (P19), then drop zeros after the second decimal (P20).
     If what's left isn't `^\d+(\.\d+)?$`, reject: `price is not a number`.
     If it still has more than 2 decimals, reject: `price has more than 2 decimal places`.
     If it has more than 10 digits before the point, reject: `price is too large` (0 rows), since `numeric(12, 2)` can't hold it.
   - Lead Time: trim.
     Blank or `TBD` in any case becomes NULL (P24).
     `STOCK` in any case becomes 0 (P25).
     `^\d+$` is days.
     `^\d+ ?(d|day|days)$`, ignoring case, is days.
     `^\d+ ?(wk|wks|week|weeks)$`, ignoring case, is weeks, times 7 (P26).
     Anything else is rejected: `lead time is not a number of days or weeks` (0 rows).
     Above 2,147,483,647 days, reject: `lead time is too large` (0 rows).
7. **Last Updated.**
   Trim.
   If blank, reject: `last updated is missing` (P27).
   Read `YYYY-MM-DD` and `MM/DD/YYYY` as midnight UTC on that date, and `YYYY-MM-DDTHH:MM:SSZ` as that instant in UTC (P28).
   Anything else, or a date that doesn't exist such as `02/30/2025`, is rejected: `last updated is not a valid date` (0 rows).
8. **Description.**
   Trim, and store blank as NULL.

**Why UTC for dates without a time.**
The only explicit offset in the file is `Z`, so UTC puts all three formats on one clock.
The choice could only change a result when a date-only value and a date-time fall on the same day in the same group, and that happens in 0 groups.
Midnight also keeps re-runs deterministic, which a local time zone of the import server would not.

### 4.3 Reject reasons

The order is the precedence from 4.2, and each rejected row counts once, under its first failing step.

| Order | Reason | Rows |
| ---: | --- | ---: |
| 1 | `row is empty` | 605 |
| 2 | `row has too few columns` | 480 |
| 3 | `row is a repeated header` | 3 |
| 4 | `part number is missing` | 600 |
| 5 | `part number has no letters or digits` | 0 |
| 6 | `supplier is missing` | 0 |
| 7 | `supplier has no letters or digits` | 0 |
| 8 | `quantity is missing` | 15,558 |
| 9 | `quantity is negative` | 1,197 |
| 10 | `quantity is not a whole number` | 0 |
| 11 | `quantity is too large` | 0 |
| 12 | `price is missing` | 14,248 |
| 13 | `price is CALL` | 4,792 |
| 14 | `price is negative` | 1,150 |
| 15 | `price is not a number` | 0 |
| 16 | `price has more than 2 decimal places` | 0 |
| 17 | `price is too large` | 0 |
| 18 | `lead time is not a number of days or weeks` | 0 |
| 19 | `lead time is too large` | 0 |
| 20 | `last updated is missing` | 10,570 |
| 21 | `last updated is not a valid date` | 0 |
| | **Total rejected** | **49,203** |
| | Accepted | 1,154,284 |

`rowsRead` in the summary should be the 1,203,487 data lines, so that accepted plus rejected always equals it.

## 5. Identity and duplicates

Parts are grouped by `normalize_key(Supplier)` and `normalize_key(Part Number)`.

| Measure | Every row with a usable key | Accepted rows only |
| --- | ---: | ---: |
| Rows | 1,201,799 | 1,154,284 |
| Distinct parts | 1,144,376 | 1,100,111 |
| Duplicate groups (2 or more copies) | 56,028 | 52,898 |
| Groups of 2, 3, and 4 copies | 54,661; 1,340; 28 | 51,644; 1,233; 21 |
| Largest group | 4 | 4 |

The first column counts every row of 8 or more fields that has both a part number and a supplier, before the value rules; the second is what the import deduplicates.
44,265 parts have no valid row at all, so the import would not load them, and a part already in the database would be marked unavailable.

**Distance between copies.**
In accepted duplicate groups, the first and last copy of a part are a median 359,209 lines apart, and at most 1,198,638.
The winning copy is the last one in the file in 28,980 groups and an earlier one in 23,918, so "newest wins wherever it sits" (C3) matters about as often as not.

**Copies with different values.**
In 47,669 of the 52,898 accepted groups, the copies differ in quantity, price, lead time, or last updated.
The other 5,229 groups are copies with identical values.
Between true copies, prices move by at most 25%: the largest ratio of a group's highest to lowest price is 1.25.

**Copies that are different parts (P31).**
Grouping copies by whether their descriptions differ and whether their part numbers differ by more than case shows two kinds of group that don't behave like copies.
Price ratios are a group's highest price over its lowest, for groups with at least two prices:

| Description differs | Part number punctuation differs | Has a 9 or 10 field row | Groups | Median price ratio | Max price ratio |
| --- | --- | --- | ---: | ---: | ---: |
| No | No | No | 55,744 | 1.05 | 1.25 |
| Yes | No | No | 3 | 1.05 | 1.06 |
| Yes | Yes | No | 249 | 6.28 | 702.71 |
| No | Yes | No | 1 | 3.83 | 3.83 |
| Yes | Yes | Yes | 1 | 2.25 | 2.25 |
| Yes | No | Yes | 28 | 5.00 | 119.46 |
| No | No | Yes | 2 | 4.15 | 5.63 |

- **Punctuation:** all 251 groups whose part numbers differ by a dash or slash look like two different parts.
  250 of them have different descriptions, and their prices are a median 6.2 times apart.
  Case-only variants, by contrast, are always the same part: in the 5,402 groups whose spellings differ only in case, the case variants always share a description.
  The one exception, `AN919PD47`, is a long row on line 758702 sitting beside two matching copies.
  So in this data, case and outer spaces don't matter but a dash does, which contradicts C10 (OQ1).
- **Long rows:** 30 groups pair a 9 or 10 field row with a row of the same part number that looks like a different part.
  C2 says supplier plus part number is the identity, so these are one part and the newest copy wins.
  No rule can tell them apart, so this is only noted.
- The 3 groups with different descriptions and close prices are real copies, where one copy's description has a Windows-1252 suffix such as `Ø35MM` (P2).

**The A4 tie case.**
5,338 accepted groups have two or more rows at their newest timestamp.
In every one of them the tied rows are byte-identical lines, so the A4 rule (the later line wins) never changes the result.
Including rejected rows, the count is 5,506 groups, again all identical.
In total, 5,692 sets of lines (11,406 rows) are exact repeats of another line.

**The newest copy is rejected (P32).**
In 1,473 groups the newest copy is rejected while an older copy is valid: 585 for a missing quantity, 581 for a missing price, 194 for `CALL`, 58 for a negative price, and 55 for a negative quantity.
A reject-then-deduplicate import would quietly use the older copy.
In 224 more groups no copy is valid, and in 3 groups a copy without a readable timestamp sits beside a valid one, so nobody can tell whether it was newer.
OQ2 asks what should happen.

**Future dates (P29).**
3,900 accepted rows are dated after 2026-10-10, and in 3,773 groups such a row is the newest copy, beating an older one.
For example, line 331 (`2026-10-31`) beats line 71926 (`2026-06-29T05:54:14Z`), and line 148 (`2027-01-20T04:07:54Z`) beats line 234448 (`2026-09-27`).

## 6. Distributions

These are for WS-B's benchmark data.
Unless noted, they describe the 1,100,111 parts left after cleaning and deduplication, which is what the `parts` table will hold.

**Suppliers.**
There are 40 suppliers, spread almost evenly.

| | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Parts per supplier | 27,107 | 27,482 | 27,818 |
| Rows per supplier in the file | 29,648 | 30,056 | 30,385 |

- Top 5 by parts: Pioneer Seal & Gasket 27,818; Harbor Point Industrial 27,781; Continental Hose Co 27,754; Highland Electrical Supply 27,750; Bridgewater Avionics 27,735.
- Top 5 by rows in the file: Harbor Point Industrial 30,385; Continental Hose Co 30,352; Highland Electrical Supply 30,349; Pioneer Seal & Gasket 30,347; Bridgewater Avionics 30,298.
- The same part number is carried by several suppliers: the 1,100,111 parts have 567,788 distinct `part_number_key` values, 305,208 of them carried by 2 or more suppliers and up to 11.

**Part numbers.**
The displayed part number is 5 to 19 characters long, with a median of 11.
`part_number_key` is 4 to 16 characters long, with a median of 10.
There are 142 shapes, counted in upper case; the 10 most common are:

| Shape | Parts | Share |
| --- | ---: | ---: |
| `9999-9999-99` | 272,776 | 24.8% |
| `99a99999-9` | 219,622 | 20.0% |
| `aa99999-9` | 67,635 | 6.1% |
| `aa99999a` | 66,852 | 6.1% |
| `a99999/99aa99aa` | 38,234 | 3.5% |
| `aa99999` | 33,264 | 3.0% |
| `aaa99a9999aa` | 32,912 | 3.0% |
| `9999-999-99` | 28,049 | 2.5% |
| `999-9999-99` | 27,648 | 2.5% |
| `aa99999a999` | 23,788 | 2.2% |

**Values.**

| Column | p1 | p50 | p99 | Max |
| --- | ---: | ---: | ---: | ---: |
| Quantity | 0 | 13 | 394 | 25,000 |
| Price (USD) | 0.09 | 11.81 | 4,948.87 | 15,839.85 |
| Lead time (days) | 0 | 35 | 180 | 180 |

- **Zero stock:** 131,590 parts (12.0%).
- **Missing lead time:** 16,332 parts (1.5%).
- **Lead time takes only 16 values,** so sorting by it has large ties: 0 days 171,088 parts; 14 days 113,836; each of 7, 21, 28, 30, 35, 42, 45, 56, 60, 70, 84, 90, 120, and 180 days about 57,000; NULL 16,332.
- Quantity has 3,202 distinct values and price 131,473.

## 7. Answers to PRD questions

**Q8: currency and units.**

- **Price is in US dollars.**
  96,032 prices carry `$` and 11,987 carry ` USD`, no row has both, and no other currency symbol or code appears.
  So A11 (one currency) holds.
- **Lead time is in whole calendar days.**
  The file writes it as plain numbers of days, as days (`90 days`, `56d`), or as weeks (`3 wks`, `12 weeks`), which convert at 7 days to a week.
  Nothing says business days.
  `STOCK` is 0 days, and blank or `TBD` is unknown.
- **Quantity is in whole units.**
  The file has no unit-of-measure column, and every non-negative quantity is a whole number.

**Q3 and A4: do duplicates share a timestamp?**
Yes, in 5,338 accepted groups, but only between byte-identical lines.
No group has two different rows at its newest timestamp, so A4 is safe and never changes the outcome on this file.

## 8. Open questions for T0.3

**OQ1. Should part numbers that differ only by a dash be separate parts? (P31)**
C10 says punctuation doesn't matter, and the interviewer confirmed it.
But in this file every one of the 251 groups whose part numbers differ by a dash or slash looks like two different parts, with different descriptions and prices a median 6.2 times apart.

- **Follow C10 (current rule):** 251 parts collapse into others, and the buyer sees one of them under the other's description and price.
- **Treat `-` and `/` as significant:** `normalize_key` would keep them, which changes C10, D13, and search ("ab 123" would no longer find "AB-123-X").
- **Recommendation:** raise it with the interviewer, since the data contradicts a confirmed fact.
  Follow C10 until then.

**OQ2. When the newest copy of a part is rejected, does the next-newest valid copy win, or is the part skipped? (P32)**
This happens in 1,473 groups.

- **Next-newest valid copy wins:** what a reject-then-deduplicate import does without extra work, but it shows data the export has since replaced.
- **Skip the part:** keeps C3's "newest wins" strict, but a part already in the database would then be marked unavailable, or left unchanged, depending on what T0.3 picks.

Relatedly, 3 groups have a copy whose timestamp is missing, so its place among the copies is unknown.

**OQ3. What should happen to rows dated in the future? (P29)**
3,996 rows are dated after 2026-10-10, and C3 lets such a row win 3,773 groups.
A future-dated row would also keep winning over real updates in later files until the calendar catches up.

- **Accept them (current rule):** C3 as written, and re-runs stay deterministic.
- **Reject rows dated after the import starts, plus a day for time zones:** `last updated is in the future`.
  The cost is that re-importing the same file later can accept rows it rejected before, which strains R1.4, and the newest-copy question in OQ2 then applies to 3,773 more groups.
- The file has no export date to compare against.
  Its main data ends on 2026-09-30, but nothing in the file says so.

**OQ4. Should parts with an unknown quantity or price be kept? (P11, P15, P16)**
Rejecting them means 44,265 parts have no valid row and are not imported, and a part already in the database would be marked unavailable.

- **Reject (current rule):** keeps `quantity` and `price` `NOT NULL` as in PRD 7.1.
- **Keep with NULL:** the buyer still finds the part, unknown values sort last like lead time, and a part without a price can't be quoted until the buyer types one.
  This changes PRD 7.1 and the quote rules in R3.2.

**OQ5. Which spelling should the table display?**
A13 shows each supplier under the spelling of its newest row.
For 12 of the 40 suppliers that is an odd variant: `apex machined parts`, `granite state fasteners`, `harbor point industrial`, and `westbrook seals` in lower case; `BRIDGEWATER AVIONICS`, `GREAT PLAINS HYDRAULICS`, `PINECREST INDUSTRIAL`, `RIVERSIDE PRECISION BOLT`, and `SENTINEL AERO PARTS` in upper case; and `Anchor Fluid Power.`, `Continental Hose Co.`, and `Redstone Defense Supply.` with a trailing period.
For part numbers, 3,130 parts would display in lower case.

- **Keep A13:** simplest, but the display flips between variants from night to night.
- **Use each supplier's most common spelling:** always the clean name in this file, and only changes PRD 7.2 step 5 from the newest row to the most frequent one.
- **Upper-case part numbers for display:** part numbers are conventionally upper case, and the key already ignores case.

**OQ6. Confirm the column list.**
This profile recommends keeping Description for display and dropping NSN (section 3).
T0.3 decides the final columns (R2.1).

## 9. Reproducing this profile

Every number above comes from these two scripts, run against the full file.
They take about 5 seconds on a laptop, and only `lines.csv` is written, so keep it outside the repo.

```sh
cd <a scratch folder>
python3 -I to_lines.py <repo>/mock_data/mock_a/parts_export.csv lines.csv
duckdb < profile.sql
```

The DuckDB comparison in section 2 is:

```sql
CREATE TABLE raw AS
  SELECT * FROM read_csv('<repo>/mock_data/mock_a/parts_export.csv', all_varchar = true, store_rejects = true);
SELECT count(*) FROM raw;                                          -- 1,200,883
SELECT error_type, count(DISTINCT line) FROM reject_errors GROUP BY ALL;  -- 480 + 1,800 lines, and 25 invalid encoding
```

### `to_lines.py`

It prints the byte-level facts in section 2 and writes `lines.csv`, with one row per physical line: its line number, field count, whether it was decoded as Windows-1252, and up to 10 fields.

```python
"""Re-emit parts_export.csv as lines.csv: one row per physical line, with its exact line number.

DuckDB's own CSV reader silently skips blank lines and drops lines with the wrong column count
or invalid UTF-8, so row_number() over it drifts from real line numbers. This keeps every line.
Usage: python3 -I to_lines.py <parts_export.csv> <lines.csv>
"""
import collections, csv, sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
print('bytes', len(data), '| BOM', data.startswith(b'\xef\xbb\xbf'),
      '| LF', data.count(b'\n'), '| CRLF', data.count(b'\r\n'), '| NUL', data.count(b'\x00'), '| TAB', data.count(b'\t'))
lines = data.split(b'\r\n')
assert lines[-1] == b'', 'file should end with CRLF'
lines = lines[:-1]
hist, bad_utf8, bad_quotes, quoted_at = collections.Counter(), [], [], collections.Counter()

def strict_quotes(s):
    """True when every quote opens a field and closes right before a comma or the line end (RFC 4180)."""
    i, n, field = 0, len(s), 0
    while True:
        if i < n and s[i] == '"':
            quoted_at[field] += 1
            i += 1
            while True:
                k = s.find('"', i)
                if k == -1: return False
                if s[k + 1:k + 2] == '"': i = k + 2; continue
                i = k + 1; break
            if i < n and s[i] != ',': return False
        else:
            k = s.find(',', i); k = n if k == -1 else k
            if '"' in s[i:k]: return False
            i = k
        if i >= n: return True
        i += 1; field += 1

with open(dst, 'w', newline='', encoding='utf-8') as out:
    w = csv.writer(out)
    w.writerow(['line', 'nfields', 'cp1252'] + [f'f{i}' for i in range(1, 11)])
    for lineno, b in enumerate(lines, start=1):
        if lineno == 1: b = b[3:]  # the BOM
        try: s, fallback = b.decode('utf-8'), 0
        except UnicodeDecodeError: s, fallback = b.decode('cp1252'), 1; bad_utf8.append(lineno)
        if not strict_quotes(s): bad_quotes.append(lineno)
        row = next(csv.reader([s]), [])
        if lineno == 1: print('header', row); continue
        hist[len(row)] += 1
        w.writerow([lineno, len(row), fallback] + row + [None] * (10 - len(row)))

print('data lines', sum(hist.values()), '| fields per line', sorted(hist.items()))
print('lines not valid UTF-8', len(bad_utf8), bad_utf8[:5])
print('lines breaking strict quoting', len(bad_quotes), '| quoted fields by position', sorted(quoted_at.items()))
```

### `profile.sql`

It builds the rows, applies the rules from section 4.2, and prints every number in sections 1 to 6, in order.
The last queries print the first line numbers for each problem, without their values, so each example in section 4 can be checked with `sed -n '<n>p'`.

```sql
-- Reproduces every number in docs/data-profile.md. Run from the folder holding lines.csv:
--   duckdb < profile.sql
SET TimeZone = 'UTC';
.mode duckbox
.maxrows 300

-- normalize_key from PRD 7.1, and a value's shape (letters become a, digits become 9).
CREATE MACRO nk(x) AS regexp_replace(upper(x), '[^A-Z0-9]', '', 'g');
CREATE MACRO shape(x) AS regexp_replace(regexp_replace(x, '[A-Za-z]', 'a', 'g'), '[0-9]', '9', 'g');

CREATE TABLE l AS
  SELECT * REPLACE (line::INT AS line, nfields::INT AS nfields, cp1252::INT AS cp1252)
  FROM read_csv('lines.csv', all_varchar = true, header = true);

-- Every data line as the 8 named columns.
-- Lines with 9 or 10 fields put their extra commas back into Description (P5).
CREATE TABLE d AS SELECT line, nfields, cp1252,
  f1 AS pn, f2 AS nsn,
  CASE nfields WHEN 9 THEN f3 || ',' || f4 WHEN 10 THEN f3 || ',' || f4 || ',' || f5 ELSE f3 END AS descr,
  CASE nfields WHEN 9 THEN f5 WHEN 10 THEN f6 ELSE f4 END AS supplier,
  CASE nfields WHEN 9 THEN f6 WHEN 10 THEN f7 ELSE f5 END AS qty,
  CASE nfields WHEN 9 THEN f7 WHEN 10 THEN f8 ELSE f6 END AS price,
  CASE nfields WHEN 9 THEN f8 WHEN 10 THEN f9 ELSE f7 END AS lead,
  CASE nfields WHEN 9 THEN f9 WHEN 10 THEN f10 ELSE f8 END AS updated,
  coalesce(f1, f2, f3, f4, f5, f6, f7, f8, f9, f10) IS NULL AS is_empty,
  coalesce(nfields = 8 AND f1 = 'Part Number' AND f2 = 'NSN' AND f3 = 'Description' AND f4 = 'Supplier'
    AND f5 = 'Qty On Hand' AND f6 = 'Unit Price' AND f7 = 'Lead Time' AND f8 = 'Last Updated', false) AS is_header
FROM l;

-- e: rows that carry data (8 or more fields, not empty, not a repeated header). Column profiles use e.
CREATE VIEW e AS SELECT * FROM d WHERE nfields >= 8 AND NOT is_empty AND NOT is_header;

-- The rules from section 4, in their precedence order. Each line gets clean values or a reject reason.
CREATE TABLE clean AS
WITH t AS (
  SELECT *,
    trim(pn) AS pn_t,
    trim(regexp_replace(supplier, '\s+', ' ', 'g')) AS sup_t,
    trim(qty) AS qty_t,
    trim(price) AS price_raw_t,
    trim(regexp_replace(regexp_replace(trim(price), '^\$', ''), '\s*USD$', '', 'i')) AS price_t,
    trim(lead) AS lead_t,
    trim(updated) AS upd_t
  FROM d
), n AS (
  SELECT *,
    regexp_replace(
      CASE WHEN regexp_matches(qty_t, '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$') THEN replace(qty_t, ',', '') ELSE qty_t END,
      '^([0-9]+)\.0+$', '\1') AS qty_n,
    regexp_replace(
      CASE WHEN regexp_matches(price_t, '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$') THEN replace(price_t, ',', '') ELSE price_t END,
      '^([0-9]+\.[0-9]{2})0+$', '\1') AS price_n,
    CASE
      WHEN upper(lead_t) = 'STOCK' THEN '0'
      WHEN regexp_matches(lead_t, '^[0-9]+$') THEN lead_t
      WHEN regexp_matches(lead_t, '^[0-9]+ ?(d|day|days)$', 'i') THEN regexp_extract(lead_t, '^[0-9]+')
      WHEN regexp_matches(lead_t, '^[0-9]+ ?(wk|wks|week|weeks)$', 'i') THEN (try_cast(regexp_extract(lead_t, '^[0-9]+') AS HUGEINT) * 7)::VARCHAR
    END AS lead_n,
    CASE
      WHEN regexp_matches(upd_t, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN try_strptime(upd_t || ' +0000', '%Y-%m-%d %z')
      WHEN regexp_matches(upd_t, '^[0-9]{2}/[0-9]{2}/[0-9]{4}$') THEN try_strptime(upd_t || ' +0000', '%m/%d/%Y %z')
      WHEN regexp_matches(upd_t, '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$') THEN try_strptime(upd_t, '%Y-%m-%dT%H:%M:%SZ')
    END AS ts
  FROM t
)
SELECT line, nfields, cp1252, is_empty, is_header, pn, nsn, descr, supplier, qty, price, lead, updated,
  pn_t AS part_number, sup_t AS supplier_clean, nk(pn_t) AS pk, nk(sup_t) AS sk,
  CASE
    WHEN is_empty THEN 'row is empty'
    WHEN nfields < 8 THEN 'row has too few columns'
    WHEN is_header THEN 'row is a repeated header'
    WHEN coalesce(pn_t, '') = '' THEN 'part number is missing'
    WHEN nk(pn_t) = '' THEN 'part number has no letters or digits'
    WHEN coalesce(sup_t, '') = '' THEN 'supplier is missing'
    WHEN nk(sup_t) = '' THEN 'supplier has no letters or digits'
    WHEN coalesce(qty_t, '') = '' OR upper(qty_t) = 'N/A' THEN 'quantity is missing'
    WHEN regexp_matches(qty_t, '^-[0-9]') THEN 'quantity is negative'
    WHEN NOT regexp_matches(qty_n, '^[0-9]+$') THEN 'quantity is not a whole number'
    WHEN try_cast(qty_n AS HUGEINT) > 2147483647 THEN 'quantity is too large'
    WHEN coalesce(price_raw_t, '') = '' THEN 'price is missing'
    WHEN upper(price_raw_t) = 'CALL' THEN 'price is CALL'
    WHEN regexp_matches(price_t, '^-[0-9]') THEN 'price is negative'
    WHEN NOT regexp_matches(price_n, '^[0-9]+(\.[0-9]+)?$') THEN 'price is not a number'
    WHEN regexp_matches(price_n, '\.[0-9]{3,}$') THEN 'price has more than 2 decimal places'
    WHEN length(split_part(price_n, '.', 1)) > 10 THEN 'price is too large'
    WHEN coalesce(lead_t, '') <> '' AND upper(lead_t) <> 'TBD' AND lead_n IS NULL THEN 'lead time is not a number of days or weeks'
    WHEN try_cast(lead_n AS HUGEINT) > 2147483647 THEN 'lead time is too large'
    WHEN coalesce(upd_t, '') = '' THEN 'last updated is missing'
    WHEN ts IS NULL THEN 'last updated is not a valid date'
  END AS reject_reason,
  CASE WHEN try_cast(qty_n AS HUGEINT) <= 2147483647 THEN try_cast(qty_n AS INT) END AS quantity,
  CASE WHEN regexp_matches(price_n, '^[0-9]{1,10}(\.[0-9]{1,2})?$') THEN try_cast(price_n AS DECIMAL(12, 2)) END AS price_clean,
  CASE WHEN try_cast(lead_n AS HUGEINT) <= 2147483647 THEN try_cast(lead_n AS INT) END AS lead_time_days,
  ts AS last_updated
FROM n;

-- ok: accepted rows, ranked within each part by the import's order (newest first, then later line, C3 and A4).
CREATE TABLE ok AS
  SELECT *,
    row_number() OVER (PARTITION BY sk, pk ORDER BY last_updated DESC, line DESC) AS rnk,
    count(*) OVER (PARTITION BY sk, pk) AS copies,
    max(last_updated) OVER (PARTITION BY sk, pk) AS newest
  FROM clean WHERE reject_reason IS NULL;
CREATE TABLE parts AS SELECT * FROM ok WHERE rnk = 1;

-- kr: every row of 8 or more fields with a usable key, accepted or not, ranked the same way (rows without a timestamp last).
CREATE TABLE kr AS
  SELECT *,
    row_number() OVER (PARTITION BY sk, pk ORDER BY last_updated DESC NULLS LAST, line DESC) AS rnk,
    count(*) OVER (PARTITION BY sk, pk) AS copies,
    count(*) FILTER (reject_reason IS NULL) OVER (PARTITION BY sk, pk) AS copies_ok
  FROM clean WHERE nfields >= 8 AND NOT is_header AND coalesce(pk, '') <> '' AND coalesce(sk, '') <> '';

.print '== 1. Summary'
SELECT (SELECT count(*) FROM clean) AS data_lines,
       (SELECT count(*) FROM clean WHERE reject_reason IS NOT NULL) AS rejected,
       (SELECT count(*) FROM ok) AS accepted,
       (SELECT count(*) FROM parts) AS distinct_parts,
       (SELECT count(*) FROM parts WHERE copies > 1) AS duplicate_groups,
       (SELECT count(*) FROM ok) - (SELECT count(*) FROM parts) AS duplicates_collapsed,
       (SELECT count(DISTINCT sk) FROM parts) AS suppliers,
       (SELECT count(DISTINCT supplier) FROM e) AS supplier_spellings;

.print '== 2. File format: fields per line, and lines DuckDB native read_csv drops'
SELECT nfields, count(*) AS n, min(line) AS first_line, count(*) FILTER (cp1252 = 1) AS not_utf8 FROM l GROUP BY ALL ORDER BY nfields;
SELECT count(*) AS all_empty_8_field_rows, count(*) FILTER (line > (SELECT max(line) FROM l) - 5) AS at_end_of_file FROM d WHERE is_empty AND nfields = 8;
SELECT string_agg(line::VARCHAR, ', ' ORDER BY line) AS repeated_header_lines FROM d WHERE is_header;
SELECT line, left(descr, 60) AS description_with_cp1252 FROM d WHERE cp1252 = 1 ORDER BY line LIMIT 5;
-- Long rows are clean everywhere except the unquoted commas: their last five fields always fit the column formats.
SELECT count(*) AS long_rows,
  count(*) FILTER (regexp_matches(qty, '^[0-9]+$') AND regexp_matches(price, '^[0-9]+\.[0-9]{2}$') AND regexp_matches(lead, '^[0-9]+$')
    AND regexp_matches(updated, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) AS trailing_fields_valid,
  count(*) FILTER (supplier IN (SELECT supplier FROM d WHERE nfields = 8)) AS supplier_is_a_known_spelling
FROM d WHERE nfields > 8;

.print '== 3. Columns: blanks and padding (rows in e)'
SELECT count(*) AS rows_,
  count(*) FILTER (pn IS NULL) AS pn_blank, count(*) FILTER (pn <> trim(pn)) AS pn_padded, count(*) FILTER (pn LIKE ' %') AS pn_leading_space,
  count(*) FILTER (regexp_matches(pn, '[a-z]')) AS pn_lowercase, count(*) FILTER (nk(pn) = '') AS pn_empty_key, count(*) FILTER (trim(pn) LIKE '% %') AS pn_inner_space,
  count(*) FILTER (nsn IS NULL) AS nsn_blank, count(*) FILTER (descr IS NULL) AS descr_blank, count(*) FILTER (supplier IS NULL) AS supplier_blank,
  count(*) FILTER (qty IS NULL) AS qty_blank, count(*) FILTER (price IS NULL) AS price_blank,
  count(*) FILTER (lead IS NULL) AS lead_blank, count(*) FILTER (updated IS NULL) AS updated_blank
FROM e;
-- Characters other than A-Z and 0-9 in part numbers.
SELECT ch, ord(ch) AS codepoint, count(*) AS occurrences
FROM (SELECT unnest(string_split(regexp_replace(pn, '[A-Z0-9]', '', 'g'), '')) AS ch FROM e WHERE pn IS NOT NULL)
WHERE ch <> '' GROUP BY ALL ORDER BY occurrences DESC;
-- Shapes per column (change the column name to profile another one).
SELECT shape(qty) AS shape, count(*) AS n FROM e GROUP BY ALL ORDER BY n DESC;
SELECT shape(price) AS shape, count(*) AS n FROM e GROUP BY ALL ORDER BY n DESC LIMIT 45;
SELECT regexp_replace(lead, '[0-9]+', '#', 'g') AS form, count(*) AS n,
  min(try_cast(regexp_extract(lead, '[0-9]+') AS INT)) AS min_number, max(try_cast(regexp_extract(lead, '[0-9]+') AS INT)) AS max_number
FROM e GROUP BY ALL ORDER BY n DESC;
SELECT shape(updated) AS shape, count(*) AS n FROM e GROUP BY ALL ORDER BY n DESC;
SELECT shape(nsn) AS shape, count(*) AS n FROM e GROUP BY ALL ORDER BY n DESC;
SELECT count(DISTINCT descr) AS distinct_descriptions, max(length(descr)) AS max_length FROM e;

.print '== 3. Columns: quantity, price, lead time, last updated details'
SELECT count(*) FILTER (qty = 'N/A') AS qty_na, count(*) FILTER (qty LIKE '%,%') AS qty_commas, count(*) FILTER (qty LIKE '%.%') AS qty_decimal,
  count(*) FILTER (qty LIKE '%.%' AND NOT regexp_matches(qty, '\.0+$')) AS qty_nonzero_fraction, count(*) FILTER (qty LIKE '-%') AS qty_negative,
  count(*) FILTER (qty = '0') AS qty_zero, count(*) FILTER (qty = '-1') AS qty_minus_one, min(try_cast(qty AS INT)) AS qty_min
FROM e;
SELECT count(*) FILTER (price LIKE '$%') AS dollar, count(*) FILTER (price ILIKE '% USD') AS usd, count(*) FILTER (price LIKE '$%' AND price ILIKE '%USD') AS both_,
  count(*) FILTER (regexp_matches(price, '[A-Za-z]') AND NOT price ILIKE '% USD') AS text_values, count(*) FILTER (price = 'CALL') AS call,
  count(*) FILTER (price LIKE '%,%') AS commas, count(*) FILTER (price LIKE '%,%' AND NOT regexp_matches(trim(price), '^\$?[0-9]{1,3}(,[0-9]{3})+\.[0-9]{2}$')) AS commas_other,
  count(*) FILTER (price <> trim(price)) AS padded, count(*) FILTER (price LIKE '-%') AS negative
FROM e;
SELECT length(split_part(p, '.', 2)) AS decimals, count(*) AS n, count(*) FILTER (regexp_matches(p, '\.[0-9]{2}00$')) AS ends_in_00
FROM (SELECT replace(trim(regexp_replace(regexp_replace(trim(price), '^\$', ''), '\s*USD$', '', 'i')), ',', '') AS p FROM e)
WHERE regexp_matches(p, '^-?[0-9]+(\.[0-9]+)?$') GROUP BY ALL ORDER BY decimals;
SELECT min(v) AS min_price, max(v) AS max_price, count(*) FILTER (v = 0) AS zero_price
FROM (SELECT try_cast(replace(trim(regexp_replace(regexp_replace(trim(price), '^\$', ''), '\s*USD$', '', 'i')), ',', '') AS DECIMAL(18, 4)) AS v FROM e);
-- Plain lead-time numbers use the same values as "N days"; weeks are 1 to 12.
SELECT regexp_replace(lead, '[0-9]+', '#', 'g') AS form, list_sort(list(DISTINCT regexp_extract(lead, '[0-9]+')::INT)) AS numbers
FROM e WHERE regexp_matches(lead, '[0-9]') GROUP BY ALL ORDER BY form;
SELECT lead = 'STOCK' AS is_stock, lead = '0' AS is_zero, count(*) AS n, round(100.0 * count(*) FILTER (qty = '0') / count(*), 1) AS pct_qty_zero
FROM e WHERE lead IS NOT NULL GROUP BY ALL ORDER BY ALL;
-- Slash dates: the first number is never above 12, the second often is, so they are MM/DD/YYYY.
SELECT count(*) AS slash_dates, count(*) FILTER (split_part(updated, '/', 1)::INT > 12) AS first_above_12,
  count(*) FILTER (split_part(updated, '/', 2)::INT > 12) AS second_above_12
FROM e WHERE shape(updated) = '99/99/9999';
SELECT shape(updated) AS shape, count(*) AS n, count(*) FILTER (last_updated IS NULL) AS invalid, min(last_updated) AS earliest, max(last_updated) AS latest,
  count(*) FILTER (last_updated >= TIMESTAMPTZ '2026-10-11 00:00:00+00') AS after_2026_10_10
FROM clean WHERE updated IS NOT NULL AND nfields >= 8 AND NOT is_empty AND NOT is_header GROUP BY ALL ORDER BY n DESC;
SELECT strftime(last_updated, '%Y-%m') AS month, count(*) AS n FROM clean WHERE last_updated IS NOT NULL GROUP BY ALL ORDER BY month;

.print '== 3. Columns: supplier spellings grouped by normalize_key'
SELECT nk(supplier) AS supplier_key, supplier AS spelling, count(*) AS n FROM e GROUP BY ALL ORDER BY supplier_key, n DESC;
-- Each key holds one name once case, spaces, and a trailing period are ignored.
SELECT count(*) AS keys, max(names) AS max_names_per_key FROM (
  SELECT nk(supplier), count(DISTINCT regexp_replace(lower(trim(regexp_replace(supplier, '\s+', ' ', 'g'))), '\.$', '')) AS names FROM e GROUP BY 1);
-- Every key has exactly six spellings: the most common one (C), upper(C), lower(C), '  ' || C || ' ', C || '.', and C with its first space doubled.
WITH sp AS (SELECT nk(supplier) AS k, supplier AS s, count(*) AS n FROM e GROUP BY ALL),
     canon AS (SELECT k, arg_max(s, n) AS c FROM sp GROUP BY k)
SELECT count(*) AS keys, count(*) FILTER (list_sort(spellings) = list_sort([c, upper(c), lower(c), '  ' || c || ' ', c || '.', regexp_replace(c, ' ', '  ')])) AS match_the_six_patterns
FROM (SELECT k, c, list(s) AS spellings FROM sp JOIN canon USING (k) GROUP BY k, c);
SELECT count(*) FILTER (supplier = upper(supplier)) AS upper_case, count(*) FILTER (supplier = lower(supplier)) AS lower_case,
  count(*) FILTER (supplier <> trim(supplier)) AS padded, count(*) FILTER (supplier LIKE '%.') AS trailing_period,
  count(*) FILTER (trim(supplier) LIKE '%  %') AS double_space
FROM e;

.print '== 4. Data problems: first-match reject reasons'
SELECT coalesce(reject_reason, '(accepted)') AS reason, count(*) AS n FROM clean GROUP BY ALL ORDER BY n DESC;

.print '== 5. Identity and duplicates'
-- Before the value rules: every row with a usable key.
SELECT count(*) AS rows_, count(DISTINCT (sk, pk)) AS parts FROM kr;
SELECT count(*) AS parts, count(*) FILTER (copies > 1) AS duplicate_groups, max(copies) AS largest,
  count(*) FILTER (copies_ok = 0) AS parts_with_no_valid_row FROM kr WHERE rnk = 1;
-- After the value rules: what the import deduplicates.
SELECT copies, count(*) AS n_groups FROM parts GROUP BY ALL ORDER BY copies;
SELECT median(dist) AS median_line_distance, max(dist) AS max_line_distance
FROM (SELECT max(line) - min(line) AS dist FROM ok WHERE copies > 1 GROUP BY sk, pk);
SELECT count(*) FILTER (line = last_line) AS winner_is_last_copy, count(*) FILTER (line <> last_line) AS winner_is_earlier
FROM (SELECT *, max(line) OVER (PARTITION BY sk, pk) AS last_line FROM ok WHERE copies > 1) WHERE rnk = 1;
SELECT count(*) AS groups_, count(*) FILTER (n_values > 1) AS values_differ FROM (
  SELECT count(DISTINCT (quantity, price_clean, lead_time_days, last_updated)) AS n_values FROM ok WHERE copies > 1 GROUP BY sk, pk);
-- Same-key copies whose part numbers differ beyond case and outer spaces, or whose descriptions differ.
CREATE TABLE gx AS
  SELECT sk, pk, count(DISTINCT descr) > 1 AS descr_differs,
    count(DISTINCT regexp_replace(upper(part_number), '[^A-Z0-9/-]', '', 'g')) > 1 AS punct_differs,
    count(*) FILTER (nfields > 8) > 0 AS has_long_row,
    CASE WHEN count(price_clean) >= 2 THEN max(price_clean) / nullif(min(price_clean), 0) END AS price_ratio
  FROM kr WHERE copies > 1 GROUP BY sk, pk;
SELECT descr_differs, punct_differs, has_long_row, count(*) AS n_groups, median(price_ratio) AS median_price_ratio, max(price_ratio) AS max_price_ratio
FROM gx GROUP BY ALL ORDER BY ALL;
SELECT count(*) AS punctuation_groups, count(*) FILTER (descr_differs) AS with_different_descriptions, median(price_ratio) AS median_price_ratio FROM gx WHERE punct_differs;
-- A4: the newest timestamp shared by two or more rows, among accepted rows and among all keyed rows.
SELECT count(*) AS tie_groups, count(*) FILTER (n_raw > 1) AS tie_groups_with_different_values FROM (
  SELECT count(DISTINCT (pn, nsn, descr, supplier, qty, price, lead, updated)) AS n_raw FROM ok WHERE last_updated = newest AND copies > 1 GROUP BY sk, pk HAVING count(*) > 1);
SELECT count(*) AS tie_groups, count(*) FILTER (n_raw > 1) AS tie_groups_with_different_values FROM (
  SELECT count(DISTINCT (pn, nsn, descr, supplier, qty, price, lead, updated)) AS n_raw
  FROM (SELECT *, max(last_updated) OVER (PARTITION BY sk, pk) AS mx FROM kr WHERE last_updated IS NOT NULL)
  WHERE last_updated = mx GROUP BY sk, pk HAVING count(*) > 1);
SELECT count(*) AS groups_of_identical_lines, sum(n) AS rows_ FROM (SELECT count(*) AS n FROM e GROUP BY pn, nsn, descr, supplier, qty, price, lead, updated HAVING count(*) > 1);
-- Newest copy rejected while an older copy is valid.
SELECT count(*) FILTER (reject_reason IS NOT NULL AND last_updated IS NOT NULL AND copies_ok > 0) AS newest_rejected_older_valid,
  count(*) FILTER (reject_reason IS NOT NULL AND last_updated IS NOT NULL AND copies_ok = 0) AS newest_rejected_none_valid,
  count(*) FILTER (reject_reason IS NOT NULL AND last_updated IS NULL AND copies_ok > 0) AS newest_has_no_timestamp_older_valid
FROM kr WHERE rnk = 1 AND copies > 1;
SELECT reject_reason, count(*) AS n FROM kr WHERE rnk = 1 AND copies > 1 AND reject_reason IS NOT NULL AND last_updated IS NOT NULL AND copies_ok > 0 GROUP BY ALL ORDER BY n DESC;
-- Copies without a readable timestamp, in groups that also have a valid copy: nobody can tell whether they were newer.
SELECT count(DISTINCT (sk, pk)) AS groups_with_an_untimestamped_copy FROM kr WHERE last_updated IS NULL AND copies > 1 AND copies_ok > 0;
-- Future-dated winners, and how dates outside the main window relate to duplicates.
SELECT count(*) FILTER (last_updated >= TIMESTAMPTZ '2026-10-11 00:00:00+00') AS future_rows_accepted,
  count(*) FILTER (last_updated >= TIMESTAMPTZ '2026-10-11 00:00:00+00' AND rnk = 1 AND copies > 1) AS future_winner_over_older_copy
FROM ok;
SELECT CASE WHEN last_updated >= TIMESTAMPTZ '2026-10-01 00:00:00+00' THEN 'after 2026-09-30'
            WHEN last_updated < TIMESTAMPTZ '2024-10-01 00:00:00+00' THEN 'before 2024-10-01' ELSE 'main window' END AS span,
  count(*) AS n, round(100.0 * count(*) FILTER (copies > 1) / count(*), 1) AS pct_in_duplicate_group
FROM ok GROUP BY ALL ORDER BY span;
-- Supplier display spelling under A13 (newest row) versus the most common spelling.
WITH w AS (SELECT DISTINCT sk, first_value(supplier_clean) OVER (PARTITION BY sk ORDER BY last_updated DESC, line DESC) AS newest FROM ok),
     m AS (SELECT sk, arg_max(supplier_clean, c) AS most_common FROM (SELECT sk, supplier_clean, count(*) AS c FROM ok GROUP BY ALL) GROUP BY sk)
SELECT newest AS a13_spelling, most_common FROM w JOIN m USING (sk) WHERE newest <> most_common ORDER BY sk;
SELECT count(*) FILTER (regexp_matches(part_number, '[a-z]')) AS parts_displayed_lowercase FROM parts;

.print '== 6. Distributions (accepted parts after deduplication, unless noted)'
SELECT 'rows in file' AS per_supplier, min(n), median(n), max(n) FROM (SELECT count(*) AS n FROM e GROUP BY nk(supplier))
UNION ALL SELECT 'parts', min(n), median(n), max(n) FROM (SELECT count(*) AS n FROM parts GROUP BY sk);
SELECT sk, count(*) AS parts FROM parts GROUP BY ALL ORDER BY parts DESC LIMIT 5;
SELECT nk(supplier) AS sk, count(*) AS rows_ FROM e GROUP BY ALL ORDER BY rows_ DESC LIMIT 5;
SELECT min(length(part_number)), median(length(part_number)), max(length(part_number)),
  min(length(pk)), median(length(pk)), max(length(pk)), count(DISTINCT shape(upper(part_number))) AS shapes FROM parts;
SELECT shape(upper(part_number)) AS shape, count(*) AS n, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct FROM parts GROUP BY ALL ORDER BY n DESC LIMIT 10;
SELECT 'quantity' AS col, quantile_disc(quantity, [0.01, 0.5, 0.99])::VARCHAR AS p1_p50_p99, max(quantity)::VARCHAR AS max_ FROM parts
UNION ALL SELECT 'price', quantile_disc(price_clean, [0.01, 0.5, 0.99])::VARCHAR, max(price_clean)::VARCHAR FROM parts
UNION ALL SELECT 'lead_time_days', quantile_disc(lead_time_days, [0.01, 0.5, 0.99])::VARCHAR, max(lead_time_days)::VARCHAR FROM parts;
SELECT count(*) FILTER (quantity = 0) AS zero_stock, round(100.0 * count(*) FILTER (quantity = 0) / count(*), 1) AS pct_zero_stock,
  count(*) FILTER (lead_time_days IS NULL) AS lead_missing, round(100.0 * count(*) FILTER (lead_time_days IS NULL) / count(*), 1) AS pct_lead_missing FROM parts;
SELECT lead_time_days, count(*) AS n FROM parts GROUP BY ALL ORDER BY lead_time_days NULLS LAST;
SELECT count(*) AS part_number_keys, count(*) FILTER (n > 1) AS carried_by_2plus_suppliers, max(n) AS max_suppliers FROM (SELECT pk, count(*) AS n FROM parts GROUP BY pk);

.print '== 4. Example lines: the first lines with each problem (line numbers only, no values)'
CREATE VIEW prob AS
            SELECT 'P2' AS id, line FROM d WHERE cp1252 = 1
  UNION ALL SELECT 'P3 empty line', line FROM d WHERE nfields = 0
  UNION ALL SELECT 'P3 seven commas', line FROM d WHERE is_empty AND nfields = 8
  UNION ALL SELECT 'P4 ' || nfields || ' fields', line FROM d WHERE nfields BETWEEN 1 AND 7
  UNION ALL SELECT 'P5 ' || nfields || ' fields', line FROM d WHERE nfields > 8
  UNION ALL SELECT 'P6', line FROM d WHERE is_header
  UNION ALL SELECT 'P7', line FROM e WHERE pn IS NULL
  UNION ALL SELECT 'P8', line FROM e WHERE pn <> trim(pn)
  UNION ALL SELECT 'P8 leading space', line FROM e WHERE pn LIKE ' %'
  UNION ALL SELECT 'P9', line FROM e WHERE regexp_matches(pn, '[a-z]')
  UNION ALL SELECT 'P10 upper', line FROM e WHERE supplier = upper(supplier)
  UNION ALL SELECT 'P10 lower', line FROM e WHERE supplier = lower(supplier)
  UNION ALL SELECT 'P10 padded', line FROM e WHERE supplier <> trim(supplier)
  UNION ALL SELECT 'P10 period', line FROM e WHERE supplier LIKE '%.'
  UNION ALL SELECT 'P10 double space', line FROM e WHERE trim(supplier) LIKE '%  %'
  UNION ALL SELECT 'P11 blank', line FROM e WHERE qty IS NULL
  UNION ALL SELECT 'P11 N/A', line FROM e WHERE qty = 'N/A'
  UNION ALL SELECT 'P12', line FROM e WHERE qty LIKE '%,%'
  UNION ALL SELECT 'P13', line FROM e WHERE qty LIKE '%.%'
  UNION ALL SELECT 'P14', line FROM e WHERE qty LIKE '-%'
  UNION ALL SELECT 'P15', line FROM e WHERE price IS NULL
  UNION ALL SELECT 'P16', line FROM e WHERE price = 'CALL'
  UNION ALL SELECT 'P17', line FROM e WHERE price LIKE '$%'
  UNION ALL SELECT 'P18', line FROM e WHERE price LIKE '% USD'
  UNION ALL SELECT 'P19', line FROM e WHERE price LIKE '%,%'
  UNION ALL SELECT 'P20', line FROM e WHERE regexp_matches(price, '\.[0-9]{4}')
  UNION ALL SELECT 'P21', line FROM e WHERE price <> trim(price)
  UNION ALL SELECT 'P22', line FROM e WHERE regexp_matches(price, '^[0-9]+(\.[0-9])?$')
  UNION ALL SELECT 'P23', line FROM e WHERE price LIKE '-%'
  UNION ALL SELECT 'P24 blank', line FROM e WHERE lead IS NULL
  UNION ALL SELECT 'P24 TBD', line FROM e WHERE lead = 'TBD'
  UNION ALL SELECT 'P25', line FROM e WHERE lead = 'STOCK'
  UNION ALL SELECT 'P26 ' || regexp_replace(lead, '[0-9]+', 'N', 'g'), line FROM e WHERE regexp_matches(lead, '^[0-9]+ ?[A-Za-z]+$')
  UNION ALL SELECT 'P27', line FROM e WHERE updated IS NULL
  UNION ALL SELECT 'P28 ' || shape(updated), line FROM e WHERE updated IS NOT NULL
  UNION ALL SELECT 'P29', line FROM clean WHERE last_updated >= TIMESTAMPTZ '2026-10-11 00:00:00+00'
  UNION ALL SELECT 'P30 ' || shape(nsn), line FROM e WHERE nsn IS NOT NULL;
SELECT id, list(line ORDER BY line)[1:3] AS first_lines FROM prob GROUP BY id ORDER BY id;
-- P31: the first groups (by first line) whose part numbers differ in punctuation, with each copy's line.
SELECT list(line ORDER BY line) AS lines, list(part_number ORDER BY line) AS part_numbers
FROM kr JOIN (SELECT sk, pk FROM gx WHERE punct_differs) USING (sk, pk) GROUP BY sk, pk ORDER BY min(line) LIMIT 3;
-- P32: the first groups (by newest line) whose newest copy is rejected while an older one is valid.
SELECT list(line ORDER BY rnk) AS lines_newest_first, list(coalesce(reject_reason, 'valid') ORDER BY rnk) AS outcome
FROM kr WHERE (sk, pk) IN (SELECT (sk, pk) FROM kr WHERE rnk = 1 AND copies > 1 AND reject_reason IS NOT NULL AND last_updated IS NOT NULL AND copies_ok > 0)
GROUP BY sk, pk ORDER BY min(line) FILTER (rnk = 1) LIMIT 3;
-- P29: the first future-dated winners, with the older copy each one beats.
SELECT list(line ORDER BY rnk) AS lines_newest_first FROM ok
WHERE (sk, pk) IN (SELECT (sk, pk) FROM ok WHERE rnk = 1 AND copies > 1 AND last_updated >= TIMESTAMPTZ '2026-10-11 00:00:00+00')
GROUP BY sk, pk ORDER BY min(line) FILTER (rnk = 1) LIMIT 3;
```
