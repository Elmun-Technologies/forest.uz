import type { ReactNode } from 'react';

/**
 * Focused frame for checkout, login and the fake payment page: no store navigation, footer or
 * marketing overlays (design: Checkout, Kirish). Each page renders its own compact header.
 */
export default function FlowLayout({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
