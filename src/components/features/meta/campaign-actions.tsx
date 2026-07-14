"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { postJson } from "@/lib/api";
import { formatRupees } from "@/lib/money";

export function CampaignActions({
  campaignId,
  status,
  dailyBudget,
}: {
  campaignId: string;
  status: string;
  dailyBudget: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const setStatus = useMutation({
    mutationFn: (next: "ACTIVE" | "PAUSED") =>
      postJson<{ status: string }>("/api/meta/activate", {
        campaignId,
        status: next,
        // Echoing the budget back is what proves the user saw the real number.
        ...(next === "ACTIVE" ? { confirmDailyBudget: dailyBudget } : {}),
      }),
    onSuccess: (data) => {
      toast.success(data.status === "ACTIVE" ? "Campaign is live." : "Campaign paused.");
      setConfirming(false);
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (status === "ACTIVE") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={setStatus.isPending}
        onClick={() => setStatus.mutate("PAUSED")}
      >
        {setStatus.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Pause className="size-4" />
        )}
        Pause
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setConfirming(true)}>
        <Play className="size-4" />
        Activate
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start spending?</DialogTitle>
            <DialogDescription className="text-pretty">
              This campaign will go live and spend up to{" "}
              <strong>{formatRupees(dailyBudget)} per day</strong> until you pause it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate("ACTIVE")}
            >
              {setStatus.isPending && <Loader2 className="size-4 animate-spin" />}
              Yes, go live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
