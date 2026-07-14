"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson } from "@/lib/api";
import type { MetaOptions } from "@/server/meta";

const DEFAULT = "__default__";

export type ClientRow = {
  id: string;
  name: string;
  websiteUrl: string;
  contactEmail: string | null;
  contactPhone: string | null;
  reportsEnabled: boolean;
  metaAdAccountId: string | null;
  metaPageId: string | null;
  metaPixelId: string | null;
  campaigns: number;
  lastReportId: string | null;
};

export function ClientCard({
  client,
  options,
  canSendReports,
}: {
  client: ClientRow;
  options: MetaOptions | null;
  canSendReports: boolean;
}) {
  const router = useRouter();

  const [email, setEmail] = useState(client.contactEmail ?? "");
  const [phone, setPhone] = useState(client.contactPhone ?? "");
  const [reports, setReports] = useState(client.reportsEnabled);
  const [adAccount, setAdAccount] = useState(client.metaAdAccountId ?? DEFAULT);
  const [page, setPage] = useState(client.metaPageId ?? DEFAULT);
  const [pixel, setPixel] = useState(client.metaPixelId ?? DEFAULT);

  const save = useMutation({
    mutationFn: (overrides: Partial<{ reportsEnabled: boolean }> = {}) =>
      postJson("/api/clients", {
        action: "settings",
        clientId: client.id,
        contactEmail: email.trim() || null,
        contactPhone: phone.trim() || null,
        reportsEnabled: overrides.reportsEnabled ?? reports,
        metaAdAccountId: adAccount === DEFAULT ? null : adAccount,
        metaPageId: page === DEFAULT ? null : page,
        metaPixelId: pixel === DEFAULT ? null : pixel,
      }),
    onSuccess: () => {
      toast.success("Saved.");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const send = useMutation({
    mutationFn: () =>
      postJson<{ reportId: string; emailed: boolean; whatsapped: boolean; note: string | null }>(
        "/api/clients",
        { action: "report", clientId: client.id, send: true },
      ),
    onSuccess: (data) => {
      const channels = [data.emailed && "email", data.whatsapped && "WhatsApp"].filter(
        Boolean,
      );
      // Say exactly what happened — "Sent!" when nothing went anywhere is a lie.
      if (channels.length > 0) toast.success(`Report sent by ${channels.join(" and ")}.`);
      else toast.warning(data.note ?? "Report built, but nothing was sent.");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{client.name}</CardTitle>
          <Badge variant="secondary">
            {client.campaigns} campaign{client.campaigns === 1 ? "" : "s"}
          </Badge>
        </div>
        <CardDescription className="truncate">{client.websiteUrl}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`email-${client.id}`}>Report email</Label>
            <Input
              id={`email-${client.id}`}
              type="email"
              value={email}
              placeholder="client@business.com"
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => save.mutate({})}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`phone-${client.id}`}>WhatsApp</Label>
            <Input
              id={`phone-${client.id}`}
              value={phone}
              placeholder="+91 98765 43210"
              onChange={(event) => setPhone(event.target.value)}
              onBlur={() => save.mutate({})}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor={`reports-${client.id}`}>Weekly report</Label>
            <p className="text-muted-foreground text-sm">Sent Mondays.</p>
          </div>
          <Switch
            id={`reports-${client.id}`}
            checked={reports}
            onCheckedChange={(checked) => {
              setReports(checked);
              save.mutate({ reportsEnabled: checked });
            }}
          />
        </div>

        {options && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Destination
              id={`ad-${client.id}`}
              label="Ad account"
              value={adAccount}
              onChange={(value) => {
                setAdAccount(value);
                save.mutate({});
              }}
              items={options.adAccounts.map((account) => ({
                value: account.id,
                label: account.name,
              }))}
            />
            <Destination
              id={`page-${client.id}`}
              label="Page"
              value={page}
              onChange={(value) => {
                setPage(value);
                save.mutate({});
              }}
              items={options.pages.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
            />
            <Destination
              id={`pixel-${client.id}`}
              label="Pixel"
              value={pixel}
              onChange={(value) => {
                setPixel(value);
                save.mutate({});
              }}
              items={options.pixels.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canSendReports && (
            <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send report now
            </Button>
          )}

          {client.lastReportId && (
            <Button asChild size="sm" variant="outline">
              <a href={`/reports/${client.lastReportId}`} target="_blank" rel="noreferrer">
                <FileText className="size-4" />
                Latest report
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Destination({
  id,
  label,
  value,
  onChange,
  items,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Most agencies use one ad account for everything; only override when a
              client genuinely has their own. */}
          <SelectItem value={DEFAULT}>Agency default</SelectItem>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
