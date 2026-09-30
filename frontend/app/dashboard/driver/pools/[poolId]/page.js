"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Button,
  Detail,
  EmptyState,
  Panel,
  Pending,
  ScorePicker,
  StatusBadge,
} from "../../../../../components/ui";
import { Protected, useSession } from "../../../../../hooks/use-session";
import {
  completePool,
  createRating,
  getPool,
  startPool,
} from "../../../../../lib/api";
import {
  POOL_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  formatDateTime,
  formatPaisa,
  formatWindow,
} from "../../../../../lib/format";

/**
 * One pool, as the driver who owns it sees it: the window, the seats, the members
 * and the two lifecycle transitions.
 *
 * `GET /api/pools/:poolId` is scoped to the authenticated driver, so a foreign or
 * missing pool both answer 404 and this page cannot be used to probe for other
 * drivers' pools.
 *
 * The lifecycle buttons follow the pool status, because the API enforces the same
 * order and each button is offered only where the transition is legal: `OPEN` can
 * be started, `IN_PROGRESS` can be completed, and `COMPLETED` can be neither.
 */
export default function PoolDetailPage() {
  return (
    <Protected role="DRIVER">
      <PoolDetail />
    </Protected>
  );
}

function PoolDetail() {
  const { token } = useSession();
  const { poolId } = useParams();

  const [pool, setPool] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(null);

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const data = await getPool(token, poolId);
      setPool(data.pool);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token, poolId]);

  useEffect(() => {
    load();
  }, [load]);

  const transition = async (action, successMessage) => {
    setWorking(true);
    setActionError("");
    setNotice("");

    try {
      await action();
      setNotice(successMessage);
      load();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setWorking(false);
    }
  };

  if (isLoading) {
    return <Pending label="Loading pool" />;
  }

  if (loadError) {
    return (
      <Alert tone="error">
        {loadError}
        <button type="button" onClick={load} className="ml-2 underline underline-offset-2">
          Try again
        </button>
      </Alert>
    );
  }

  if (!pool) return null;

  const canStart = pool.status === "OPEN";
  const canComplete = pool.status === "IN_PROGRESS";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/driver" className="text-sm text-slate-600 underline underline-offset-2">
            Back to your pools
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {formatWindow(pool.departureFrom, pool.departureTo)}
          </h1>
        </div>

        <StatusBadge
          value={pool.status}
          label={POOL_STATUS_LABELS[pool.status] ?? pool.status}
        />
      </header>

      <Panel title="This ride">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Vehicle">
            {pool.vehicle.model}
            <span className="block text-xs text-slate-500">{pool.vehicle.plateNumber}</span>
          </Detail>
          <Detail label="Seats booked">
            {pool.seatsBooked} of {pool.vehicle.seatCapacity}
          </Detail>
          <Detail label="Seats free">{pool.seatsAvailable}</Detail>
          <Detail label="Opened">{formatDateTime(pool.createdAt)}</Detail>
        </dl>

        <div className="mt-5 space-y-3">
          <Alert tone="error" onDismiss={() => setActionError("")}>
            {actionError}
          </Alert>
          <Alert tone="success" onDismiss={() => setNotice("")}>
            {notice}
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Button
              isLoading={working === "start"}
              disabled={working !== null || !canStart}
              onClick={() => transition(() => startPool(token, pool.id), "Ride started.")}
            >
              Start ride
            </Button>

            <Button
              isLoading={working === "complete"}
              disabled={working !== null || !canComplete}
              onClick={() => transition(() => completePool(token, pool.id), "Ride completed. Fares settled.")}
            >
              Complete ride
            </Button>

            {pool.status === "OPEN" && pool.seatsAvailable > 0 ? (
              <Link
                href="/dashboard/driver/rides"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
              >
                Fill from the queue
              </Link>
            ) : null}
          </div>

          {!canStart && !canComplete ? (
            <p className="text-xs text-slate-500">
              This ride is {POOL_STATUS_LABELS[pool.status]?.toLowerCase() ?? pool.status}, so there is
              nothing left to start or complete.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Passengers"
        description="Everyone accepted into this pool, with the fare they owe."
      >
        {pool.members.length === 0 ? (
          <EmptyState title="No passengers yet">
            Accept a request from the ride queue to fill a seat.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {pool.members.map((member) => (
              <MemberRow key={member.id} member={member} poolId={pool.id} token={token} onRated={load} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * One passenger in this pool.
 *
 * The fare shown is the member's own allocation from the API, not a share of the
 * pool total: the fare each passenger owes was settled when the ride completed,
 * and re-deriving it here would risk showing a number that disagrees with the one
 * charged.
 */
function MemberRow({ member, poolId, token, onRated }) {
  const { rideRequest } = member;
  const [score, setScore] = useState(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canRate = rideRequest.status === "COMPLETED";

  const submitRating = async () => {
    setIsSaving(true);
    setError("");

    try {
      // Only `poolId` and `score`. The API knows this driver owns the pool, so it
      // scores each passenger without the client naming who.
      await createRating(token, poolId, score);
      setScore(null);
      onRated();
    } catch (ratingError) {
      setError(ratingError.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {rideRequest.passenger.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {rideRequest.pickupArea} to {rideRequest.destinationArea} &middot;{" "}
            {member.seats} seat{member.seats === 1 ? "" : "s"}
          </p>
        </div>

        <StatusBadge
          value={rideRequest.status}
          label={REQUEST_STATUS_LABELS[rideRequest.status] ?? rideRequest.status}
        />
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Detail label="Their window">
          {formatWindow(rideRequest.departureFrom, rideRequest.departureTo)}
        </Detail>
        <Detail label="Estimated">{formatPaisa(rideRequest.estimatedFarePaisa)}</Detail>
        <Detail label="Charged">{formatPaisa(rideRequest.finalFarePaisa)}</Detail>
      </dl>

      {canRate ? (
        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <p className="mb-3 text-sm text-slate-700">
            How was {rideRequest.passenger.name} as a passenger?
          </p>

          <ScorePicker
            poolId={`${poolId}-${member.id}`}
            value={score}
            onChange={setScore}
            isLoading={isSaving}
          />

          <div className="mt-3 space-y-3">
            <Alert tone="error" onDismiss={() => setError("")}>
              {error}
            </Alert>

            <Button
              isLoading={isSaving}
              disabled={isSaving || score === null}
              onClick={submitRating}
            >
              Submit rating
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}