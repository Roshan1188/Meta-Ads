"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson } from "@/lib/api";
import type { MetaOptions } from "@/server/meta";

type Connection = {
  adAccountId: string | null;
  pageId: string | null;
  pixelId: string | null;
  igAccountId: string | null;
  expiresAt: string | null;
};

const CALLBACK_ERRORS: Record<string, string> = {
  cancelled: "You cancelled the Facebook connection.",
  state_mismatch: "That sign-in link expired. Try connecting again.",
  exchange_failed: "Facebook rejected the connection. Try again.",
  not_configured: "Meta isn't configured. Add META_APP_ID and META_APP_SECRET to .env.",
};

const NO_PIXEL = "__none__";

export function MetaConnect({
  configured,
  connection,
  options,
  loadError,
  callbackError,
  justConnected,
}: {
  configured: boolean;
  connection: Connection | null | undefined;
  options: MetaOptions | null;
  loadError: string | null;
  callbackError: string | null;
  justConnected: boolean;
}) {
  const router = useRouter();

  const [adAccountId, setAdAccountId] = useState(connection?.adAccountId ?? "");
  const [pageId, setPageId] = useState(connection?.pageId ?? "");
  const [pixelId, setPixelId] = useState(connection?.pixelId ?? NO_PIXEL);

  useEffect(() => {
    if (callbackError) toast.error(CALLBACK_ERRORS[callbackError] ?? "Connection failed.");
    else if (justConnected) toast.success("Facebook connected.");
  }, [callbackError, justConnected]);

  const save = useMutation({
    mutationFn: () =>
      postJson<{ instagramConnected: boolean }>("/api/meta/selections", {
        adAccountId,
        pageId,
        pixelId: pixelId === NO_PIXEL ? null : pixelId,
      }),
    onSuccess: (data) => {
      toast.success(
        data.instagramConnected
          ? "Saved. Instagram is linked to that Page, so ads run on both."
          : "Saved. No Instagram account is linked to that Page — ads will run on Facebook only.",
      );
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!configured) {
    return (
      <Card className="max-w-2xl border-dashed">
        <CardHeader>
          <CardTitle>Meta isn&apos;t configured</CardTitle>
          <CardDescription>
            Create an app at developers.facebook.com, then add{" "}
            <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, and{" "}
            <code>META_REDIRECT_URI</code> to <code>.env</code> and restart.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!connection) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Connect Facebook</CardTitle>
          <CardDescription>
            We ask for ads and Page permissions so campaigns can be created on your behalf.
            Nothing is published without you clicking Publish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/meta/connect">Connect Facebook</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const expired = connection.expiresAt && new Date(connection.expiresAt) < new Date();

  return (
    <div className="grid max-w-2xl gap-4">
      {(loadError || expired) && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-2">
              <p className="text-pretty">
                {loadError ?? "Your Facebook connection has expired."}
              </p>
              <Button asChild size="sm" variant="outline">
                <a href="/api/meta/connect">Reconnect Facebook</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Facebook</CardTitle>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="size-3" aria-hidden />
              Connected
            </Badge>
          </div>
          <CardDescription>
            {connection.expiresAt
              ? `Token valid until ${new Date(connection.expiresAt).toLocaleDateString()}. Reconnect after that.`
              : "Token has no stated expiry."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="adaccount">Ad account</Label>
            <Select value={adAccountId} onValueChange={setAdAccountId}>
              <SelectTrigger id="adaccount" className="w-full">
                <SelectValue placeholder="Choose an ad account" />
              </SelectTrigger>
              <SelectContent>
                {options?.adAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                    {account.account_status !== 1 && " · inactive"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="page">Facebook Page</Label>
            <Select value={pageId} onValueChange={setPageId}>
              <SelectTrigger id="page" className="w-full">
                <SelectValue placeholder="Choose a Page" />
              </SelectTrigger>
              <SelectContent>
                {options?.pages.map((page) => (
                  <SelectItem key={page.id} value={page.id}>
                    {page.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs text-pretty">
              Ads run from this Page. Instagram is picked up automatically from whatever
              account is linked to it.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pixel">Pixel</Label>
            <Select value={pixelId} onValueChange={setPixelId}>
              <SelectTrigger id="pixel" className="w-full">
                <SelectValue placeholder="No pixel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PIXEL}>No pixel</SelectItem>
                {options?.pixels.map((pixel) => (
                  <SelectItem key={pixel.id} value={pixel.id}>
                    {pixel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs text-pretty">
              Required for lead campaigns — Meta can only optimise for leads if a pixel is
              reporting them. Traffic and awareness campaigns don&apos;t need one.
            </p>
          </div>

          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !adAccountId || !pageId}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
