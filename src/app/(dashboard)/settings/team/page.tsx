import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/features/page-header";
import { TeamManager } from "@/components/features/team/team-manager";
import { can } from "@/lib/permissions";
import { listTeam } from "@/server/team";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const member = await requireMember();

  // Hiding the nav link isn't enough — the page itself has to refuse.
  if (!can(member.role, "team:manage")) redirect("/settings");

  const { members, invites } = await listTeam(member.agencyId);

  return (
    <>
      <PageHeader
        title="Team"
        description="Employees can draft campaigns. Publishing and activating spend money, so those need a manager or above."
      />
      <TeamManager
        currentUserId={member.userId}
        members={members.map((entry) => ({
          id: entry.id,
          name: entry.name,
          email: entry.email,
          role: entry.role,
        }))}
        invites={invites.map((entry) => ({
          id: entry.id,
          email: entry.email,
          role: entry.role,
          expiresAt: entry.expiresAt.toISOString(),
        }))}
      />
    </>
  );
}
