"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Every AI output on the review screen is editable — the model drafts, the user
 * decides. Character counts turn red past the limit rather than blocking typing,
 * because Meta truncates rather than rejects.
 */
export function EditableList({
  items,
  onChange,
  multiline = false,
  maxChars,
  label,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  multiline?: boolean;
  maxChars?: number;
  label: string;
}) {
  const update = (index: number, value: string) =>
    onChange(items.map((item, i) => (i === index ? value : item)));

  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <ul className="space-y-3">
      {items.map((item, index) => {
        const tooLong = maxChars !== undefined && item.length > maxChars;

        return (
          <li key={index} className="flex items-start gap-2">
            <span className="text-muted-foreground w-5 shrink-0 pt-2.5 text-right text-xs tabular-nums">
              {index + 1}
            </span>

            <div className="flex-1 space-y-1">
              {multiline ? (
                <Textarea
                  value={item}
                  rows={3}
                  aria-label={`${label} ${index + 1}`}
                  onChange={(e) => update(index, e.target.value)}
                />
              ) : (
                <Input
                  value={item}
                  aria-label={`${label} ${index + 1}`}
                  onChange={(e) => update(index, e.target.value)}
                />
              )}
              {maxChars !== undefined && (
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    tooLong ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {item.length}/{maxChars}
                  {tooLong && " — Meta will truncate this"}
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label} ${index + 1}`}
              onClick={() => remove(index)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
