"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export const STEPS = ["Website", "Analysis", "Copy", "Creatives", "Review"] as const;
export type StepName = (typeof STEPS)[number];

export function Stepper({ current }: { current: StepName }) {
  const currentIndex = STEPS.indexOf(current);

  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-3">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                done && "bg-primary text-primary-foreground",
                active && "border-primary text-primary border-2",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                active ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {step}
            </span>
            {index < STEPS.length - 1 && (
              <span className="bg-border mx-1 hidden h-px w-6 sm:block" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
