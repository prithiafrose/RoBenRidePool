"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Button,
  Detail,
  EmptyState,
  Field,
  Panel,
  PageHeader,
  Pending,
  StatusBadge,
} from "../../../components/ui";
import { Protected, useSession } from "../../../hooks/use-session";
import {
  createDriverProfile,
  createPool,
  getDriverProfile,
  listPools,
  setAvailability,
} from "../../../lib/api";
import {
  AVAILABILITY_LABELS,
  POOL_STATUS_LABELS,
  formatDateTime,
  formatDuration,
  formatPaisa,
  formatWindow,
  toApiInstant,
  windowLengthMinutes,
} from "../../../lib/format";

/**
 * The driver's home: onboard, go online, open a pool for a departure window, and
 * see the pools already open.
 *
 * Onboarding comes first and is not optional, because everything else needs the
 * profile and its vehicle: a pool belongs to a vehicle, and the API resolves both
 * from the profile rather than from anything the client sends. So the rest of the
 * page is gated behind `GET /api/driver-profile` succeeding.
 */
export default function DriverDashboard() {
  return (
    <Protected role="DRIVER">
      <DriverDashboardView />
    </Protected>
  );
}

function DriverDashboardView() {
  const { token } = useSession();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  /**
   * The pool list is held here rather than inside `PoolList`, so opening a pool
   * can refresh the same data the list shows. Reloading the whole document would
   * do it too, but it throws away the availability state and every other form on
   * the page to achieve a list refresh.
   */
  const [pools, setPools] = useState([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolsError, setPoolsError] = useState("");

  const loadProfile = useCallback(async () => {
    setLoadError("");

    try {
      const data = await getDriverProfile(token);
      setProfile(data.driverProfile);
    } catch (error) {
      // 404 is the API's "not onboarded yet", which is a state to render rather
      // than a failure, so it is handled below rather than shown as an error.
      if (error.status !== 404) {
        setLoadError(error.message);
      }

      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const loadPools = useCallback(async () => {
    setPoolsError("");

    try {
      const data = await listPools(token);
      setPools(data.pools);
    } catch (error) {
      setPoolsError(error.message);
    } finally {
      setPoolsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    // Only once there is a profile to own pools. The API rejects the list for a
    // driver who has not onboarded, so asking earlier would only produce an
    // error the page is not in a position to explain.
    if (profile) {
      loadPools();
    }
  }, [profile, loadPools]);

  if (isLoading) {
    return <Pending label="Loading your driver profile" />;
  }

  if (loadError) {
    return (
      <Alert tone="error">
        {loadError}
        <button type="button" onClick={loadProfile} className="ml-2 underline underline-offset-2">
          Try again
        </button>
      </Alert>
    );
  }

  if (!profile) {
    return <OnboardingForm onDone={loadProfile} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver overview"
        description="Open a pool for the hours you are driving, then fill it from the ride queue."
      />

      <AvailabilityPanel profile={profile} onChanged={loadProfile} />

      <PoolList
        pools={pools}
        isLoading={poolsLoading}
        error={poolsError}
        onRetry={loadPools}
      />

      <CreatePoolForm token={token} vehicle={profile.tesla} onCreated={loadPools} />
    </div>
  );
}

/* ----------------------------------------------------------------- onboarding --- */

function OnboardingForm({ onDone }) {
  const { token } = useSession();
  const [values, setValues] = useState({ plateNumber: "", model: "", seatCapacity: "4" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const change = (event) => {
    const { name, value } = event.target;

    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setFormError("");
  };

  const submit = async (event) => {
    event.preventDefault();

    setIsSaving(true);
    setFormError("");
    setErrors({});

    try {
      // The plate is normalised to upper case by the API, and the profile starts
      // OFFLINE - a driver chooses to come online themselves.
      await createDriverProfile(token, {
        plateNumber: values.plateNumber,
        model: values.model,
        seatCapacity: Number(values.seatCapacity),
      });

      onDone();
    } catch (error) {
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
      title="Set up your vehicle"
      description="One vehicle per driver. You will use it for every pool you open."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Plate number"
            name="plateNumber"
            placeholder="DHK-1234"
            value={values.plateNumber}
            onChange={change}
            error={errors.plateNumber}
            disabled={isSaving}
          />
          <Field
            label="Model"
            name="model"
            placeholder="Model 3"
            value={values.model}
            onChange={change}
            error={errors.model}
            disabled={isSaving}
          />
        </div>

        <Field
          label="Seat capacity"
          name="seatCapacity"
          type="number"
          min="1"
          value={values.seatCapacity}
          onChange={change}
          error={errors.seatCapacity}
          hint="Counts your own seat, so 4 means 3 passengers."
          disabled={isSaving}
        />

        <Alert>{formError}</Alert>

        <Button type="submit" isLoading={isSaving} disabled={isSaving}>
          Complete setup
        </Button>
      </form>
    </Panel>
  );
}

/* --------------------------------------------------------------- availability --- */

/**
 * The online/offline control.
 *
 * The API takes the target state rather than a toggle, so this sends an explicit
 * `ONLINE` or `OFFLINE`. That matters on a retry: a toggle would flip the wrong
 * way if the first request succeeded and the response was lost.
 */
function AvailabilityPanel({ profile, onChanged }) {
  const { token } = useSession();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const isOnline = profile.status === "ONLINE";
  const nextStatus = isOnline ? "OFFLINE" : "ONLINE";

  const change = async () => {
    setIsSaving(true);
    setError("");

    try {
      await setAvailability(token, nextStatus);
      onChanged();
    } catch (changeError) {
      setError(changeError.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Panel
      title="Availability"
      description="You start each session offline and decide when you are taking rides."
      action={
        <StatusBadge
          value={profile.status}
          label={AVAILABILITY_LABELS[profile.status] ?? profile.status}
        />
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Detail label="Vehicle">{profile.tesla.model}</Detail>
        <Detail label="Plate">{profile.tesla.plateNumber}</Detail>
        <Detail label="Seats">{profile.tesla.seatCapacity}</Detail>
      </dl>

      <div className="mt-4 space-y-3">
        <Alert tone="error" onDismiss={() => setError("")}>
          {error}
        </Alert>

        <Button
          variant={isOnline ? "secondary" : "primary"}
          isLoading={isSaving}
          disabled={isSaving}
          onClick={change}
        >
          Go {nextStatus.toLowerCase()}
        </Button>
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- pool list --- */

/** The pools this driver owns. Presentation only; the data comes from the page. */
function PoolList({ pools, isLoading, error, onRetry }) {
  return (
    <Panel title="Your pools" description="Each pool is one departure window for your car.">
      {isLoading ? <Pending label="Loading your pools" /> : null}

      {!isLoading && error ? (
        <Alert tone="error">
          {error}
          <button type="button" onClick={onRetry} className="ml-2 underline underline-offset-2">
            Try again
          </button>
        </Alert>
      ) : null}

      {!isLoading && !error && pools.length === 0 ? (
        <EmptyState title="No pools yet">
          Open one below with the hours you plan to drive.
        </EmptyState>
      ) : null}

      {!isLoading && !error && pools.length > 0 ? (
        <ul className="space-y-3">
          {pools.map((pool) => (
            <li
              key={pool.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {formatWindow(pool.departureFrom, pool.departureTo)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {pool.vehicle.plateNumber} &middot; {pool.seatsBooked} of{" "}
                  {pool.vehicle.seatCapacity} seats booked
                  {pool.seatsAvailable > 0
                    ? ` · ${pool.seatsAvailable} free`
                    : " · full"}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <StatusBadge
                  value={pool.status}
                  label={POOL_STATUS_LABELS[pool.status] ?? pool.status}
                />
                <Link
                  href={`/dashboard/driver/pools/${pool.id}`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
                >
                  Manage
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------ create a pool --- */

/**
 * Opens a pool for a departure window.
 *
 * The window is the only value sent. The API derives the driver, the vehicle and
 * the initial `OPEN` status from the authenticated profile, so there is nothing
 * here that could be forged even if these fields were added to the form.
 */
function CreatePoolForm({ token, vehicle, onCreated }) {
  const [values, setValues] = useState({ departureFrom: "", departureTo: "" });
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
      await createPool(token, {
        departureFrom: toApiInstant(values.departureFrom),
        departureTo: toApiInstant(values.departureTo),
      });

      setValues({ departureFrom: "", departureTo: "" });
      setNotice("Pool opened. Fill it from the ride queue.");
      onCreated();
    } catch (error) {
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
      title="Open a pool"
      description="A passenger whose own departure window overlaps yours can be accepted into it."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Depart from"
            name="departureFrom"
            type="datetime-local"
            value={values.departureFrom}
            onChange={change}
            error={errors.departureFrom}
            disabled={isSaving}
          />
          <Field
            label="Depart until"
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

        <p className="text-xs text-slate-500">
          Driving {vehicle.plateNumber} ({vehicle.seatCapacity} seats).
        </p>

        <Alert>{formError}</Alert>
        <Alert tone="success" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>

        <Button type="submit" isLoading={isSaving} disabled={isSaving}>
          Open pool
        </Button>
      </form>
    </Panel>
  );
}