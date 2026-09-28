import { ApiStatusCard } from "../components/api-status-card";

const STACK = [
  { name: "Next.js 16 (App Router)", role: "Frontend" },
  { name: "React 19", role: "UI runtime" },
  { name: "Tailwind CSS 4", role: "Styling" },
  { name: "Node.js + Express 5", role: "REST API" },
  { name: "PostgreSQL + Prisma", role: "Database" },
  { name: "Docker Compose", role: "Local orchestration" },
];

const PLANNED = [
  "JWT authentication for passengers and drivers",
  "Ride request, matching and tracking endpoints",
  "Role-aware passenger and driver dashboards",
  "End-to-end and unit test coverage",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-widest text-slate-500 uppercase">
          RoBenDevs
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          RoBen RidePool
        </h1>
        <p className="max-w-2xl text-lg text-slate-600">
          Shared urban mobility: passengers join a ride instead of paying for a
          whole car alone, and drivers earn more by filling empty seats. This
          page is the project placeholder while the MVP is being built.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <ApiStatusCard />

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Planned features
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {PLANNED.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true" className="text-slate-400">
                  &middot;
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Technology stack
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STACK.map((item) => (
            <div
              key={item.name}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <dt className="text-sm font-medium text-slate-900">{item.name}</dt>
              <dd className="text-xs text-slate-500">{item.role}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mt-auto border-t border-slate-200 pt-6 text-sm text-slate-500">
        RoBen RidePool &middot; Software Engineer Internship take-home project
      </footer>
    </main>
  );
}
