import { useEffect, useState } from "react";
import type { Job } from "../components/JobCard";
import type { Api } from "./api";

/**
 * Follows one job until it finishes (polls every second while queued/running).
 * Returns the latest snapshot, or undefined before the first answer.
 */
export function useJob(api: Api, initial: Job | undefined): Job | undefined {
  const [job, setJob] = useState<Job | undefined>(initial);

  useEffect(() => setJob(initial), [initial]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return undefined;
    const timer = setTimeout(async () => {
      const { data } = await api.api.a2s.jobs({ id: job.id }).get();
      if (data && "id" in data) setJob(data);
    }, 1000);
    return () => clearTimeout(timer);
  }, [api, job]);

  return job;
}
