"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Detail, EmptyState, Panel, Pending, Select } from "../../../../components/ui";
import { Protected, useSession } from "../../../../hooks/use-session";
import {
  acceptRideRequest,
  declineRideRequest,
  listAvailableRideRequests,
  listPools,
} from "../../../../lib/api";
import {
  formatDateTime,
  formatDuration,
  formatPaisa,
  formatWindow,
  windowLengthMinutes,
} from "../../../../lib/format";

/**
 * The driver's matching queue: every waiting ride request, with accept and decline.
 *
 * Accepting needs a pool to accept into, so an open pool is chosen here first. The
 * list on its own is not filtered by that choice - the API offers all waiting
 * requests and refuses an incompatible one at accept time with a message saying
 * exactly why. Showing the pool's window next to each request is what lets a
 * driver tell the fits from the will-be-refused before trying.
 */
export default function RideQueuePage() {
  return (
    <Protected role="DRIVER">
      <RideQueue />
    </Protected>
  );
}

function RideQueue() {
  const { token } = useSession();

  const [pools, setPools] = useState([]);
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const [poolData, requestData] = await Promise.all([
        listPools(token),
        listAvailableRideRequests(token),
      ]);

      const openPools = poolData.pools.filter((pool) => pool.status === "OPEN");

      setPools(openPools);
      setRequests(requestData.rideRequests);

      // Default to the first open pool, so the accept button is usable without a
      // trip to the selector first. Only set when nothing is already chosen: a
      // driver who deliberately picked a pool keeps it across a refresh.
      setSelectedPoolId((current) => {
        if (current && openPools.some((pool) => pool.id === current)) return current;
        return openPools[0]?.id ?? "";
      });
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPool = pools.find((pool) => pool.id === selectedPoolId) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Ride queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Waiting requests, longest waited first. Accept one into a pool, or decline it.
        </p>
      </header>

      <Panel
        title="Accepting into"
        description="Only open pools can take members. A pool with no room or a window that does not overlap is refused by the API."
      >
        {pools.length === 0 ? (
          <EmptyState title="No open pools">
            <Link
              href="/dashboard/driver"
              className="underline underline-offset-2"
            >
              Open a pool
            </Link>{" "}
            first - a ride is accepted into a pool, not on its own.
          </EmptyState>
        ) : (
          <Select
            label="Pool"
            name="selectedPoolId"
            value={selectedPoolId}
            onChange={(event) => setSelectedPoolId(event.target.value)}
          >
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {formatWindow(pool.departureFrom, pool.departureTo)} —{" "}
                {pool.seatsAvailable} of {pool.vehicle.seatCapacity} free
              </option>
            ))}
          </Select>
        )}

        {selectedPool ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <Detail label="Departs">{formatDateTime(selectedPool.departureFrom)}</Detail>
            <Detail label="Vehicle">
              {selectedPool.vehicle.plateNumber} ({selectedPool.vehicle.model})
            </Detail>
            <Detail label="Seats free">
              {selectedPool.seatsAvailable} of {selectedPool.vehicle.seatCapacity}
            </Detail>
          </dl>
        ) : null}
      </Panel>

      <Panel
        title="Waiting requests"
        description="Requests you have declined are left out by the API."
        action={
          <Link
            href="/dashboard/driver"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
          >
            Your pools
          </Link>
        }
      >
        {isLoading ? <Pending label="Loading the queue" /> : null}

        {!isLoading && loadError ? (
          <Alert tone="error">
            {loadError}
            <button type="button" onClick={load} className="ml-2 underline underline-offset-2">
              Try again
            </button>
          </Alert>
        ) : null}

        <Alert tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>

        {!isLoading && !loadError && requests.length === 0 ? (
          <EmptyState title="Nothing waiting">
            New passenger requests will appear here.
          </EmptyState>
        ) : null}

        {!isLoading && !loadError && requests.length > 0 ? (
          <ul className="space-y-4">
            {requests.map((rideRequest) => (
              <RequestRow
                key={rideRequest.id}
                rideRequest={rideRequest}
                pool={selectedPool}
                onChanged={load}
                onNotice={setNotice}
              />
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}

/**
 * One waiting request, with the two decisions a driver can make about it.
 *
 * The overlap verdict is computed here for display only. The API re-checks it, and
 * it is the API that decides - this just avoids offering a driver a button that
 * is going to be refused, and explains the refusal before it happens.
 */
function RequestRow({ rideRequest, pool, onChanged, onNotice }) {
  const { token } = useSession();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(null);

  const requestMinutes = windowLengthMinutes(rideRequest.departureFrom, rideRequest.departureTo);

  const overlap =
    pool &&
    new Date(rideRequest.departureFrom) < new Date(pool.departureTo) &&
    new Date(pool.departureFrom) < new Date(rideRequest.departureTo);

  const fits = pool && overlap && rideRequest.seatsRequested <= pool.seatsAvailable;

  const decide = async (action, successMessage) => {
    setWorking(action);
    setError("");

    try {
      await action();
      onNotice(successMessage);
      onChanged();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {rideRequest.pickupArea} to {rideRequest.destinationArea}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {rideRequest.passenger.name} &middot;{" "}
            {rideRequest.seatsRequested} seat{rideRequest.seatsRequested === 1 ? "" : "s"} &middot;
            waiting since {formatDateTime(rideRequest.createdAt)}
          </p>
        </div>

        <p className="text-sm font-semibold text-slate-900">
          {formatPaisa(rideRequest.estimatedFarePaisa)}
        </p>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Detail label="Their departure window">
          {formatWindow(rideRequest.departureFrom, rideRequest.departureTo)}
          {requestMinutes > 0 ? (
            <span className="block text-xs text-slate-500">
              {formatDuration(requestMinutes)} of flexibility
            </span>
          ) : null}
        </Detail>

        <Detail label="Against your selected pool">
          {!pool ? (
            <span className="text-slate-500">No pool selected</span>
          ) : !overlap ? (
            <span className="text-rose-700">Windows do not overlap</span>
          ) : rideRequest.seatsRequested > pool.seatsAvailable ? (
            <span className="text-rose-700">
              Needs {rideRequest.seatsRequested}, {pool.seatsAvailable} free
            </span>
          ) : (
            <span className="text-emerald-700">Fits</span>
          )}
        </Detail>
      </dl>

      <div className="mt-4 space-y-3">
        <Alert tone="error" onDismiss={() => setError("")}>
          {error}
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button
            isLoading={working === "accept"}
            disabled={working !== null || !pool || !fits}
            onClick={() =>
              decide(
                () => acceptRideRequest(token, pool.id, rideRequest.id),
                "Ride accepted into your pool.",
              )
            }
          >
            {fits ? "Accept" : "Cannot accept"}
          </Button>

          <Button
            variant="secondary"
            isLoading={working === "decline"}
            disabled={working !== null}
            onClick={() =>
              decide(
                () => declineRideRequest(token, rideRequest.id),
                "Request declined. It stays available to other drivers.",
              )
            }
          >
            Decline
          </Button>
        </div>

        {!pool ? (
          <p className="text-xs text-slate-500">
            Open a pool to accept rides. Declining still works without one.
          </p>
        ) : null}
      </div>
    </li>
  );
}