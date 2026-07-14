import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInvite } from "@/components/features/team/accept-invite";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { APP_NAME } from "@/lib/constants";
import { ROLE_LABELS } from "@/lib/permissions";
import { findInvite } from "@/server/team";

export const metadata: Metadata = { title: "Invitation" };

const MESSAGES = {
  missing: "That invitation link isn't valid.",
  used: "That invitation has already been accepted.",
  expired: "That invitation has expired. Ask for a new one.",
} as const;

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await findInvite(token);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        {APP_NAME}
      </Link>

      <div className="w-full max-w-sm">
        {found.state !== "valid" ? (
          <Card>
            <CardHeader>
              <CardTitle>Invitation unavailable</CardTitle>
              <CardDescription>{MESSAGES[found.state]}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/login">Go to login</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Invitation token={token} invite={found.invite} />
        )}
      </div>
    </div>
  );
}

async function Invitation({
  token,
  invite,
}: {
  token: string;
  invite: {
    email: string;
    role: keyof typeof ROLE_LABELS;
    agency: { name: string };
  };
}) {
  const session = await auth();

  // Already signed in as someone: either accept, or say plainly why they can't.
  if (session?.user) {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true },
    });

    return (
      <AcceptInvite
        token={token}
        agencyName={invite.agency.name}
        role={ROLE_LABELS[invite.role]}
        inviteEmail={invite.email}
        signedInAs={user?.email ?? ""}
      />
    );
  }

  // Not signed in — send them to register with the token attached, so signing up
  // joins this agency instead of creating an agency of one.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {invite.agency.name}</CardTitle>
        <CardDescription>
          You&apos;ve been invited as a {ROLE_LABELS[invite.role]}. Create an account with{" "}
          <strong>{invite.email}</strong> to accept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button asChild className="w-full">
          <Link href={`/register?invite=${token}&email=${encodeURIComponent(invite.email)}`}>
            Create account
          </Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">I already have an account</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
