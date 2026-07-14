"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Trash2, UserPlus } from "lucide-react";
import type { Role } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson } from "@/lib/api";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";

export type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
};

export function TeamManager({
  members,
  invites,
  currentUserId,
}: {
  members: TeamMember[];
  invites: TeamInvite[];
  currentUserId: string;
}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [lastLink, setLastLink] = useState<string>();

  const invite = useMutation({
    mutationFn: () =>
      postJson<{ url: string; emailed: boolean; note?: string }>("/api/team", {
        action: "invite",
        email,
        role,
      }),
    onSuccess: (data) => {
      setEmail("");
      setLastLink(data.url);
      toast.success(
        data.emailed
          ? "Invitation emailed."
          : "Invitation created — email isn't configured, so copy the link below.",
      );
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const mutate = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson("/api/team", body),
    onSuccess: () => {
      toast.success("Team updated.");
      router.refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>{ROLE_DESCRIPTIONS[role]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate();
            }}
          >
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                placeholder="colleague@agency.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="w-44 space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as Role)}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Invite
            </Button>
          </form>

          {lastLink && (
            <div className="bg-muted flex items-center gap-2 rounded-md p-2">
              <code className="flex-1 truncate text-xs">{lastLink}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(lastLink);
                  toast.success("Link copied.");
                }}
              >
                <Copy className="size-4" />
                Copy
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((teamMember) => {
            const isOwner = teamMember.role === "OWNER";
            const isSelf = teamMember.id === currentUserId;

            return (
              <div
                key={teamMember.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-40">
                  <p className="text-sm font-medium">
                    {teamMember.name ?? teamMember.email}
                    {isSelf && (
                      <span className="text-muted-foreground font-normal"> (you)</span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs">{teamMember.email}</p>
                </div>

                <div className="flex items-center gap-2">
                  {isOwner ? (
                    // The Owner's role is fixed — someone has to keep the billing keys.
                    <Badge>Owner</Badge>
                  ) : (
                    <Select
                      value={teamMember.role}
                      onValueChange={(value) =>
                        mutate.mutate({
                          action: "role",
                          userId: teamMember.id,
                          role: value,
                        })
                      }
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((option) => (
                          <SelectItem key={option} value={option}>
                            {ROLE_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {!isOwner && !isSelf && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${teamMember.email}`}
                      onClick={() =>
                        mutate.mutate({ action: "remove", userId: teamMember.id })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invites.map((pending) => (
              <div
                key={pending.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{pending.email}</p>
                  <p className="text-muted-foreground text-xs">
                    {ROLE_LABELS[pending.role]} · expires{" "}
                    {new Date(pending.expiresAt).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    mutate.mutate({ action: "revoke", inviteId: pending.id })
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
