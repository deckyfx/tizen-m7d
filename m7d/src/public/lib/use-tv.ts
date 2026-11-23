import { createContext, useContext } from "react";
import type { Api } from "./api";
import type { PollState } from "./use-poll";

/** TV status as returned by `GET /api/tv` (null before the first answer). */
export type TvState = Awaited<ReturnType<Api["api"]["tv"]["get"]>>["data"];

/** Live TV status shared by the sidebar, header and pages (polled once, every 5 s). */
export const TvContext = createContext<PollState<TvState> | undefined>(undefined);

/** Reads the shared TV status. */
export function useTv(): PollState<TvState> | undefined {
  return useContext(TvContext);
}

/** True when the TV answered on its REST API. */
export function isOnline(tv: TvState | undefined): boolean {
  return tv?.online === true;
}
