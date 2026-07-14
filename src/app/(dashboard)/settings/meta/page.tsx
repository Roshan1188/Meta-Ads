import type { Metadata } from "next";

import { PageHeader } from "@/components/features/page-header";
import { MetaConnect } from "@/components/features/meta/meta-connect";
import { isMetaConfigured } from "@/lib/meta/oauth";
import { getConnection, loadMetaOptions, type MetaOptions } from "@/server/meta";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Meta" };

export default async function MetaSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const member = await requireMember();
  const params = await searchParams;

  // The Facebook token belongs to the person who connected it, so this is one of the
  // few things scoped to the user rather than the agency.
  const connection = await getConnection(member.userId);

  let options: MetaOptions | null = null;
  let loadError: string | null = null;

  if (connection) {
    try {
      options = await loadMetaOptions(connection.accessToken, connection.adAccountId);
    } catch (error) {
      // An expired or revoked token surfaces here first. Tell the user to reconnect
      // rather than rendering empty dropdowns that look like they have no accounts.
      loadError =
        error instanceof Error
          ? error.message
          : "Could not read your Meta accounts. Try reconnecting.";
    }
  }

  return (
    <>
      <PageHeader
        title="Meta"
        description="Connect Facebook, then choose where campaigns get published."
      />
      <MetaConnect
        configured={isMetaConfigured}
        connection={
          connection && {
            adAccountId: connection.adAccountId,
            pageId: connection.pageId,
            pixelId: connection.pixelId,
            igAccountId: connection.igAccountId,
            expiresAt: connection.expiresAt?.toISOString() ?? null,
          }
        }
        options={options}
        loadError={loadError}
        callbackError={params.error ?? null}
        justConnected={params.connected === "1"}
      />
    </>
  );
}
