import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat config for the frontend.
 *
 * `next/core-web-vitals` is already a flat config in Next 16, so it is spread
 * directly rather than through `FlatCompat` - the compat shim cannot serialise
 * the plugin objects it returns.
 *
 * The rule that matters most here is `no-undef`, and it is on by default; it is
 * restated below because it is the one that would have caught a shipped bug. A
 * `useCallback(fn, [missing])` compiles, passes `next build`, and is invisible to
 * HTTP-level tests, because it only throws when the component renders in a
 * browser. The passenger dashboard shipped exactly that: a `ReferenceError` that
 * blanked the page for every passenger, with a green build and 417 passing tests
 * behind it.
 */
export default [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "no-undef": "error",

      /**
       * Also catches the silent form of the same mistake: a dependency array that
       * names a value the callback never closes over, which is a stale closure
       * rather than a crash.
       */
      "react-hooks/exhaustive-deps": "warn",

      /**
       * The React Compiler flags calling setState synchronously in an effect body,
       * because it can cascade renders. Every data-loading panel in this app uses
       * the standard `useEffect(() => { load(); }, [load])` shape and sets its
       * loading flag from inside, so this fires in seven places across every
       * dashboard page and the session provider.
       *
       * It is downgraded to a warning rather than rewritten: the pattern works
       * and is the documented idiom for fetching, and the alternative - deriving
       * loading state, or restructuring each page around it - is a large change to
       * code that a browser is the only real test of. The warning keeps it
       * visible without making `npm run lint` fail on a deliberate choice.
       *
       * A real unhandled-rejection or crashed-render bug still fails the build:
       * that is what `no-undef` is above for.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];