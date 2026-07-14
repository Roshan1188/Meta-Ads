import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/features/page-header";
import { BrandingForm } from "@/components/features/branding/branding-form";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { PLAN_SPECS } from "@/lib/billing/plans";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingPage() {
  const member = await requireMember();
  if (!can(member.role, "branding:manage")) redirect("/settings");

  const agency = await db.agency.findUnique({
    where: { id: member.agencyId },
    select: {
      name: true,
      slug: true,
      logoUrl: true,
      brandColor: true,
      reportHeader: true,
      customDomain: true,
    },
  });

  return (
    <>
      <PageHeader title="Branding" description="What your clients see on their reports." />
      <BrandingForm
        agency={agency!}
        whiteLabelAllowed={PLAN_SPECS[member.plan].whiteLabel}
        planName={PLAN_SPECS[member.plan].name}
      />
    </>
  );
}
