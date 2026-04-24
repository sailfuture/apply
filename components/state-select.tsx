"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/us-states";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Props {
  /** Current state value (two-letter code, matches `US_STATES[].value`). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** When true, the trigger gets a red border (form validation). */
  invalid?: boolean;
  disabled?: boolean;
  /** Optional id for label association. */
  id?: string;
}

/**
 * Standard shadcn searchable-select pattern: `Popover` + `Command`. Replaces
 * the custom `Combobox` wrapper that had broken keyboard behavior.
 *
 * Usage:
 *   <StateSelect value={state} onChange={setState} invalid={!state} />
 */
export function StateSelect({
  value,
  onChange,
  placeholder = "Select state…",
  invalid = false,
  disabled = false,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = US_STATES.find((s) => s.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between bg-white font-normal",
            !selected && "text-muted-foreground",
            // Match the other inputs on this form: plain red border, no halo ring.
            invalid && "border-red-400"
          )}
        >
          {selected ? selected.label : placeholder}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search state…" />
          <CommandList>
            <CommandEmpty>No state found.</CommandEmpty>
            <CommandGroup>
              {US_STATES.map((s) => (
                <CommandItem
                  key={s.value}
                  value={`${s.label} ${s.value}`}
                  onSelect={() => {
                    onChange(s.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === s.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {s.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
