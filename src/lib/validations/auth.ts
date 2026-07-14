import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const registerSchema = credentialsSchema.extend({
  name: z.string().min(1, "Name is required.").max(80),
  /** Present when signing up from a team invitation link. */
  inviteToken: z.string().optional(),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
