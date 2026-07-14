"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { postJson } from "@/lib/api";

export function AcceptInvite({
  token,
  agencyName,
  role,
  inviteEmail,
  signedInAs,
}: {
  token: string;
  agencyName: string;
  role: string;
  inviteEmail: string;
  signedInAs: string;
}) {
  const router = useRouter();

  const mismatch = signedInAs.toLowerCase() !== inviteEmail.toLowerCase();

  const accept = useMutation({
    mutationFn: () => postJson("/api/team/accept", { token }),
    onSuccess: () => {
      toast.success(`You've joined ${agencyName}.`);
      router.push("/dashboard");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {agencyName}</CardTitle>
        <CardDescription>
          {mismatch
            ? `This invitation is for ${inviteEmail}, but you're signed in as ${signedInAs}. Sign out and sign in with the invited address.`
            : `You've been invited as a ${role}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full"
          disabled={mismatch || accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending && <Loader2 className="size-4 animate-spin" />}
          Accept invitation
        </Button>
      </CardContent>
    </Card>
  );
}
