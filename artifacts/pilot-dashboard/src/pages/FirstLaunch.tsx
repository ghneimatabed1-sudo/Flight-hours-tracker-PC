// FirstLaunch — entry point for a fresh laptop with no bound member.
//
// Task #299. Replaces the old "License Key + Set Up This Device" pair.
// Round-3 review rework: the super-admin button is ALWAYS rendered so
// the operator never wonders where it went; when an SA already exists
// we render the button DISABLED with an explanatory message instead
// of silently hiding it. The "I already have an account" link is
// removed — every laptop in the new flow joins through the
// request/approve/bind path; there is no separate self-serve sign-in
// page in this product. We also gate the "Request to join" button on
// at least one squadron existing in the cloud, otherwise the join
// would land on a JoinSetup page with an empty squadron picker and
// fail at submit time.
//
// Routed unconditionally from App.tsx when:
//   • no Supabase session is live, AND
//   • no pending join request is parked in localStorage.

import { Link } from "wouter";
import { useEffect, useState } from "react";
import {
  checkSuperAdminExists, checkSuperAdminSetupAllowed, listSquadronsForJoin,
  unitJoinConfigured,
} from "../lib/unit-join";

type CloudState =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "needs-setup"; squadronCount: number }
  | { kind: "ready"; squadronCount: number; superAdminExists: boolean };

export default function FirstLaunch() {
  const [cloud, setCloud] = useState<CloudState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    if (!unitJoinConfigured) {
      setCloud({ kind: "offline" });
      return () => { alive = false; };
    }
    (async () => {
      try {
        const [exists, allowed, squadrons] = await Promise.all([
          checkSuperAdminExists(),
          checkSuperAdminSetupAllowed(),
          listSquadronsForJoin(),
        ]);
        if (!alive) return;
        const squadronCount = squadrons.length;
        if (!exists && allowed) setCloud({ kind: "needs-setup", squadronCount });
        else setCloud({ kind: "ready", squadronCount, superAdminExists: exists });
      } catch {
        if (alive) setCloud({ kind: "offline" });
      }
    })();
    return () => { alive = false; };
  }, []);

  const offline = cloud.kind === "offline" || cloud.kind === "loading";
  const saButtonEnabled = cloud.kind === "needs-setup";
  const squadronCount =
    cloud.kind === "needs-setup" || cloud.kind === "ready" ? cloud.squadronCount : 0;
  const joinButtonEnabled = !offline && squadronCount > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 text-2xl">
            ✈
          </div>
          <h1 className="text-2xl font-semibold">Pilot Hours Dashboard</h1>
          <p className="text-sm text-slate-400">Welcome to your unit's logbook.</p>
        </div>

        <div className="space-y-3">
          {/* Super-admin button is ALWAYS rendered so the operator
              can see whether bootstrap is available. Disabled state
              carries an explanation underneath. */}
          {saButtonEnabled ? (
            <Link
              href="/setup/super-admin"
              data-testid="link-super-admin-setup"
              className="block w-full rounded-lg bg-emerald-500 px-4 py-3 text-center font-semibold text-slate-900 hover:bg-emerald-400 transition"
            >
              Set up this unit's super admin
            </Link>
          ) : (
            <button
              type="button"
              disabled
              data-testid="link-super-admin-setup"
              aria-disabled="true"
              className="block w-full rounded-lg bg-slate-800 px-4 py-3 text-center font-semibold text-slate-500 cursor-not-allowed"
            >
              Set up this unit's super admin
            </button>
          )}

          {joinButtonEnabled ? (
            <Link
              href="/join/setup"
              data-testid="link-join"
              className="block w-full rounded-lg bg-amber-500 px-4 py-3 text-center font-semibold text-slate-900 hover:bg-amber-400 transition"
            >
              Request to join this unit
            </Link>
          ) : (
            <button
              type="button"
              disabled
              data-testid="link-join"
              aria-disabled="true"
              className="block w-full rounded-lg bg-slate-800 px-4 py-3 text-center font-semibold text-slate-500 cursor-not-allowed"
            >
              Request to join this unit
            </button>
          )}
        </div>

        {cloud.kind === "loading" && (
          <p className="text-center text-[11px] text-slate-500">Checking cloud reachability…</p>
        )}
        {cloud.kind === "offline" && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-200">
            Cloud not reachable from this PC, or this build wasn't
            issued with a join secret. Both setup and join are disabled.
          </div>
        )}
        {cloud.kind === "needs-setup" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
            No super admin exists yet for this unit. You're allowed to
            bootstrap one from this PC. Once a super admin is set, this
            option locks; additional commanders must join via the
            normal request flow.
          </div>
        )}
        {cloud.kind === "ready" && cloud.superAdminExists && (
          <div className="rounded-md border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-400">
            A super admin already exists for this unit. Setup is locked.
            To join this unit, file a join request and wait for the
            existing super admin to approve it from their laptop.
          </div>
        )}
        {(cloud.kind === "needs-setup" || cloud.kind === "ready") && squadronCount === 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            This unit doesn't have any squadrons configured yet. The
            super admin must add at least one squadron before any other
            commander can request to join.
          </div>
        )}

        <p className="text-center text-[11px] text-slate-500">
          Joining will send a request to your unit's super admin. You'll
          stay on the next screen until it's approved.
        </p>
      </div>
    </div>
  );
}
