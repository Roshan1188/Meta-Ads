"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
import { postJson } from "@/lib/api";

export function BrandingForm({
  agency,
  whiteLabelAllowed,
  planName,
}: {
  agency: {
    name: string;
    slug: string;
    logoUrl: string | null;
    brandColor: string | null;
    reportHeader: string | null;
    customDomain: string | null;
  };
  whiteLabelAllowed: boolean;
  planName: string;
}) {
  const router = useRouter();

  const [name, setName] = useState(agency.name);
  const [logoUrl, setLogoUrl] = useState(agency.logoUrl ?? "");
  const [brandColor, setBrandColor] = useState(agency.brandColor ?? "#1E5631");
  const [reportHeader, setReportHeader] = useState(agency.reportHeader ?? "");
  const [customDomain, setCustomDomain] = useState(agency.customDomain ?? "");

  const save = useMutation({
    mutationFn: () =>
      postJson("/api/agency", {
        name,
        logoUrl: logoUrl.trim() || null,
        brandColor: whiteLabelAllowed ? brandColor : null,
        reportHeader: reportHeader.trim() || null,
        customDomain: customDomain.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Branding saved.");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Agency</CardTitle>
          <CardDescription>
            Reports go out under this name at{" "}
            <code>{agency.slug}.autoads.ai</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agency-name">Name</Label>
            <Input
              id="agency-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>White-label</CardTitle>
          <CardDescription>
            {whiteLabelAllowed
              ? "Your clients see your brand on every report, not ours."
              : `Not included in the ${planName} plan. Upgrade to Growth to remove our branding.`}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <fieldset disabled={!whiteLabelAllowed} className="space-y-4 disabled:opacity-60">
            <div className="space-y-2">
              <Label htmlFor="brand-color">Brand colour</Label>
              <div className="flex gap-2">
                <Input
                  id="brand-color"
                  type="color"
                  className="h-9 w-16 p-1"
                  value={brandColor}
                  onChange={(event) => setBrandColor(event.target.value)}
                />
                <Input
                  aria-label="Brand colour hex"
                  value={brandColor}
                  onChange={(event) => setBrandColor(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">Logo URL</Label>
              <Input
                id="logo"
                value={logoUrl}
                placeholder="https://myagency.com/logo.png"
                onChange={(event) => setLogoUrl(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Must be publicly reachable — email clients can&apos;t see anything behind a
                login.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report-header">Report header</Label>
              <Input
                id="report-header"
                value={reportHeader}
                placeholder={name}
                onChange={(event) => setReportHeader(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">Custom domain</Label>
              <Input
                id="domain"
                value={customDomain}
                placeholder="reports.myagency.com"
                onChange={(event) => setCustomDomain(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Point a CNAME at your deployment, then set it here.
              </p>
            </div>
          </fieldset>

          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
