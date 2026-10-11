# Import fixtures

Two small exports packed with the traps from [`docs/data-profile.md`](../../../docs/data-profile.md), for WS-A's tests (PRD T0.3).
They follow the profile's normalizer steps (section 4.2) and the T0.3 decisions recorded in PRD section 8: A13 (most common supplier spelling, upper-case part numbers), A17 (a rejected newest row makes its part absent), A18 (future dates are accepted), and A19 (unknown quantity and price are `NULL`).

Like the real export, both files start with a byte-order mark, end every line with CRLF, and contain a Windows-1252 byte.
`.gitattributes` marks them `-text`, so Git never rewrites their line endings.
Edit them with a tool that preserves bytes, and update this README and `expected.json` with them.

## The import sequence

`expected.json` lists five imports into an empty database, in order, with the summary and the full `parts` table after each:

| Step | File | What it proves |
| ---: | --- | --- |
| 1 | `night-1.csv` | Every normalize and reject rule, deduplication, and supplier spelling. |
| 2 | `night-1.csv` | Re-importing the same file changes nothing (R1.4). |
| 3 | `night-2.csv` | Parts are dropped, changed, and added, and spelling variants match existing parts. |
| 4 | `night-2.csv` | Re-importing changes nothing, including when parts were marked unavailable. |
| 5 | `night-1.csv` | Dropped parts come back (A15), and an older file overwrites newer data (A2). |

In `expected.json`:

- `summary` leaves out `durationMs`, which varies.
- `parts` is sorted by `supplierKey`, then `partNumberKey`, and prices are formatted the way Postgres returns `numeric(12, 2)`.
- `unavailableSinceStep` is `null` for an available part, or the step whose import marked it unavailable.
  The part's `unavailable_since` should equal the time that step ran, which is how a test checks that steps 4 and 5 don't move it.

Supplier keys in the tables below are shortened, for example `ALLIED` for `ALLIEDFASTENERSUPPLY`.

## `night-1.csv`

Line 1 is the header, after the byte-order mark (P1).

| Line | Part | Trap | Outcome |
| ---: | --- | --- | --- |
| 2 | ALLIED `MS21045L176` | A clean row | Wins |
| 3 | ALLIED `AN960C10L` | Padded, lower-case part number (P8, P9); upper-case supplier (P10); quantity `1,131` (P12); price `$9.15` (P17); `2 wks` (P26); ISO date-time (P28) | Wins: newest copy, though earlier in the file than line 33 (C3) |
| 4 | ANCHOR `6036-2327-65` | Quantity `46.0` (P13); price ` 64.7300 ` (P20, P21); `STOCK` (P25); US date (P28) | Wins |
| 5 | APEX `NAS1149500R` | No dash; the same part as line 32 under C10 (P31, OQ1) | Loses to line 32 |
| 6 | | Empty line (P3) | Rejected: `row is empty` |
| 7 | APEX `81H37815-5` | Lower-case part number (P9); quantity 0 is real; price `"$1,604.20"` (P19); `12 weeks` (P26) | Wins |
| 8 | BAY `RNC55H9852FM` | `N/A`, `CALL`, `TBD` | Wins, with quantity, price, and lead time `NULL` (A19, P24) |
| 9 | BAY `JANTX2N5921` | Blank quantity, price, and lead time; padded supplier (P10) | Wins, all three `NULL` |
| 10 | BLUE RIDGE `D38999/24JG62SC` | 10 fields: unquoted commas in Description (P5); price `215` (P22); `90 days` | Wins, after the long-row repair |
| 11 | BLUE RIDGE `M83248/2-390` | Description has byte `D8`, which isn't UTF-8 (P2); price `"$5,356.66"`; `45 DAYS` | Wins; decoding as Windows-1252 must not abort |
| 12 | BRIDGEWATER `UN16492` | Price `0.4` (P22); `3 WKS` | Ties with line 36, an identical line (A4) |
| 13 | BRIDGEWATER `NAS1611-023R` | A valid older copy | Loses to line 34 |
| 14 | CASCADE `AN6C35` | Dated 2027-01-20, after the file was made (P29) | Wins (A18) |
| 15 | | Seven commas (P3) | Rejected: `row is empty` |
| 16 | | Three fields (P4) | Rejected: `row has too few columns` |
| 17 | COASTAL `MS28775-218` | The part's only row, with price `-23.55` (P23) | Rejected: `price is negative`; the part is absent (A17) |
| 18 | | The header again (P6) | Rejected: `row is a repeated header` |
| 19 | | Blank part number (P7) | Rejected: `part number is missing` |
| 20 | | Part number `--/--` | Rejected: `part number has no letters or digits` |
| 21 | | Blank supplier | Rejected: `supplier is missing` |
| 22 | | Supplier `...` | Rejected: `supplier has no letters or digits` |
| 23 | ALLIED `MS21045L176` | Older copy with price `12.3.4` | Rejected: `price is not a number`; older than line 2, so the part is unaffected |
| 24 | ANCHOR `6036-2327-65` | Older copy with quantity `12.5` | Rejected: `quantity is not a whole number`; part unaffected |
| 25 | APEX `81H37815-5` | Older copy with price `1.2345` | Rejected: `price has more than 2 decimal places`; part unaffected |
| 26 | BLUE RIDGE `D38999/24JG62SC` | Older copy with lead time `2 months` | Rejected: `lead time is not a number of days or weeks`; part unaffected |
| 27 | BLUE RIDGE `M83248/2-390` | Older copy with quantity `2147483648` | Rejected: `quantity is too large`; part unaffected |
| 28 | BRIDGEWATER `UN16492` | Older copy with price `99999999999.00` | Rejected: `price is too large`; part unaffected |
| 29 | BAY `RNC55H9852FM` | Older copy with lead time `2147483648` | Rejected: `lead time is too large`; part unaffected |
| 30 | | Blank Last Updated (P27) | Rejected: `last updated is missing` |
| 31 | | `02/30/2025` | Rejected: `last updated is not a valid date` |
| 32 | APEX `NAS1149-500R` | Dash variant of line 5 (P31); lower-case supplier; `3.61 USD` (P18); `7d` | Wins: newest copy, later in the file |
| 33 | ALLIED `AN960C10L` | Older copy; supplier with a doubled space (P10) | Loses to line 3 |
| 34 | BRIDGEWATER `NAS1611-023R` | Newest copy, quantity `-6` (P14, P32) | Rejected: `quantity is negative`; the part is absent, so line 13 doesn't win either (A17) |
| 35 | CASCADE `AN6C35` | Older copy; supplier with a trailing period (P10) | Loses to line 14 |
| 36 | BRIDGEWATER `UN16492` | Byte-identical to line 12 | Wins the A4 tie as the later line |

**Supplier spellings (A13).**
Allied is written `Allied Fastener Supply` on lines 2 and 33, after collapsing the doubled space, and upper case on line 3, so the clean spelling wins even though line 3 is the newest.
Apex is clean twice and lower case once.
Cascade is a tie, one row each with and without the period, which the newest row breaks: line 14, without the period.

## `night-2.csv`

| Line | Part | Trap | Outcome in step 3 |
| ---: | --- | --- | --- |
| 2 | ALLIED `MS21045L176` | Same as night 1 | Unchanged |
| 3 | ALLIED `AN960C10L` | Lower-case part number and supplier; new quantity | Updated |
| 4 | APEX `NAS1149500R` | Same values as night 1, written without the dash | Updated: the displayed part number changes |
| 5 | APEX `81H37815-5` | Upper-case supplier; `84` instead of `12 weeks`; US date for the same day | Unchanged: Apex's display spelling is still `Apex Machined Parts`, from line 4, which breaks the tie as the newest row |
| 6 | BAY `RNC55H9852FM` | Quantity, price, and lead time now known | Updated |
| 7 | BAY `JANTX2N5921` | `N/A`, `CALL`, `TBD` instead of blanks; US date for the same day | Unchanged |
| 8 | BLUE RIDGE `M83248/2-390` | Valid copy, the same as night 1 | Loses to line 17 |
| 9 | BRIDGEWATER `UN16492` | `0.40` and `21` instead of `0.4` and `3 WKS` | Unchanged |
| 10 | BRIDGEWATER `NAS1611-023R` | A valid row for the part night 1 skipped | Inserted |
| 11 | CASCADE `AN6C35` | Dated 2026-10-04, older than the stored 2027-01-20 | Updated: the latest import wins (A2) |
| 12 | COASTAL `MS28775-218` | A valid row for the part night 1 skipped | Inserted |
| 13 to 15 | CONTINENTAL `AN6289-4`, `-6`, `-8` | New parts; line 14's supplier has a trailing period | Inserted, all under `Continental Hose Co`; `1 wk` is 7 days |
| 16 | | Seven commas | Rejected: `row is empty` |
| 17 | BLUE RIDGE `M83248/2-390` | Newest copy, price `-5356.66` | Rejected: `price is negative`; the part is absent, so it is marked unavailable (A17) |
| 18 | ALLIED `AN960C10L` | Older copy | Loses to line 3 |

ANCHOR `6036-2327-65` and BLUE RIDGE `D38999/24JG62SC` aren't in the file, so step 3 marks them unavailable, along with `M83248/2-390`.

## Step 5: `night-1.csv` again

The three parts marked unavailable in step 3 are back, so they are made available again with their night 1 values.
`AN960C10L`, `NAS1149-500R`, `RNC55H9852FM`, and `AN6C35` go back to their night 1 values, even where those are older (A2).
The parts night 1 doesn't have, or whose newest row it rejects, are marked unavailable: `NAS1611-023R`, `MS28775-218`, and the three Continental parts.
