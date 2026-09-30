/**
 * End-to-end walkthrough of the MVP, driven exactly as the frontend drives it.
 *
 * Every call below corresponds to a button or form on one of the dashboards, in
 * the order a real user would press them. Its purpose is to check the flows
 * across roles on a live server, which the unit suites cannot do: that a
 * passenger's status change is visible to the driver and back, that a decline
 * does not close the request to everyone, and that the pool detail a driver sees
 * agrees with the request a passenger sees.
 *
 * Run against a live API:  node scripts/e2e-mvp.mjs
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5000";

const stamp = Date.now();
const results = [];

const call = async (method, path, { token, body } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => null);

  return { status: response.status, body: payload };
};

/** Records one step so the run ends with a readable trace of what happened. */
const step = async (label, action, expectation) => {
  try {
    const outcome = await action();
    const passed = expectation(outcome);

    results.push({ label, passed, detail: passed ? "" : describe(outcome) });

    console.log(`${passed ? "PASS" : "FAIL"}  ${label}${passed ? "" : ` -> ${describe(outcome)}`}`);
  } catch (error) {
    results.push({ label, passed: false, detail: error.message });
    console.log(`FAIL  ${label} -> ${error.message}`);
  }
};

const describe = (outcome) =>
  `${outcome.status} ${JSON.stringify(outcome.body?.message ?? outcome.body?.details ?? "")}`;

const expect = (status) => (outcome) => outcome.status === status;

/** The instant pair the forms produce: UTC ISO strings, an hour into the future. */
const window = (hoursFromNow, hours) => {
  const from = new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

  return {
    departureFrom: from,
    departureTo: new Date(new Date(from).getTime() + hours * 3_600_000).toISOString(),
  };
};

/* ------------------------------------------------------------ registration --- */

await step("register passenger", async () => {
  const result = await call("POST", "/api/auth/register", {
    body: {
      name: "Nusrat Jahan",
      email: `e2e-passenger-${stamp}@example.com`,
      password: "password123",
      role: "PASSENGER",
    },
  });

  if (result.status === 201) globalThis.passengerToken = result.body.data.token;

  return result;
}, expect(201));

await step("register driver", async () => {
  const result = await call("POST", "/api/auth/register", {
    body: {
      name: "Rafiq Islam",
      email: `e2e-driver-${stamp}@example.com`,
      password: "password123",
      role: "DRIVER",
    },
  });

  if (result.status === 201) globalThis.driverToken = result.body.data.token;

  return result;
}, expect(201));

await step("register a second driver", () =>
  call("POST", "/api/auth/register", {
    body: {
      name: "Second Driver",
      email: `e2e-driver2-${stamp}@example.com`,
      password: "password123",
      role: "DRIVER",
    },
  }).then((result) => {
    if (result.status === 201) globalThis.secondDriverToken = result.body.data.token;
    return result;
  }), expect(201));

/* ------------------------------------------------------- driver onboarding --- */

await step("driver reads own profile before onboarding (404, renders the form)", () =>
  call("GET", "/api/driver-profile", { token: globalThis.driverToken }), expect(404));

await step("driver onboards with a vehicle", () =>
  call("POST", "/api/driver-profile", {
    token: globalThis.driverToken,
    body: { plateNumber: `E2E-${stamp}`, model: "Model 3", seatCapacity: 4 },
  }), expect(201));

await step("driver reads own profile after onboarding", () =>
  call("GET", "/api/driver-profile", { token: globalThis.driverToken }), expect(200));

await step("second driver onboards", () =>
  call("POST", "/api/driver-profile", {
    token: globalThis.secondDriverToken,
    body: { plateNumber: `E2E2-${stamp}`, model: "Model Y", seatCapacity: 4 },
  }), expect(201));

await step("a passenger is refused the driver profile (403)", () =>
  call("GET", "/api/driver-profile", { token: globalThis.passengerToken }), expect(403));

/* ------------------------------------------------------------- availability --- */

await step("driver comes online", () =>
  call("POST", "/api/availability", {
    token: globalThis.driverToken,
    body: { status: "ONLINE" },
  }), expect(200));

/* ------------------------------------------------------------------- pools --- */

let poolId;

await step("driver opens a pool with a departure window", () =>
  call("POST", "/api/pools", {
    token: globalThis.driverToken,
    body: window(24, 3),
  }).then((result) => {
    if (result.status === 201) poolId = result.body.data.pool.id;
    return result;
  }), expect(201));

await step("a pool cannot be opened with a window in the past (400)", () =>
  call("POST", "/api/pools", {
    token: globalThis.driverToken,
    body: {
      departureFrom: new Date(Date.now() - 7_200_000).toISOString(),
      departureTo: new Date(Date.now() + 3_600_000).toISOString(),
    },
  }), expect(400));

await step("driver lists their pools", () =>
  call("GET", "/api/pools", { token: globalThis.driverToken }), expect(200));

/* ---------------------------------------------------------- the ride request --- */

let rideRequestId;

await step("passenger requests a ride", () =>
  call("POST", "/api/ride-requests", {
    token: globalThis.passengerToken,
    body: {
      pickupArea: "Dhanmondi",
      destinationArea: "Gulshan",
      seatsRequested: 1,
      ...window(24, 3),
    },
  }).then((result) => {
    if (result.status === 201) rideRequestId = result.body.data.rideRequest.id;
    return result;
  }), expect(201));

await step("the passenger sees no pool while it is waiting", async () => {
  const result = await call("GET", `/api/ride-requests/${rideRequestId}`, {
    token: globalThis.passengerToken,
  });

  return result.status === 200 && result.body.data.rideRequest.pool === null
    ? { status: 200 }
    : result;
}, expect(200));

/* ----------------------------------------------------------- driver matches --- */

await step("the request appears in the driver's queue", async () => {
  const result = await call("GET", "/api/ride-requests/available", {
    token: globalThis.driverToken,
  });

  const found =
    result.status === 200 &&
    result.body.data.rideRequests.some((r) => r.id === rideRequestId);

  return found ? { status: 200 } : result;
}, expect(200));

await step("a passenger is refused the driver's queue (403)", () =>
  call("GET", "/api/ride-requests/available", { token: globalThis.passengerToken }), expect(403));

await step("a driver cannot accept into a disjoint window (409, naming the windows)", async () => {
  const disjoint = await call("POST", "/api/pools", {
    token: globalThis.secondDriverToken,
    body: window(72, 2),
  });

  if (disjoint.status !== 201) return disjoint;

  const result = await call("POST", `/api/pools/${disjoint.body.data.pool.id}/members`, {
    token: globalThis.secondDriverToken,
    body: { rideRequestId },
  });

  if (result.status !== 409) return result;

  // Asserted on the message as well as the status, because a 409 alone is also
  // the answer for "already matched" or "the pool is full" - so the status proves
  // nothing about *why*. Thrown rather than returned, since `expect(409)` would
  // otherwise be satisfied by the very response this step is questioning.
  if (!/window/i.test(result.body?.message ?? '')) {
    throw new Error(`409 did not name the window: ${JSON.stringify(result.body?.message)}`);
  }

  return { status: 409 };
}, expect(409));

await step("a nonexistent ride request cannot be accepted (404)", () =>
  call("POST", `/api/pools/${poolId}/members`, {
    token: globalThis.driverToken,
    body: { rideRequestId: "3f1a0c1e-0000-4000-8000-000000000000" },
  }), expect(404));

await step("the driver accepts the request", () =>
  call("POST", `/api/pools/${poolId}/members`, {
    token: globalThis.driverToken,
    body: { rideRequestId },
  }), expect(201));

await step("the passenger now sees the matched pool and driver name", async () => {
  const result = await call("GET", `/api/ride-requests/${rideRequestId}`, {
    token: globalThis.passengerToken,
  });

  const matched =
    result.status === 200 &&
    result.body.data.rideRequest.status === "MATCHED" &&
    result.body.data.rideRequest.pool?.driver?.name === "Rafiq Islam";

  return matched ? { status: 200 } : result;
}, expect(200));

await step("the request has left the driver's queue", async () => {
  const result = await call("GET", "/api/ride-requests/available", {
    token: globalThis.driverToken,
  });

  const gone =
    result.status === 200 &&
    !result.body.data.rideRequests.some((r) => r.id === rideRequestId);

  return gone ? { status: 200 } : result;
}, expect(200));

await step("a matched request cannot be accepted twice (409)", () =>
  call("POST", `/api/pools/${poolId}/members`, {
    token: globalThis.driverToken,
    body: { rideRequestId },
  }), expect(409));

/* ------------------------------------------------------------------ decline --- */

let secondRequestId;

await step("passenger requests a second ride", () =>
  call("POST", "/api/ride-requests", {
    token: globalThis.passengerToken,
    body: {
      pickupArea: "Banani",
      destinationArea: "Uttara",
      seatsRequested: 1,
      ...window(48, 2),
    },
  }).then((result) => {
    if (result.status === 201) secondRequestId = result.body.data.rideRequest.id;
    return result;
  }), expect(201));

await step("the driver declines it", () =>
  call("POST", `/api/ride-requests/${secondRequestId}/decline`, {
    token: globalThis.driverToken,
  }), expect(201));

await step("the second driver still sees the declined request", async () => {
  const result = await call("GET", "/api/ride-requests/available", {
    token: globalThis.secondDriverToken,
  });

  const stillThere =
    result.status === 200 &&
    result.body.data.rideRequests.some((r) => r.id === secondRequestId);

  return stillThere ? { status: 200 } : result;
}, expect(200));

await step("the declining driver does not see it again", async () => {
  const result = await call("GET", "/api/ride-requests/available", {
    token: globalThis.driverToken,
  });

  const filteredOut =
    result.status === 200 &&
    !result.body.data.rideRequests.some((r) => r.id === secondRequestId);

  return filteredOut ? { status: 200 } : result;
}, expect(200));

await step("declining twice is a 409", () =>
  call("POST", `/api/ride-requests/${secondRequestId}/decline`, {
    token: globalThis.driverToken,
  }), expect(409));

await step("the passenger's request is still WAITING after a decline", async () => {
  const result = await call("GET", `/api/ride-requests/${secondRequestId}`, {
    token: globalThis.passengerToken,
  });

  return result.status === 200 && result.body.data.rideRequest.status === "WAITING"
    ? { status: 200 }
    : result;
}, expect(200));

await step("the second driver accepts what the first declined", async () => {
  const pool = await call("POST", "/api/pools", {
    token: globalThis.secondDriverToken,
    body: window(48, 2),
  });

  if (pool.status !== 201) return pool;

  return call("POST", `/api/pools/${pool.body.data.pool.id}/members`, {
    token: globalThis.secondDriverToken,
    body: { rideRequestId: secondRequestId },
  });
}, expect(201));

/* ----------------------------------------------------------------- cancel --- */

await step("a matched request can no longer be cancelled (409)", () =>
  call("PATCH", `/api/ride-requests/${rideRequestId}/cancel`, {
    token: globalThis.passengerToken,
  }), expect(409));

/* --------------------------------------------------------------- lifecycle --- */

await step("the driver sees the passenger in the pool detail", async () => {
  const result = await call("GET", `/api/pools/${poolId}`, {
    token: globalThis.driverToken,
  });

  const member =
    result.status === 200 &&
    result.body.data.pool.members.length === 1 &&
    result.body.data.pool.members[0].rideRequest.passenger.name === "Nusrat Jahan";

  return member ? { status: 200 } : result;
}, expect(200));

await step("another driver is refused the pool detail (404)", () =>
  call("GET", `/api/pools/${poolId}`, { token: globalThis.secondDriverToken }), expect(404));

await step("an OPEN pool cannot be completed (409)", () =>
  call("PATCH", `/api/pools/${poolId}/complete`, {
    token: globalThis.driverToken,
  }), expect(409));

await step("the driver starts the ride", () =>
  call("PATCH", `/api/pools/${poolId}/start`, { token: globalThis.driverToken }), expect(200));

await step("the passenger sees IN_PROGRESS", async () => {
  const result = await call("GET", `/api/ride-requests/${rideRequestId}`, {
    token: globalThis.passengerToken,
  });

  return result.status === 200 && result.body.data.rideRequest.status === "IN_PROGRESS"
    ? { status: 200 }
    : result;
}, expect(200));

await step("the driver completes the ride", () =>
  call("PATCH", `/api/pools/${poolId}/complete`, { token: globalThis.driverToken }), expect(200));

await step("the passenger sees COMPLETED with a settled fare", async () => {
  const result = await call("GET", `/api/ride-requests/${rideRequestId}`, {
    token: globalThis.passengerToken,
  });

  const ride = result.body?.data?.rideRequest;
  const ok = ride?.status === "COMPLETED" && ride.finalFarePaisa > 0;

  return ok ? { status: 200 } : result;
}, expect(200));

/* ----------------------------------------------------------------- ratings --- */

await step("the passenger rates the driver", () =>
  call("POST", "/api/ratings", {
    token: globalThis.passengerToken,
    body: { poolId, score: 5 },
  }), expect(201));

await step("the driver rates the passenger", () =>
  call("POST", "/api/ratings", {
    token: globalThis.driverToken,
    body: { poolId, score: 4 },
  }), expect(201));

await step("rating the same person twice is a 409", () =>
  call("POST", "/api/ratings", {
    token: globalThis.passengerToken,
    body: { poolId, score: 3 },
  }), expect(409));

await step("a rating for a nonexistent pool is refused (404)", () =>
  call("POST", "/api/ratings", {
    token: globalThis.passengerToken,
    body: { poolId: "3f1a0c1e-0000-4000-8000-000000000000", score: 5 },
  }), expect(404));

/* ---------------------------------------------------------------- summary --- */

const failed = results.filter((result) => !result.passed);

console.log(
  `\n${results.length - failed.length}/${results.length} steps passed` +
    (failed.length ? `\n\nFailed:\n${failed.map((f) => `  - ${f.label}: ${f.detail}`).join("\n")}` : ""),
);

process.exit(failed.length ? 1 : 0);