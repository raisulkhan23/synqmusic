import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  Loader2,
  Radio,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Social hub: follow other listeners ("Friends") and join Listening Rooms —
 * shared rooms where everyone hears the same queue in sync.
 */
export default function Social() {
  const me = useQuery(api.users.currentUser);
  const listeners = useQuery(api.social.allListeners);
  const rooms = useQuery(api.social.listRooms);
  const [tab, setTab] = useState<"friends" | "rooms">("friends");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Users className="size-6 text-[rgb(var(--tint))]" />
          Social
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Follow friends and listen together in real time.
        </p>
      </header>

      <div className="flex gap-2">
        {(["friends", "rooms"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors",
              tab === t
                ? "bg-[rgb(var(--tint))] text-black"
                : "bg-white/[0.05] text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "friends" ? "Friends" : "Listening Rooms"}
          </button>
        ))}
      </div>

      {tab === "friends" && <FriendsTab me={me} listeners={listeners} />}
      {tab === "rooms" && <RoomsTab me={me} rooms={rooms} />}
    </div>
  );
}

type Listener = {
  _id: Id<"users">;
  name: string | null;
  image: string | null;
  isAnonymous?: boolean;
};

function FriendsTab({
  me,
  listeners,
}: {
  me?: { _id: Id<"users">; following?: Id<"users">[] } | null;
  listeners?: Listener[];
}) {
  const follow = useMutation(api.social.toggleFollow);
  const [busy, setBusy] = useState<string | null>(null);

  const following = useMemo(() => new Set(me?.following ?? []), [me]);
  const others = (listeners ?? []).filter((l) => l._id !== me?._id);

  const toggle = async (l: Listener) => {
    setBusy(l._id);
    const wasFollowing = following.has(l._id);
    try {
      await follow({ targetId: l._id });
      toast.success(wasFollowing ? `Unfollowed ${l.name ?? "listener"}` : `Following ${l.name ?? "listener"}`);
    } catch {
      toast.error("Couldn't update — try again");
    } finally {
      setBusy(null);
    }
  };

  if (others.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center">
        <Users className="mx-auto size-10 text-muted-foreground/50" />
        <p className="mt-3 font-display text-lg font-semibold">No friends yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When other listeners join SYNQ, you can follow them here to see what they're into.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {others.map((l) => {
        const isFollowing = following.has(l._id);
        return (
          <div
            key={l._id}
            className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05]"
          >
            {l.image ? (
              <img src={l.image} alt="" className="size-10 rounded-full object-cover ring-1 ring-white/10" loading="lazy" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-[rgb(var(--tint)_/_0.14)] text-sm font-bold text-[rgb(var(--tint))]">
                {(l.name ?? "L").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{l.name ?? "Listener"}</p>
              <p className="text-xs text-muted-foreground">{isFollowing ? "Following" : "Not following"}</p>
            </div>
            <button
              type="button"
              disabled={busy === l._id}
              onClick={() => toggle(l)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                isFollowing
                  ? "border-white/10 text-muted-foreground hover:text-foreground"
                  : "border-[rgb(var(--tint)_/_0.4)] text-[rgb(var(--tint))] hover:bg-[rgb(var(--tint)_/_0.12)]",
              )}
            >
              {busy === l._id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isFollowing ? (
                <X className="size-3.5" />
              ) : (
                <UserPlus className="size-3.5" />
              )}
              {isFollowing ? "Unfollow" : "Follow"}
            </button>
          </div>
        );
      })}
      {listeners === undefined && (
        <div className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />
      )}
    </div>
  );
}

type Room = {
  _id: Id<"listeningRooms">;
  name: string;
  hostName: string | null;        listenerCount: number;
        nowPlaying: string | null;
        members?: { userId: Id<"users">; name?: string; joinedAt: number }[];
};

function RoomsTab({
  me,
  rooms,
}: {
  me?: { _id: Id<"users"> } | null;
  rooms?: Room[];
}) {
  const create = useMutation(api.social.createRoom);
  const join = useMutation(api.social.joinRoom);
  const leave = useMutation(api.social.leaveRoom);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await create({ name: name.trim() });
      toast.success(`Room "${name.trim()}" created`);
      setName("");
    } catch {
      toast.error("Couldn't create the room");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="Name a new listening room…"
          className="w-full max-w-xs rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-[rgb(var(--tint)_/_0.5)]"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy || !name.trim()}
          className="flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-4 py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
          Create room
        </button>
      </div>

      {rooms === undefined ? (
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center">
          <Radio className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-3 font-display text-lg font-semibold">No rooms open</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a room and everyone who joins hears the host's queue in sync.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rooms.map((r) => {
            const isMember = r.members?.some((m) => m.userId === me?._id);
            return (
              <div
                key={r._id}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))]">
                  <Radio className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Host {r.hostName ?? "unknown"} · {r.listenerCount} listening
                    {r.nowPlaying ? ` · ♪ ${r.nowPlaying}` : ""}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "shrink-0",
                    r.nowPlaying ? "bg-emerald-500/15 text-emerald-300" : "bg-white/[0.05] text-muted-foreground",
                  )}
                >
                  {r.nowPlaying ? "Live" : "Idle"}
                </Badge>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (isMember) {
                        await leave({ roomId: r._id });
                        toast.success("Left the room");
                      } else {
                        await join({ roomId: r._id });
                        toast.success(`Joined "${r.name}"`);
                      }
                    } catch {
                      toast.error("Couldn't update — try again");
                    }
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    isMember
                      ? "border-white/10 text-muted-foreground hover:text-foreground"
                      : "border-[rgb(var(--tint)_/_0.4)] text-[rgb(var(--tint))] hover:bg-[rgb(var(--tint)_/_0.12)]",
                  )}
                >
                  {isMember ? "Leave" : "Join"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
