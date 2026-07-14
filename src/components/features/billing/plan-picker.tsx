"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { postJson } from "@/lib/api";
import { PLANS, PLAN_SPECS, type Plan } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

export function PlanPicker({
  current,
  status,
  configured,
  periodEnd,
}: {
  current: Plan;
  status: string;
  configured: boolean;
  periodEnd: string | null;
}) {
  const subscribe = useMutation({
    mutationFn: (plan: Plan) =>
      postJson<{ checkoutUrl: string }>("/api/billing/subscribe", { plan }),
    onSuccess: (data) => {
      // Razorpay's hosted page. We never touch card details ourselves.
      window.location.href = data.checkoutUrl;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      {!configured && (
        <Card className="mb-4 border-dashed">
          <CardContent className="text-muted-foreground py-4 text-sm text-pretty">
            Billing isn&apos;t configured. Add <code>RAZORPAY_KEY_ID</code>,{" "}
            <code>RAZORPAY_KEY_SECRET</code>, and the <code>RAZORPAY_PLAN_*</code> ids to{" "}
            <code>.env</code>. Until then everyone stays on the Free plan.
          </CardContent>
        </Card>
      )}

      {status !== "active" && current === "FREE" && status !== "created" && (
        <Card className="border-destructive/50 bg-destructive/5 mb-4">
          <CardContent className="py-4 text-sm text-pretty">
            Your subscription is <strong>{status}</strong>, so you&apos;re on Free limits.
            Your data is untouched — resubscribe to restore your plan.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const spec = PLAN_SPECS[plan];
          const active = plan === current;

          return (
            <Card key={plan} className={cn(active && "border-primary")}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{spec.name}</CardTitle>
                  {active && <Badge>Current</Badge>}
                </div>
                <CardDescription>{spec.blurb}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <p className="text-2xl font-semibold">
                  {spec.price === 0 ? "Free" : `₹${spec.price.toLocaleString("en-IN")}`}
                  {spec.price > 0 && (
                    <span className="text-muted-foreground text-sm font-normal">/mo</span>
                  )}
                </p>

                <ul className="space-y-1.5 text-sm">
                  <Feature>
                    {spec.maxClients === null ? "Unlimited" : spec.maxClients} client
                    {spec.maxClients === 1 ? "" : "s"}
                  </Feature>
                  <Feature>
                    {spec.maxCampaigns === null ? "Unlimited" : spec.maxCampaigns} campaigns
                  </Feature>
                  <Feature muted={!spec.autopilot}>Auto-pilot optimisation</Feature>
                  <Feature muted={!spec.whiteLabel}>White-label reports</Feature>
                </ul>

                {plan !== "FREE" && !active && (
                  <Button
                    className="w-full"
                    disabled={!configured || subscribe.isPending}
                    onClick={() => subscribe.mutate(plan)}
                  >
                    {subscribe.isPending && subscribe.variables === plan && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    Choose {spec.name}
                  </Button>
                )}

                {active && periodEnd && (
                  <p className="text-muted-foreground text-xs">
                    Renews {new Date(periodEnd).toLocaleDateString("en-IN")}.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Feature({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2",
        muted && "text-muted-foreground line-through",
      )}
    >
      <Check className={cn("size-4 shrink-0", muted ? "opacity-40" : "text-primary")} />
      {children}
    </li>
  );
}
