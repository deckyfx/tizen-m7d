import { KeyRound, Tv } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field, fieldClass, Notice } from "./ui";

/** Props for {@link TokenForm}. */
interface TokenFormProps {
  onSubmit: (token: string) => void;
  error?: string;
}

/** One-time prompt for the m7d access token (from `.env` on the homelab). */
export function TokenForm({ onSubmit, error }: TokenFormProps) {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-sky-700 text-white">
            <Tv size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold">m7d</h1>
            <p className="text-sm text-slate-600">Smart Monitor M7 control</p>
          </div>
        </div>
        <Field label="Access token" hint="M7D_TOKEN in m7d/.env on the homelab. Remembered in this browser.">
          <input
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={fieldClass}
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" icon={KeyRound}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
