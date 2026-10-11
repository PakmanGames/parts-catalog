"use client";

import { useId } from "react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { SuppliersResponse } from "@/contracts/suppliers";
import type { ApiData } from "@/hooks/use-api-data";

/** Picks any number of suppliers to filter the parts by (PRD R2.4, A10). None means all of them. */
export function SupplierFilter({
  suppliers,
  value,
  onValueChange,
}: {
  suppliers: ApiData<SuppliersResponse>;
  value: string[];
  onValueChange: (value: string[]) => void;
}) {
  const id = useId();
  const anchor = useComboboxAnchor();
  const items =
    suppliers.status === "ready"
      ? suppliers.data.items
      : suppliers.status === "loading"
        ? (suppliers.previous?.items ?? [])
        : [];
  const placeholder =
    suppliers.status === "error"
      ? "Couldn't load suppliers"
      : value.length > 0
        ? ""
        : "All suppliers";

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="sr-only">
        Suppliers
      </Label>
      <Combobox
        multiple
        autoHighlight
        items={items}
        value={value}
        onValueChange={(next, details) => {
          // Base UI clears every chip on Escape once the list is closed. For a filter the buyer
          // built up chip by chip, that is too easy to hit by accident, so Escape only closes.
          if (details.reason !== "escape-key") {
            onValueChange(next);
          }
        }}
      >
        <ComboboxChips ref={anchor} className="w-full">
          <ComboboxValue>
            {(selected: string[]) => (
              <>
                {selected.map((supplier) => (
                  <ComboboxChip key={supplier} className="max-w-full">
                    <span className="truncate">{supplier}</span>
                  </ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={id}
                  placeholder={placeholder}
                  disabled={suppliers.status === "error"}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>
            {suppliers.status === "loading" ? "Loading suppliers…" : "No suppliers match."}
          </ComboboxEmpty>
          <ComboboxList>
            {(supplier: string) => (
              <ComboboxItem key={supplier} value={supplier}>
                <span className="truncate">{supplier}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
