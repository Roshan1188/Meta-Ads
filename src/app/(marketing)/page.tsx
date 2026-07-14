import Link from "next/link";
import { ArrowRight, Bot, LineChart, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const PILLARS = [
  {
    icon: Bot,
    title: "Generate",
    body: "We read your website, research the market, then write headlines, body copy, and on-brand creatives.",
  },
  {
    icon: Rocket,
    title: "Publish",
    body: "Campaigns, ad sets, audiences, and ads pushed straight into Meta — Facebook and Instagram.",
  },
  {
    icon: LineChart,
    title: "Optimise",
    body: "Winners get more budget, losers get paused. Every automated decision is logged with its reason.",
  },
] as const;

export default async function LandingPage() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        <nav className="flex items-center gap-2">
          {session ? (
            <Button asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center py-20 text-center sm:py-28">
        <p className="text-primary mb-4 text-sm font-medium">
          AI-powered Meta Ads, end to end
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {APP_TAGLINE}
        </h1>
        <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty">
          Give {APP_NAME} a URL, a daily budget, and a goal. It handles the research,
          the copy, the creatives, the publishing, and the day-to-day optimisation.
        </p>
        <div className="mt-10 flex justify-center">
          <Button asChild size="lg">
            <Link href={session ? "/generate" : "/register"}>
              {session ? "Generate ads" : "Start free"}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 pb-24 sm:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="text-primary size-5" aria-hidden />
              <CardTitle className="mt-2">{title}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm text-pretty">
              {body}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
