import { createContext, useContext } from "react";

/** How the dashboard is presented and where it runs. */
export interface Layout {
  /** True when the page is shown on the TV itself (10-foot layout). */
  isTv: boolean;
  /** Tizen id of the app this page runs in when on the TV (the TV browser). */
  selfTizenId: string;
}

/** Layout shared by all components; defaults to the phone/desktop layout. */
export const LayoutContext = createContext<Layout>({
  isTv: false,
  selfTizenId: "org.tizen.browser",
});

/** Reads the current {@link Layout}. */
export function useLayout(): Layout {
  return useContext(LayoutContext);
}
