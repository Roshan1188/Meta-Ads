"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  Rocket,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatRupees } from "@/lib/money";

type PublishEvent =
  | { type: "step"; key: string; label: string; status: "running" | "done" }
  | { type: "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; campaignId: string; metaCampaignId: string; adCount: number };

type Step = { key: string; label: string; status: "running" | "done" };

export function PublishDialog({
  jobId,
  clientName,
  dailyBudget,
}: {
  jobId: string;
  clientName: string;
  dailyBudget: number;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Extract<PublishEvent, { type: "done" }>>();

  function apply(event: PublishEvent) {
    switch (event.type) {
      case "step":
        setSteps((prev) => {
          const existing = prev.findIndex((step) => step.key === event.key);
          const next: Step = { key: event.key, label: event.label, status: event.status };
          if (existing === -1) return [...prev, next];
          return prev.map((step, i) => (i === existing ? next : step));
        });
        break;
      case "warn":
        setWarnings((prev) => [...prev, event.message]);
        break;
      case "error":
        setError(event.message);
        break;
      case "done":
        setDone(event);
        break;
    }
  }

  /**
   * The server streams NDJSON so each step lands as it finishes. Chunks don't
   * respect line boundaries, so hold the trailing partial line until the next read.
   */
  async function publish() {
    setRunning(true);
    setSteps([]);
    setWarnings([]);
    setError(undefined);
    setDone(undefined);

    try {
      const res = await fetch("/api/meta/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });

      if (!res.body) throw new Error("The server sent no publish log.");

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;

        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) apply(JSON.parse(line) as PublishEvent);
        }
      }

      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publishing failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-publish would leave campaigns half-created with no visible log.
        if (running) return;
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Rocket className="size-4" />
          Publish
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish to Meta</DialogTitle>
          <DialogDescription className="text-pretty">
            Creates the campaign, ad sets, and ads for {clientName} at{" "}
            {formatRupees(dailyBudget)}/day. Everything is created{" "}
            <strong>paused</strong> — nothing spends until you activate it.
          </DialogDescription>
        </DialogHeader>

        {steps.length > 0 && (
          <ul className="space-y-2 text-sm">
            {steps.map((step) => (
              <li key={step.key} className="flex items-center gap-2">
                {step.status === "done" ? (
                  <CheckCircle2 className="text-primary size-4 shrink-0" aria-hidden />
                ) : (
                  <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />
                )}
                <span
                  className={step.status === "done" ? "" : "text-muted-foreground"}
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        )}

        {warnings.map((warning) => (
          <p
            key={warning}
            className="flex items-start gap-2 text-sm text-amber-600 text-pretty"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}

        {error && (
          <p className="text-destructive flex items-start gap-2 text-sm text-pretty">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {done && (
          <p className="flex items-start gap-2 text-sm text-pretty">
            <CheckCircle2 className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            Created {done.adCount} ads in Meta Ads Manager, all paused. Campaign ID{" "}
            <code className="text-xs">{done.metaCampaignId}</code>.
          </p>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={() => setOpen(false)}>Close</Button>
          ) : (
            <Button onClick={publish} disabled={running}>
              {running && <Loader2 className="size-4 animate-spin" />}
              {running ? "Publishing…" : error ? "Try again" : "Create campaign"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
