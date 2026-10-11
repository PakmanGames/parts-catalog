import { useSyncExternalStore } from "react";
import { z } from "zod";
import { Part } from "@/contracts/parts";

/**
 * The parts selected for a quote (PRD R3.1, A5), in the order they were selected and unique by id.
 *
 * Each entry keeps the part's data from the page it was selected on, so the quote form can prefill
 * prices and warn about stock without fetching the parts again (7.5). The store lives outside
 * React, so it survives paging, new searches, and moving to the quote form, and it is copied to
 * `sessionStorage`, so it also survives reloading the tab.
 */
const STORAGE_KEY = "parts-catalog.selection";
const EMPTY: readonly Part[] = [];
const listeners = new Set<() => void>();
let selected: readonly Part[] | undefined;

function read(): readonly Part[] {
  if (selected === undefined) {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      // Checked against the contract, so data saved by an older version of the app can't break a page.
      const parsed = z.array(Part).safeParse(stored === null ? [] : JSON.parse(stored));
      selected = parsed.success ? parsed.data : EMPTY;
    } catch {
      selected = EMPTY;
    }
  }
  return selected;
}

function write(next: readonly Part[]): void {
  selected = next;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked. The selection still works until the tab reloads.
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Adds a part to the selection, unless it is already there. */
export function selectPart(part: Part): void {
  if (!read().some((entry) => entry.id === part.id)) {
    write([...read(), part]);
  }
}

export function deselectPart(id: number): void {
  write(read().filter((entry) => entry.id !== id));
}

export function clearSelection(): void {
  write(EMPTY);
}

/**
 * The selected parts, or `null` during the server render and hydration, which can't see
 * `sessionStorage`. React re-renders with the stored selection right after, so the markup never
 * mismatches, and a page can tell "not known yet" apart from "nothing selected".
 */
export function useSelection(): readonly Part[] | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
