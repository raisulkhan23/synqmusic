import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Heart,
  ListMusic,
  Loader2,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Two-step destructive action: first click arms, second click confirms. */
function ConfirmButton({
  label,
  confirmLabel = "Confirm?",
  onConfirm,
  className,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={
        armed
          ? "rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
          : `rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400 ${className ?? ""}`
      }
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export default function Admin() {
  const status = useQuery(api.admin.status);
  const users = useQuery(api.admin.listUsers);
  const playlists = useQuery(api.admin.listAllPlaylists);
  const me = useQuery(api.users.currentUser);

  const setRole = useMutation(api.admin.setRole);
  const deleteUser = useMutation(api.admin.deleteUser);
  const deletePlaylist = useMutation(api.admin.deletePlaylist);

  const [tab, setTab] = useState("overview");

  if (status === undefined) {
    return (
      <div className="flex flex-col gap-3 py-10">
        <div className="h-9 w-64 animate-pulse rounded bg-white/[0.05]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  if (status === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
          <ShieldCheck className="size-7 text-muted-foreground/60" />
        </span>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">
            Admin access required
          </h1>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            This area is reserved for administrators. If you manage this
            deployment, contact an existing admin to be granted access.
          </p>
        </div>
        <Link
          to="/home"
          className="mt-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
        >
          Back to your dashboard
        </Link>
      </div>
    );
  }

  const counts = status.counts;

  const handleSetRole = async (
    userId: Id<"users">,
    name: string,
    role: "admin" | "user",
  ) => {
    try {
      await setRole({ userId, role });
      toast.success(role === "admin" ? `${name} is now an admin` : `${name} is now a standard user`);
    } catch {
      toast.error("Could not update the role");
    }
  };

  const handleDeleteUser = async (userId: Id<"users">, name: string) => {
    try {
      await deleteUser({ userId });
      toast.success(`Deleted ${name}'s account`);
    } catch {
      toast.error("Could not delete the account");
    }
  };

  const handleDeletePlaylist = async (playlistId: Id<"playlists">) => {
    try {
      await deletePlaylist({ playlistId });
      toast.success("Playlist deleted");
    } catch {
      toast.error("Could not delete the playlist");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))]">
            <Shield className="size-5" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Admin
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage accounts and content across the deployment.
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white/[0.05]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="playlists">Playlists</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Accounts" value={counts.users} />
            <StatCard icon={ShieldCheck} label="Admins" value={counts.admins} />
            <StatCard icon={ListMusic} label="Playlists" value={counts.playlists} />
            <StatCard icon={Heart} label="Liked songs" value={counts.likes} />
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
            <p className="text-sm font-semibold">About this admin area</p>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
              From here you can review every account on the deployment, grant or
              revoke admin access, and moderate any playlist. The first account
              ever created on this deployment was automatically promoted to
              admin, which is how you&apos;re here.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.03] text-[11px] tracking-widest text-muted-foreground uppercase">
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Member since</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users === undefined &&
                  [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-3">
                        <div className="h-6 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                    </tr>
                  ))}
                {users?.map((user) => {
                  const isSelf = user._id === me?._id;
                  const name = user.name ?? (user.isAnonymous ? "Guest listener" : "Unnamed listener");
                  const email = user.email ?? "Anonymous sign-in";
                  return (
                    <tr key={user._id} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--tint)_/_0.14)] text-xs font-bold text-[rgb(var(--tint))]">
                            {name
                              .split(/\s+/)
                              .map((w) => w[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {name}
                              {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                        {formatDate(user._creationTime)}
                      </td>
                      <td className="px-4 py-3">
                        {user.role === "admin" ? (
                          <Badge className="bg-[rgb(var(--tint)_/_0.16)] text-[rgb(var(--tint))] ring-1 ring-[rgb(var(--tint)_/_0.3)]">
                            Admin
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-white/[0.05] text-muted-foreground">
                            Standard
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {!isSelf && (
                            <>
                              {user.role === "admin" ? (
                                <button
                                  type="button"
                                  onClick={() => handleSetRole(user._id, name, "user")}
                                  className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                                >
                                  <ArrowDownToLine className="size-3.5" />
                                  Demote
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSetRole(user._id, name, "admin")}
                                  className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                                >
                                  <ArrowUpFromLine className="size-3.5" />
                                  Make admin
                                </button>
                              )}
                              <ConfirmButton
                                label="Delete"
                                onConfirm={() => handleDeleteUser(user._id, name)}
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="playlists" className="mt-6">
          <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.03] text-[11px] tracking-widest text-muted-foreground uppercase">
                  <th className="px-4 py-3 font-semibold">Playlist</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">Owner</th>
                  <th className="px-4 py-3 font-semibold">Tracks</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Created</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {playlists === undefined &&
                  [0, 1].map((i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-3">
                        <div className="h-6 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                    </tr>
                  ))}
                {playlists?.map((playlist) => (
                  <tr key={playlist._id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3 font-medium">{playlist.name}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      {playlist.ownerName ?? playlist.ownerEmail ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{playlist.trackCount}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {formatDate(playlist._creationTime)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete playlist?"
                          onConfirm={() => handleDeletePlaylist(playlist._id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {playlists !== undefined && playlists.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No playlists exist yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))]">
        <Icon className="size-[18px]" />
      </span>
      <p className="mt-3 font-display text-3xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}