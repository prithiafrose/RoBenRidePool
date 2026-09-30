import Link from "next/link";

import { HomeRedirect } from "../components/home-redirect";

export const metadata = {
  title: "RoBen RidePool - share the ride, share the cost",
  description:
    "Passengers heading the same way share a ride with drivers who have empty seats. Cheaper than a car alone, and better paid than an empty seat.",
};

const STEPS = [
  {
    title: "Create your account",
    body: "Sign up as a passenger or a driver. Drivers add a vehicle and a seat count to get started.",
  },
  {
    title: "Post a ride, or fill your seats",
    body: "Passengers post where they need to go and when. Drivers see the waiting requests and accept the ones that fit their route.",
  },
  {
    title: "Ride together",
    body: "Everyone sees the same status once the pool fills, and rates each other after the ride is done.",
  },
];

const FOR_PASSENGERS = [
  "Pay a share of the fare instead of the whole car on your own.",
  "Post the trip you need and the time window you can travel in.",
  "See who you are riding with and when the ride is matched.",
];

const FOR_DRIVERS = [
  "Fill seats on trips you were already making.",
  "Accept only the requests that suit your route and your time.",
  "Rate your riders once a ride is completed.",
];

const primaryAction =
  "rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700";
const secondaryAction =
  "rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400";

export default function Home() {
  return (
    <main className="flex min-h-screen w-full flex-col">
      <HomeRedirect />

      <div className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight text-slate-900">
            RoBen<span className="text-slate-400">RidePool</span>
          </span>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              Sign in
            </Link>
            <Link href="/register" className={primaryAction}>
              Get started
            </Link>
          </div>
        </nav>
      </div>

      <section className="bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
          <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Shared urban mobility
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Share the ride. Share the cost.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-600">
            Most seats in a car are empty on any given trip. RoBen RidePool puts
            passengers going the same way together with drivers who have room, so
            a shared ride costs less than travelling alone and pays better than an
            empty seat.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/register" className={primaryAction}>
              Create an account
            </Link>
            <Link href="/login" className={secondaryAction}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-5xl px-6 py-20">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            How it works
          </h2>

          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-medium text-white">
                  {index + 1}
                </span>
                <h3 className="text-base font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-600">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-20 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
            <h2 className="text-lg font-semibold text-slate-900">
              If you are a passenger
            </h2>
            <ul className="mt-6 space-y-3">
              {FOR_PASSENGERS.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                  <span aria-hidden="true" className="text-slate-400">
                    &middot;
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/register" className={`mt-8 inline-block ${primaryAction}`}>
              Ride with us
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8">
            <h2 className="text-lg font-semibold text-slate-900">
              If you are a driver
            </h2>
            <ul className="mt-6 space-y-3">
              {FOR_DRIVERS.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                  <span aria-hidden="true" className="text-slate-400">
                    &middot;
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/register" className={`mt-8 inline-block ${secondaryAction}`}>
              Drive with us
            </Link>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>RoBen RidePool</p>
          <div className="flex gap-6">
            <Link href="/login" className="transition hover:text-slate-900">
              Sign in
            </Link>
            <Link href="/register" className="transition hover:text-slate-900">
              Create an account
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
