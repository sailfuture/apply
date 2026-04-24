"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface OptionSelectItem {
  value: string;
  label: string;
}

interface Props {
  /** Options to render in the dropdown. */
  options: OptionSelectItem[];
  /** Current selected value. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Red border for form validation. */
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Generic single-select built on the shadcn Popover + Command pattern.
 *
 * Use this instead of Radix `<Select>` when the trigger sits inside a scrollable
 * container — Radix Select locks body scroll on open, which causes layout
 * jank (the whole page shifts by the scrollbar width). Popover doesn't.
 */
export function OptionSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  invalid = false,
  disabled = false,
  className,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

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
            // Match the other inputs: plain red border, no halo ring.
            invalid && "border-red-400",
            className
          )}
        >
          {selected ? selected.label : placeholder}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === o.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
