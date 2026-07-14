"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Play, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { postJson } from "@/lib/api";
import { paiseToRupees } from "@/lib/money";

export function AutopilotCard({
  clientId,
  clientName,
  autopilot,
  requireApproval,
  maxDailyBudget,
  activeCampaigns,
}: {
  clientId: string;
  clientName: string;
  autopilot: boolean;
  requireApproval: boolean;
  maxDailyBudget: number | null;
  activeCampaigns: number;
}) {
  const router = useRouter();

  const [pilot, setPilot] = useState(autopilot);
  const [approval, setApproval] = useState(requireApproval);
  const [cap, setCap] = useState(
    maxDailyBudget === null ? "" : String(paiseToRupees(maxDailyBudget)),
  );

  const save = useMutation({
    mutationFn: (next: { autopilot: boolean; requireApproval: boolean }) =>
      postJson("/api/optimize/settings", {
        clientId,
        autopilot: next.autopilot,
        requireApproval: next.requireApproval,
        maxDailyBudgetRupees: cap.trim() === "" ? null : Number(cap),
      }),
    onSuccess: () => {
      toast.success("Saved.");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const run = useMutation({
    mutationFn: () =>
      postJson<{ message: string }>("/api/optimize/run", { clientId }),
    onSuccess: (data) => {
      toast.success(data.message);
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const uncapped = pilot && cap.trim() === "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{clientName}</CardTitle>
        <CardDescription>
          {activeCampaigns > 0
            ? `${activeCampaigns} live campaign${activeCampaigns === 1 ? "" : "s"}.`
            : "No live campaigns — the optimiser has nothing to act on."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor={`pilot-${clientId}`}>Auto-pilot</Label>
            <p className="text-muted-foreground text-sm text-pretty">
              When off, the optimiser does nothing at all — it won&apos;t even suggest.
            </p>
          </div>
          <Switch
            id={`pilot-${clientId}`}
            checked={pilot}
            onCheckedChange={(checked) => {
              setPilot(checked);
              save.mutate({ autopilot: checked, requireApproval: approval });
            }}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor={`approval-${clientId}`}>Ask me first</Label>
            <p className="text-muted-foreground text-sm text-pretty">
              Decisions wait in the timeline for your approval instead of being applied
              straight to Meta.
            </p>
          </div>
          <Switch
            id={`approval-${clientId}`}
            checked={approval}
            disabled={!pilot}
            onCheckedChange={(checked) => {
              setApproval(checked);
              save.mutate({ autopilot: pilot, requireApproval: checked });
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`cap-${clientId}`}>Daily spend ceiling (₹)</Label>
          <div className="flex gap-2">
            <Input
              id={`cap-${clientId}`}
              type="number"
              min={0}
              value={cap}
              placeholder="No cap"
              onChange={(event) => setCap(event.target.value)}
              onBlur={() => save.mutate({ autopilot: pilot, requireApproval: approval })}
            />
            <Button
              variant="outline"
              disabled={run.isPending || activeCampaigns === 0}
              onClick={() => run.mutate()}
            >
              {run.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run now
            </Button>
          </div>
          <p className="text-muted-foreground text-xs text-pretty">
            The optimiser will never raise budgets past this total, whatever the rules say.
          </p>
        </div>

        {uncapped && (
          <p className="flex items-start gap-2 text-sm text-amber-600 text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Auto-pilot is on with no spend ceiling. Budgets can rise by up to 20% a day
            with nothing to stop them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
