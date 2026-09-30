/**
 * Inline icon set.
 *
 * Hand-drawn rather than pulled from an icon package: the app needs about twenty
 * glyphs, and a dependency for that would be a larger supply-chain surface than
 * twenty short path strings. They are all 24x24, stroked with `currentColor` and
 * a 1.75 width, so an icon inherits the colour and weight of whatever it sits in
 * and the set reads as one family.
 */

const PATHS = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  queue: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h13" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5V18a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-4l2-5.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21.5 14v4a1 1 0 0 1-1 1H20a1 1 0 0 1-1-1v-1.5" />
      <path d="M2.5 14h19" />
      <path d="M6.5 16.5h11" />
      <circle cx="6.5" cy="16.5" r="1" />
      <circle cx="17.5" cy="16.5" r="1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6" />
      <path d="M17.5 14.4A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
      <circle cx="12" cy="10.2" r="2.6" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6.5L20 12l-6.5 5.5" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M20 12H5" />
      <path d="M10.5 6.5L4 12l6.5 5.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
      <path d="M5.6 5.4L3.5 13.5v4a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4l-2.1-8.1a2 2 0 0 0-1.9-1.4H7.5a2 2 0 0 0-1.9 1.4z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1.2" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
};

/**
 * Renders one icon by name.
 *
 * Decorative by default (`aria-hidden`), because every icon here sits beside a
 * text label or inside a labelled control. `title` is the escape hatch for the
 * rare icon-only button, and swaps in a `<title>` plus `role="img"` so it is
 * still announced.
 */
export function Icon({ name, className = "h-4 w-4", title }) {
  const path = PATHS[name];

  if (!path) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  );
}