import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Heart,
  ListMusic,
  Loader2,
  Shield,
  ShieldCheck,
  TrendingUp,
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
  const allLikes = useQuery(api.admin.listAllLikes);
  const topTracks = useQuery(api.admin.globalTopTracks);
  const activity = useQuery(api.admin.userActivity);
  const me = useQuery(api.users.currentUser);

  const setRole = useMutation(api.admin.setRole);
  const deleteUser = useMutation(api.admin.deleteUser);
  const deletePlaylist = useMutation(api.admin.deletePlaylist);
  const fetchGithub = useAction(api.admin.githubProfile);

  const [tab, setTab] = useState("overview");
  const [gh, setGh] = useState<{ userId: string; name: string; loading: boolean; data: Awaited<ReturnType<typeof fetchGithub>> } | null>(null);

  const openGithub = async (userId: string, githubId: string | null, name: string) => {
    setGh({ userId, name, loading: true, data: null });
    try {
      const data = githubId ? await fetchGithub({ githubId }) : null;
      setGh({ userId, name, loading: false, data });
    } catch {
      setGh({ userId, name, loading: false, data: null });
    }
  };

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
              Manage accounts, content, and listening activity across the deployment.
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white/[0.05]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="likes">Liked songs</TabsTrigger>
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
                          {user.image ? (
                            <img src={user.image} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/10" loading="lazy" />
                          ) : (
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--tint)_/_0.14)] text-xs font-bold text-[rgb(var(--tint))]">
                              {name
                                .split(/\s+/)
                                .map((w) => w[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {name}
                              {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                            </p>
                            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                              {email}
                              {user.providers?.includes("github") && (
                                <button
                                  type="button"
                                  onClick={() => openGithub(user._id, user.githubId, name)}
                                  title={`GitHub account${user.githubId ? ` #${user.githubId}` : ""} — click for profile`}
                                  className="inline-flex items-center rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold transition-colors hover:bg-white/[0.15] hover:text-foreground"
                                >
                                  <svg viewBox="0 0 24 24" className="mr-1 size-3 fill-current" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>
                                  GitHub
                                </button>
                              )}
                              {user.providers?.includes("google") && (
                                <span className="inline-flex items-center rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold">Google</span>
                              )}
                              {user.providers?.includes("email-otp") && (
                                <span className="inline-flex items-center rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold">Email</span>
                              )}
                              {user.providers?.includes("anonymous") && (
                                <span className="inline-flex items-center rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold">Guest</span>
                              )}
                            </p>
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

        <TabsContent value="likes" className="mt-6 flex flex-col gap-6">
          {/* per-user activity rollup */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.03] text-[11px] tracking-widest text-muted-foreground uppercase">
                  <th className="px-4 py-3 font-semibold">Listener</th>
                  <th className="px-4 py-3 font-semibold">Likes</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">Playlists</th>
                  <th className="px-4 py-3 font-semibold">Plays</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Last played</th>
                </tr>
              </thead>
              <tbody>
                {activity === undefined &&
                  [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-3">
                        <div className="h-6 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                    </tr>
                  ))}
                {activity?.map((row) => (
                  <tr key={row._id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-4 py-3 font-medium">{row.name ?? row.email ?? "Anonymous"}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{row.likes}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground tabular-nums sm:table-cell">{row.playlists}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{row.plays}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {row.lastPlayedAt ? formatDate(row.lastPlayedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* every liked song across the deployment */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
            <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.03] px-4 py-3">
              <Heart className="size-4 text-[rgb(var(--tint))]" />
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                All liked songs · {allLikes?.length ?? "…"}
              </p>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <tbody>
                  {allLikes === undefined &&
                    [0, 1, 2, 3].map((i) => (
                      <tr key={i}>
                        <td colSpan={4} className="px-4 py-3">
                          <div className="h-10 animate-pulse rounded bg-white/[0.05]" />
                        </td>
                      </tr>
                    ))}
                  {allLikes?.map((like) => (
                    <tr key={like._id} className="border-b border-white/[0.04] last:border-0">
                      <td className="w-12 px-4 py-2">
                        {like.coverUrl ? (
                          <img src={like.coverUrl} alt="" loading="lazy" className="size-10 rounded-md object-cover" />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-md bg-white/[0.06]">
                            <Heart className="size-4 text-muted-foreground/50" />
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <p className="truncate font-medium">{like.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{like.artistName}</p>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {like.ownerName ?? like.ownerEmail ?? "Unknown"}
                      </td>
                      <td className="hidden px-4 py-2 text-xs text-muted-foreground md:table-cell">
                        {formatDate(like.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {allLikes !== undefined && allLikes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No liked songs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* deployment-wide most played */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="size-4 text-[rgb(var(--tint))]" />
              Most played across the deployment
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {topTracks === undefined && <div className="h-16 animate-pulse rounded bg-white/[0.05]" />}
              {topTracks?.map((t, i) => (
                <div key={t.trackId} className="flex items-center gap-3 text-sm">
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{t.trackId}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t.plays} plays · {t.listeners} listener{t.listeners === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
              {topTracks !== undefined && topTracks.length === 0 && (
                <p className="text-sm text-muted-foreground">No listening history yet.</p>
              )}
            </div>
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

      {/* GitHub profile popover */}
      {gh && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setGh(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#141419] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">GitHub account — {gh.name}</p>
            {gh.loading && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Fetching profile…
              </div>
            )}
            {!gh.loading && gh.data && (
              <div className="mt-4 flex items-start gap-4">
                {gh.data.avatarUrl && (
                  <img src={gh.data.avatarUrl} alt="" className="size-14 rounded-full ring-1 ring-white/10" loading="lazy" />
                )}
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{gh.data.name ?? gh.data.login}</p>
                  <a href={gh.data.htmlUrl ?? undefined} target="_blank" rel="noreferrer" className="text-xs text-[rgb(var(--tint))] hover:underline">
                    @{gh.data.login} — open on GitHub
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">{gh.data.publicRepos} public repos</p>
                  {gh.data.createdAt && (
                    <p className="text-xs text-muted-foreground">Joined GitHub {new Date(gh.data.createdAt).getFullYear()}</p>
                  )}
                </div>
              </div>
            )}
            {!gh.loading && !gh.data && (
              <p className="mt-4 text-sm text-muted-foreground">
                Couldn&apos;t load this GitHub profile (account may be private or deleted).
              </p>
            )}
            <button
              type="button"
              onClick={() => setGh(null)}
              className="mt-5 w-full rounded-full border border-white/10 py-2 text-sm font-medium transition-colors hover:bg-white/[0.06]"
            >
              Close
            </button>
          </div>
        </div>
      )}
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