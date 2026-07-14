import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await auth()) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        {APP_NAME}
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
