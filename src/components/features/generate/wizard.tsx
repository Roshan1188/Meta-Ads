"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Loader2, Rocket, Save, Sparkles, TriangleAlert } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { EditableList } from "./editable-list";
import { Stepper, type StepName } from "./stepper";
import { postJson } from "@/lib/api";
import { formatRupees, MIN_DAILY_BUDGET_RUPEES } from "@/lib/money";
import {
  GOAL_LABELS,
  GOALS,
  MAX_HEADLINE_CHARS,
  type AdCopy,
  type CampaignPlan,
  type Goal,
  type WebsiteAnalysis,
} from "@/lib/ai/schemas";

type StartResponse = {
  jobId: string;
  url: string;
  analysis: WebsiteAnalysis;
  mocked: boolean;
};
type CopyResponse = { copy: AdCopy; plan: CampaignPlan; mocked: boolean };
type CreativesResponse = {
  images: string[];
  mocked: boolean;
  provider: string;
  video: { url: string | null; skipped: boolean; reason?: string };
};

export function GenerateWizard() {
  const router = useRouter();

  const [step, setStep] = useState<StepName>("Website");
  const [jobId, setJobId] = useState<string>();

  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState<Goal>("LEAD_GEN");
  const [budget, setBudget] = useState("1000");

  const [analysis, setAnalysis] = useState<WebsiteAnalysis>();
  const [copy, setCopy] = useState<AdCopy>();
  const [plan, setPlan] = useState<CampaignPlan>();
  const [images, setImages] = useState<string[]>([]);
  const [video, setVideo] = useState<CreativesResponse["video"]>();
  const [mocked, setMocked] = useState({ text: false, images: false });

  const start = useMutation({
    mutationFn: () =>
      postJson<StartResponse>("/api/generate/analyze", {
        url,
        goal,
        budgetRupees: Number(budget),
      }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setUrl(data.url);
      setAnalysis(data.analysis);
      setMocked((prev) => ({ ...prev, text: data.mocked }));
      setStep("Analysis");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const writeCopy = useMutation({
    mutationFn: () => postJson<CopyResponse>("/api/generate/copy", { jobId, analysis }),
    onSuccess: (data) => {
      setCopy(data.copy);
      setPlan(data.plan);
      setMocked((prev) => ({ ...prev, text: prev.text || data.mocked }));
      setStep("Copy");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const makeCreatives = useMutation({
    mutationFn: () =>
      postJson<CreativesResponse>("/api/generate/creatives", {
        jobId,
        imagePrompts: copy!.imagePrompts,
        headline: copy!.headlines[0] ?? "",
      }),
    onSuccess: (data) => {
      setImages(data.images);
      setVideo(data.video);
      setMocked((prev) => ({ ...prev, images: data.mocked }));
      if (data.video.skipped && data.video.reason) toast.info(data.video.reason);
      setStep("Creatives");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: () =>
      postJson<{ jobId: string }>("/api/generate/save", {
        jobId,
        analysis,
        copy,
        plan,
        images,
        videoUrl: video?.url ?? null,
      }),
    onSuccess: () => {
      toast.success("Draft saved.");
      router.push("/dashboard");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const budgetPaise = Number(budget || 0) * 100;

  return (
    <>
      <Stepper current={step} />

      {(mocked.text || mocked.images) && <MockNotice mocked={mocked} />}

      {step === "Website" && (
        <Card>
          <CardHeader>
            <CardTitle>What are we advertising?</CardTitle>
            <CardDescription>
              We read the site, research the business, and build the campaign from it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate();
              }}
            >
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="url">Website</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="www.doonearthsolutions.in"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Daily budget (₹)</Label>
                <Input
                  id="budget"
                  type="number"
                  min={MIN_DAILY_BUDGET_RUPEES}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="goal">Goal</Label>
                <Select value={goal} onValueChange={(value) => setGoal(value as Goal)}>
                  <SelectTrigger id="goal" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOALS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {GOAL_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:col-span-3">
                <Button type="submit" disabled={start.isPending}>
                  {start.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {start.isPending ? "Reading the website…" : "Analyse website"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {start.isPending && <StageSkeleton lines={5} label="Reading the website" />}

      {step === "Analysis" && analysis && (
        <Card>
          <CardHeader>
            <CardTitle>{analysis.businessName}</CardTitle>
            <CardDescription>
              Correct anything that&apos;s wrong — everything downstream is written from
              this.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Summary">
              <Textarea
                value={analysis.summary}
                rows={3}
                onChange={(e) => setAnalysis({ ...analysis, summary: e.target.value })}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Services">
                <EditableList
                  label="Service"
                  items={analysis.services}
                  onChange={(services) => setAnalysis({ ...analysis, services })}
                />
              </Field>
              <Field label="Value propositions">
                <EditableList
                  label="Value proposition"
                  items={analysis.valueProps}
                  onChange={(valueProps) => setAnalysis({ ...analysis, valueProps })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tone">
                <Input
                  value={analysis.tone}
                  onChange={(e) => setAnalysis({ ...analysis, tone: e.target.value })}
                />
              </Field>
              <Field label="Location">
                <Input
                  value={analysis.location}
                  onChange={(e) => setAnalysis({ ...analysis, location: e.target.value })}
                />
              </Field>
              <Field label="Target customer">
                <Input
                  value={analysis.targetCustomer}
                  onChange={(e) =>
                    setAnalysis({ ...analysis, targetCustomer: e.target.value })
                  }
                />
              </Field>
            </div>

            <Button onClick={() => writeCopy.mutate()} disabled={writeCopy.isPending}>
              {writeCopy.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {writeCopy.isPending ? "Writing copy…" : "Write copy & plan"}
            </Button>
          </CardContent>
        </Card>
      )}

      {writeCopy.isPending && (
        <StageSkeleton lines={6} label="Writing 10 headlines, 5 texts, and the media plan" />
      )}

      {step === "Copy" && copy && (
        <Card>
          <CardHeader>
            <CardTitle>Ad copy</CardTitle>
            <CardDescription>
              {copy.headlines.length} headlines and {copy.primaryTexts.length} primary texts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Field label="Headlines">
              <EditableList
                label="Headline"
                items={copy.headlines}
                maxChars={MAX_HEADLINE_CHARS}
                onChange={(headlines) => setCopy({ ...copy, headlines })}
              />
            </Field>
            <Field label="Primary texts">
              <EditableList
                label="Primary text"
                multiline
                items={copy.primaryTexts}
                onChange={(primaryTexts) => setCopy({ ...copy, primaryTexts })}
              />
            </Field>

            <Button onClick={() => makeCreatives.mutate()} disabled={makeCreatives.isPending}>
              {makeCreatives.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {makeCreatives.isPending ? "Generating images…" : "Generate creatives"}
            </Button>
          </CardContent>
        </Card>
      )}

      {makeCreatives.isPending && <ImageSkeleton />}

      {step === "Creatives" && (
        <Card>
          <CardHeader>
            <CardTitle>Creatives</CardTitle>
            <CardDescription>
              {images.length} images
              {video?.url ? " and a 15-second video" : ""}. Untick nothing — remove what you
              don&apos;t want on the review screen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ImageGrid images={images} />

            {video?.url && (
              <video
                src={video.url}
                controls
                className="w-full max-w-sm rounded-lg border"
              />
            )}

            <Button onClick={() => setStep("Review")}>
              <ArrowRight className="size-4" />
              Review
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "Review" && analysis && copy && plan && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Campaign plan</CardTitle>
              <CardDescription>
                {plan.structure.campaignName} · {plan.structure.objective} ·{" "}
                {formatRupees(budgetPaise)}/day
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Audience</h3>
                <dl className="text-sm">
                  <Row label="Age">
                    {plan.audience.ageMin}–{plan.audience.ageMax}
                  </Row>
                  <Row label="Gender">{plan.audience.genders}</Row>
                  <Row label="Locations">{plan.audience.locations.join(", ")}</Row>
                  <Row label="Interests">{plan.audience.interests.join(", ")}</Row>
                </dl>
                <p className="text-muted-foreground mt-2 text-sm text-pretty">
                  {plan.audience.rationale}
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Budget split</h3>
                <ul className="space-y-2 text-sm">
                  {plan.budget.allocations.map((allocation) => (
                    <li key={allocation.adSetName}>
                      <div className="flex justify-between">
                        <span>{allocation.adSetName}</span>
                        <span className="tabular-nums">
                          {allocation.percentage}% ·{" "}
                          {formatRupees((budgetPaise * allocation.percentage) / 100)}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs text-pretty">
                        {allocation.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="sm:col-span-2">
                <h3 className="mb-2 text-sm font-medium">Structure</h3>
                <ul className="text-muted-foreground space-y-1 text-sm">
                  {plan.structure.adSets.map((adSet) => (
                    <li key={adSet.name}>
                      <span className="text-foreground font-medium">{adSet.name}</span> —{" "}
                      {adSet.adCount} ads · {adSet.audienceNote}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Headlines</CardTitle>
            </CardHeader>
            <CardContent>
              <EditableList
                label="Headline"
                items={copy.headlines}
                maxChars={MAX_HEADLINE_CHARS}
                onChange={(headlines) => setCopy({ ...copy, headlines })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Primary texts</CardTitle>
            </CardHeader>
            <CardContent>
              <EditableList
                label="Primary text"
                multiline
                items={copy.primaryTexts}
                onChange={(primaryTexts) => setCopy({ ...copy, primaryTexts })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
              <CardDescription>Click an image to drop it from the set.</CardDescription>
            </CardHeader>
            <CardContent>
              <ImageGrid
                images={images}
                onRemove={(index) => setImages(images.filter((_, i) => i !== index))}
              />
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save as draft
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button emits no pointer events, so the tooltip needs a live wrapper. */}
                <span tabIndex={0}>
                  <Button variant="outline" disabled>
                    <Rocket className="size-4" />
                    Publish to Meta
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming in Phase 2</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="text-muted-foreground w-24 shrink-0">{label}</dt>
      <dd className="text-pretty">{children}</dd>
    </div>
  );
}

function ImageGrid({
  images,
  onRemove,
}: {
  images: string[];
  onRemove?: (index: number) => void;
}) {
  if (images.length === 0) {
    return <p className="text-muted-foreground text-sm">No images.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {images.map((src, index) => (
        <li key={`${src}-${index}`}>
          <button
            type="button"
            disabled={!onRemove}
            onClick={() => onRemove?.(index)}
            aria-label={onRemove ? `Remove image ${index + 1}` : `Image ${index + 1}`}
            className="group relative block aspect-square w-full overflow-hidden rounded-md border enabled:cursor-pointer"
          >
            {/* Remote hosts are arbitrary (Replicate/Shotstack CDNs), so skip the
                Next image optimiser rather than allowlisting a moving target. */}
            <Image
              src={src}
              alt={`Ad creative ${index + 1}`}
              fill
              unoptimized
              sizes="(max-width: 640px) 50vw, 20vw"
              className="object-cover transition group-enabled:group-hover:opacity-60"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function MockNotice({ mocked }: { mocked: { text: boolean; images: boolean } }) {
  const missing = [
    mocked.text && "ANTHROPIC_API_KEY",
    mocked.images && "REPLICATE_API_TOKEN",
  ].filter(Boolean);

  return (
    <Card className="border-amber-500/50 bg-amber-500/5 mb-4">
      <CardContent className="flex items-start gap-3 py-4">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium">You&apos;re looking at placeholder output.</p>
          <p className="text-muted-foreground text-pretty">
            {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} not set, so this was
            never sent to a real model. Add the key to <code>.env</code> and restart to
            generate real ads.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function StageSkeleton({ lines, label }: { lines: number; label: string }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {label}…
        </p>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${95 - i * 8}%` }} />
        ))}
      </CardContent>
    </Card>
  );
}

function ImageSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Generating 10 images — this takes a minute…
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
