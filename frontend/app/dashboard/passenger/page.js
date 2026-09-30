"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Button,
  Detail,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Pending,
  ScorePicker,
  StatusBadge,
} from "../../../components/ui";
import { Protected, useSession } from "../../../hooks/use-session";
import {
  cancelRideRequest,
  createRating,
  createRideRequest,
  listRideRequests,
} from "../../../lib/api";
import {
  REQUEST_STATUS_LABELS,
  formatDateTime,
  formatDuration,
  formatPaisa,
  formatWindow,
  toApiInstant,
  windowLengthMinutes,
} from "../../../lib/format";

/**
 * The passenger's side of the MVP: ask for a ride, watch it get matched, cancel
 * it while it is still waiting, and rate the driver afterwards.
 *
 * Every panel here maps to one endpoint. Nothing is shown optimistically - after
 * a write the list is re-read from the API, because the status a passenger cares
 * about most (`MATCHED`, `IN_PROGRESS`) is decided by the server and a client
 * guess would be the thing most likely to be wrong.
 */
export default function PassengerDashboard() {
  return (
    <Protected role="PASSENGER">
      <PassengerDashboardView />
    </Protected>
  );
}

function PassengerDashboardView() {
  const { token } = useSession();
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const data = await listRideRequests(token);
      setRequests(data.rideRequests);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My rides"
        description="Request a shared ride, then follow it until it is finished."
      />

      <RequestForm onCreated={load} />

      <Panel
        title="Your requests"
        description="Every ride you have asked for, newest first."
      >
        {isLoading ? <Pending label="Loading your rides" /> : null}

        {!isLoading && loadError ? (
          <Alert tone="error">
            {loadError}
            <button
              type="button"
              onClick={load}
              className="ml-2 underline underline-offset-2"
            >
              Try again
            </button>
          </Alert>
        ) : null}

        {!isLoading && !loadError && requests.length === 0 ? (
          <EmptyState title="No rides yet">
            Your first request will appear here with its status.
          </EmptyState>
        ) : null}

        {!isLoading && !loadError && requests.length > 0 ? (
          <ul className="space-y-4">
            {requests.map((rideRequest) => (
              <RequestCard key={rideRequest.id} rideRequest={rideRequest} onChanged={load} />
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------ request form --- */

const EMPTY_FORM = {
  pickupArea: "",
  destinationArea: "",
  seatsRequested: "1",
  departureFrom: "",
  departureTo: "",
};

function RequestForm({ onCreated }) {
  const { token } = useSession();
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const change = (event) => {
    const { name, value } = event.target;

    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setFormError("");
    setNotice("");
  };

  const lengthMinutes = windowLengthMinutes(values.departureFrom, values.departureTo);

  const submit = async (event) => {
    event.preventDefault();

    setIsSaving(true);
    setFormError("");
    setErrors({});

    try {
      // The fare is not sent: the API prices the ride. The instants are
      // converted from what the local-time input produced into the ISO string
      // with an explicit offset the API requires.
      const { rideRequest } = await createRideRequest(token, {
        pickupArea: values.pickupArea,
        destinationArea: values.destinationArea,
        seatsRequested: Number(values.seatsRequested),
        departureFrom: toApiInstant(values.departureFrom),
        departureTo: toApiInstant(values.departureTo),
      });

      setValues(EMPTY_FORM);
      setNotice(`Ride requested. Estimated fare ${formatPaisa(rideRequest.estimatedFarePaisa)}.`);
      onCreated();
    } catch (error) {
      // Field-level messages from the API are shown against their inputs; a
      // message with no field becomes a single alert above the form.
      if (error.details?.length) {
        setErrors(error.fieldErrors);
      } else {
        setFormError(error.message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Panel
      title="Request a ride"
      description="Tell us where and when. A driver whose own departure window overlaps yours can pick it up."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Pickup area"
            name="pickupArea"
            placeholder="Dhanmondi"
            value={values.pickupArea}
            onChange={change}
            error={errors.pickupArea}
            disabled={isSaving}
          />
          <Field
            label="Destination area"
            name="destinationArea"
            placeholder="Gulshan"
            value={values.destinationArea}
            onChange={change}
            error={errors.destinationArea}
            disabled={isSaving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Seats"
            name="seatsRequested"
            type="number"
            min="1"
            max="10"
            value={values.seatsRequested}
            onChange={change}
            error={errors.seatsRequested}
            disabled={isSaving}
          />
          <Field
            label="Earliest departure"
            name="departureFrom"
            type="datetime-local"
            value={values.departureFrom}
            onChange={change}
            error={errors.departureFrom}
            disabled={isSaving}
          />
          <Field
            label="Latest departure"
            name="departureTo"
            type="datetime-local"
            value={values.departureTo}
            onChange={change}
            error={errors.departureTo}
            hint={
              lengthMinutes !== null && lengthMinutes > 0
                ? `Window of ${formatDuration(lengthMinutes)}`
                : undefined
            }
            disabled={isSaving}
          />
        </div>

        <Alert>{formError}</Alert>
        <Alert tone="success">{notice}</Alert>

        <Button type="submit" isLoading={isSaving} disabled={isSaving}>
          Request ride
        </Button>
      </form>
    </Panel>
  );
}

/* -------------------------------------------------------------- one request --- */

/**
 * A single request.
 *
 * Which actions are offered follows the status, because the API enforces the same
 * order and offering a button that is always going to be refused would be worse
 * than not offering it: `WAITING` can be cancelled, `COMPLETED` can be rated, and
 * the states in between can be neither.
 */
function RequestCard({ rideRequest, onChanged }) {
  const { token } = useSession();
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const run = async (action, successMessage) => {
    setIsWorking(true);
    setActionError("");
    setNotice("");

    try {
      await action();
      setNotice(successMessage);
      onChanged();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setIsWorking(false);
    }
  };

  const canCancel = rideRequest.status === "WAITING";
  const canRate = rideRequest.status === "COMPLETED";

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {rideRequest.pickupArea} to {rideRequest.destinationArea}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {rideRequest.seatsRequested} seat{rideRequest.seatsRequested === 1 ? "" : "s"}
          </p>
        </div>

        <StatusBadge
          value={rideRequest.status}
          label={REQUEST_STATUS_LABELS[rideRequest.status] ?? rideRequest.status}
        />
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Detail label="Departure window">{formatWindow(rideRequest.departureFrom, rideRequest.departureTo)}</Detail>
        <Detail label="Requested">{formatDateTime(rideRequest.createdAt)}</Detail>
        <Detail label={canRate ? "Paid" : "Estimated fare"}>
          {formatPaisa(rideRequest.finalFarePaisa ?? rideRequest.estimatedFarePaisa)}
        </Detail>
      </dl>

      {rideRequest.pool ? (
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Your driver
          </p>
          <p className="mt-1 text-sm text-slate-900">
            {rideRequest.pool.driver ? rideRequest.pool.driver.name : "A driver"}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Leaves {formatDateTime(rideRequest.pool.departureFrom)}
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <Alert tone="error" onDismiss={() => setActionError("")}>
          {actionError}
        </Alert>
        <Alert tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>

        {canCancel ? (
          <Button
            variant="danger"
            isLoading={isWorking}
            disabled={isWorking}
            onClick={() =>
              run(
                () => cancelRideRequest(token, rideRequest.id),
                "Request cancelled.",
              )
            }
          >
            Cancel request
          </Button>
        ) : null}

        {canRate ? <RatingForm poolId={rideRequest.pool.id} token={token} onDone={onChanged} /> : null}
      </div>
    </li>
  );
}

/**
 * Rates the driver of a finished ride.
 *
 * Only `poolId` and `score` are sent. The API decides whether the caller was the
 * pool's driver or one of its passengers and scores the other side, which is why
 * this form has no field for who is being rated - a passenger rating a driver and
 * a driver rating a passenger post the identical body.
 */
function RatingForm({ poolId, token, onDone }) {
  const [score, setScore] = useState(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    setIsSaving(true);
    setError("");

    try {
      await createRating(token, poolId, score);
      onDone();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="mb-3 text-sm text-slate-700">
        This ride is complete. How was your driver?
      </p>

      <ScorePicker poolId={poolId} value={score} onChange={setScore} isLoading={isSaving} />

      <div className="mt-3 space-y-3">
        <Alert tone="error" onDismiss={() => setError("")}>
          {error}
        </Alert>

        <Button isLoading={isSaving} disabled={isSaving || score === null} onClick={submit}>
          Submit rating
        </Button>
      </div>
    </div>
  );
}
