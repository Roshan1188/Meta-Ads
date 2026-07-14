import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Facebook from "next-auth/providers/facebook";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/validations/auth";
import type { Role } from "@prisma/client";

/**
 * Facebook is only registered once Meta credentials exist. Without this guard
 * Auth.js renders a "Sign in with Facebook" button that 500s on click, which is
 * worse than not showing it at all. Phase 2 adds the ads_management scopes.
 */
export const isFacebookConfigured = Boolean(
  process.env.META_APP_ID && process.env.META_APP_SECRET,
);

const providers: Provider[] = [
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      const user = await db.user.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
      });
      // OAuth-only users have no hash — they must sign in with Facebook.
      if (!user?.passwordHash) return null;

      const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!ok) return null;

      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  }),
];

if (isFacebookConfigured) {
  providers.push(
    Facebook({
      clientId: process.env.META_APP_ID,
      clientSecret: process.env.META_APP_SECRET,
    }),
  );
}

export const authConfig = {
  adapter: PrismaAdapter(db),
  // Credentials providers require JWT sessions; the adapter still persists
  // OAuth accounts and users.
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: Role }).role ?? "OWNER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
