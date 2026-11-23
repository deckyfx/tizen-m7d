import { ListChecks } from "lucide-react";
import { errorMessage, type Api } from "../lib/api";
import { usePoll } from "../lib/use-poll";
import { JobCard, type Job } from "./JobCard";
import { EmptyState, Notice } from "./ui";

/** Props for {@link JobsView}. */
interface JobsViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** History of Apps2Samsung jobs (installs, updates, clean-ups), newest first, live. */
export function JobsView({ api, onMessage }: JobsViewProps) {
  const jobs = usePoll<Job[]>(async () => {
    const { data, error } = await api.api.a2s.jobs.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 1500);

  return (
    <section className="flex flex-col gap-4">
      {jobs.error && <Notice tone="danger">{jobs.error}</Notice>}
      {jobs.data?.length === 0 && (
        <EmptyState icon={ListChecks} title="No jobs yet">
          Installs, updates, restores and clean-ups show up here with their live logs.
        </EmptyState>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {jobs.data?.map((job, index) => (
          <JobCard
            key={job.id}
            api={api}
            job={job}
            expanded={index === 0 && (job.status === "running" || job.status === "queued")}
            onMessage={onMessage}
            onRetried={() => void jobs.reload()}
          />
        ))}
      </div>
    </section>
  );
}
