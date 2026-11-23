"use client";

import * as React from "react";

/**
 * Whether the content being rendered sits inside a section the parent
 * has completed, which the layout around it has locked.
 *
 * The lock itself is a `<fieldset disabled>`, and that switches off
 * every real form control inside it. It cannot switch off a widget
 * built from plain elements: a file dropzone is a focusable `div`, so
 * in a locked section it could still be reached with Tab and would
 * still take a pasted file and upload it. Such widgets read this and
 * disable themselves.
 *
 * A context rather than a prop because the lock is flipped by the
 * layout while the page inside it does not re-render; a context
 * consumer does.
 */
const SectionLockContext = React.createContext(false);

export function SectionLockProvider({
  locked,
  children,
}: {
  locked: boolean;
  children: React.ReactNode;
}) {
  return (
    <SectionLockContext.Provider value={locked}>
      {children}
    </SectionLockContext.Provider>
  );
}

/** True inside a locked section; false anywhere there is no lock. */
export function useSectionLocked(): boolean {
  return React.useContext(SectionLockContext);
}
