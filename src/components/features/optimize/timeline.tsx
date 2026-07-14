"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Loader2,
  PauseCircle,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export type TimelineEntry = {
  id: string;
  action: string;
  reason: string;
  status: string;
  error: string | null;
  clientName: string;
  createdAt: string;
};

const ICONS: Record<string, typeof PauseCircle> = {
  PAUSE_AD: PauseCircle,
  RAISE_BUDGET: ArrowUpRight,
  LOWER_BUDGET: ArrowDownRight,
  QUEUE_CREATIVE: Sparkles,
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  APPLIED: "default",
  PENDING: "outline",
  FAILED: "destructive",
  REVERTED: "secondary",
  SKIPPED: "secondary",
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const router = useRouter();

  const act = useMutation({
    mutationFn: (input: { logId: string; decision: "approve" | "reject" | "revert" }) =>
      postJson("/api/optimize/action", input),
    onSuccess: (_data, input) => {
      toast.success(
        input.decision === "approve"
          ? "Applied to Meta."
          : input.decision === "revert"
            ? "Reverted."
            : "Dismissed.",
      );
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="text-muted-foreground py-8 text-sm text-pretty">
          Nothing yet. Once a campaign is live and auto-pilot is on, every decision the
          optimiser makes shows up here with the numbers behind it.
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => {
        const Icon = ICONS[entry.action] ?? Sparkles;
        const pending = entry.status === "PENDING";
        const busy = act.isPending && act.variables?.logId === entry.id;

        return (
          <li key={entry.id}>
            <Card>
              <CardContent className="flex flex-wrap items-start gap-4 py-4">
                <Icon
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    entry.action === "RAISE_BUDGET" && "text-primary",
                    entry.action === "PAUSE_AD" && "text-muted-foreground",
                    entry.status === "FAILED" && "text-destructive",
                  )}
                  aria-hidden
                />

                <div className="min-w-56 flex-1 space-y-1">
                  <p className="text-sm text-pretty">{entry.reason}</p>
                  <p className="text-muted-foreground text-xs">
                    {entry.clientName} ·{" "}
                    {new Date(entry.createdAt).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  {entry.error && (
                    <p className="text-destructive text-xs text-pretty">{entry.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[entry.status] ?? "secondary"}>
                    {entry.status}
                  </Badge>

                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}

                  {pending && !busy && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => act.mutate({ logId: entry.id, decision: "approve" })}
                      >
                        <Check className="size-4" />
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act.mutate({ logId: entry.id, decision: "reject" })}
                      >
                        <X className="size-4" />
                        Dismiss
                      </Button>
                    </>
                  )}

                  {entry.status === "APPLIED" && !busy && entry.action !== "QUEUE_CREATIVE" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act.mutate({ logId: entry.id, decision: "revert" })}
                    >
                      <Undo2 className="size-4" />
                      Undo
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
