import { FileText, Rocket, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { errorMessage, type Api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useJob } from "../lib/use-job";
import { JobCard, type Job } from "./JobCard";
import { Button, Card } from "./ui";

/** Props for {@link UploadView}. */
interface UploadViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** "Install a file": upload a local .wgt/.tpk to the homelab, then install it on the TV. */
export function UploadView({ api, onMessage }: UploadViewProps) {
  const [file, setFile] = useState<File | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [started, setStarted] = useState<Job | undefined>(undefined);
  const job = useJob(api, started);
  const busy = uploading || job?.status === "queued" || job?.status === "running";

  const install = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    const upload = await api.api.a2s.upload.post({ file });
    setUploading(false);
    if (upload.error) return onMessage(errorMessage(upload.error), true);
    const { data, error } = await api.api.a2s.jobs["install-upload"].post({
      uploadId: upload.data.uploadId,
      label: upload.data.name,
    });
    if (error) onMessage(errorMessage(error), true);
    else setStarted(data);
  };

  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <Card
        title="Package file"
        icon={Upload}
        description="Signed with this TV’s certificate and installed like a catalog app. Failed pre-install checks can be overridden with “Retry anyway”."
      >
        <form onSubmit={install} className="flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-sky-500 hover:bg-sky-50">
            <Upload size={28} className="text-slate-500" aria-hidden="true" />
            <span className="font-medium text-slate-800">{file ? file.name : "Choose a .wgt or .tpk file"}</span>
            <span className="text-xs text-slate-600">
              {file ? formatBytes(file.size) : "From this device; it is uploaded to the homelab first"}
            </span>
            <input
              type="file"
              accept=".wgt,.tpk"
              onChange={(event) => setFile(event.target.files?.[0])}
              className="sr-only"
            />
          </label>
          <Button type="submit" variant="primary" size="lg" icon={Rocket} busy={busy} disabled={!file}>
            {uploading ? "Uploading…" : busy ? "Installing…" : "Install on TV"}
          </Button>
        </form>
      </Card>
      {job ? (
        <JobCard api={api} job={job} expanded onMessage={onMessage} onRetried={setStarted} />
      ) : (
        <Card title="Progress" icon={FileText} description="The install log appears here once you start." />
      )}
    </section>
  );
}
