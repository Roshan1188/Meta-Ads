import type { Metadata } from "next";

import { LoginForm } from "@/components/features/login-form";
import { isFacebookConfigured } from "@/lib/auth";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return <LoginForm facebookEnabled={isFacebookConfigured} />;
}
