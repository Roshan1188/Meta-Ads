import Link from "next/link";
import { redirect } from "next/navigation";

import { SidebarNav } from "@/components/features/sidebar-nav";
import { UserMenu } from "@/components/features/user-menu";
import { auth } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";

/**
 * Every route under (dashboard) is gated here. This layout is a server component,
 * so it runs before any child page renders — no unauthenticated flash.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { name, email } = session.user;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar flex flex-col gap-6 border-b p-4 md:h-screen md:w-60 md:shrink-0 md:justify-between md:border-r md:border-b-0">
        <div className="flex flex-col gap-6">
          <Link
            href="/dashboard"
            className="px-3 py-1 text-base font-semibold tracking-tight"
          >
            {APP_NAME}
          </Link>
          {/* Horizontal scroller on phones, vertical rail from md up. */}
          <SidebarNav className="-mx-1 flex-row overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0" />
        </div>
        <div className="hidden md:block">
          <UserMenu name={name ?? ""} email={email ?? ""} />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <div className="flex justify-end border-b p-2 md:hidden">
          <div className="w-48">
            <UserMenu name={name ?? ""} email={email ?? ""} />
          </div>
        </div>
        <main className="flex-1 p-6 md:p-10">{children}</main>
      </div>
    </div>
  );
}
