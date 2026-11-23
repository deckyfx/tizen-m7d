import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import type { A2sService } from "../a2s/a2s-service";
import type { JobRunner } from "../a2s/job-runner";
import { PolicyError } from "../lib/errors";

/** Services the Apps2Samsung routes need. */
export interface A2sDeps {
  a2s: A2sService;
  jobs: JobRunner;
  /** Directory uploaded packages are written to (must match the service's uploadDir). */
  uploadDir: string;
}

/** Largest package accepted for upload. */
const MAX_UPLOAD = "256m";

/**
 * `/a2s` routes: Apps2Samsung features (catalog, installed apps with updates, TV check,
 * certificates, sources, leftovers, profiles) and the job queue. Mounted inside the
 * authenticated API, so every route needs the bearer token.
 */
export const a2sPlugin = (deps: A2sDeps) =>
  new Elysia({ prefix: "/a2s" })
    // ---- Reads
    .get("/catalog", ({ query }) => deps.a2s.catalog(query.refresh === "1"), {
      query: t.Object({ refresh: t.Optional(t.String()) }),
    })
    .get("/installed", () => deps.a2s.installed())
    .get("/tv-check", () => deps.a2s.tvCheck())
    .get("/certificates", () => deps.a2s.certificates())
    .get("/sources", () => deps.a2s.sources())
    .post(
      "/sources",
      ({ body }) =>
        deps.a2s.addSource(body.link, {
          name: body.name,
          fingerprint: body.fingerprint,
        }),
      {
        body: t.Object({
          link: t.String({ minLength: 3, maxLength: 512 }),
          name: t.Optional(t.String({ maxLength: 80 })),
          fingerprint: t.Optional(t.String({ maxLength: 128 })),
        }),
      },
    )
    .post("/sources/remove", ({ body }) => deps.a2s.removeSource(body.source), {
      body: t.Object({ source: t.String({ minLength: 1, maxLength: 512 }) }),
    })
    .get("/leftovers", () => deps.a2s.leftovers())
    .get("/logs", () => deps.a2s.logs())
    .get(
      "/logs/:name",
      async ({ params }) =>
        new Response(await deps.a2s.logText(params.name), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      { params: t.Object({ name: t.String({ maxLength: 128 }) }) },
    )
    .get(
      "/signed/:id",
      async ({ params, status }) => {
        const path = deps.a2s.signedPath(params.id);
        const file = path ? Bun.file(path) : undefined;
        if (!file || !(await file.exists())) return status(404, { error: "Not signed yet", kind: "NotFound" });
        return new Response(file, {
          headers: { "content-disposition": `attachment; filename="signed-${params.id}"` },
        });
      },
      { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
    )
    .get("/profiles", () => deps.a2s.profiles())
    .get("/profiles/:name", ({ params }) => deps.a2s.profile(params.name), {
      params: t.Object({ name: t.String({ maxLength: 64 }) }),
    })

    // ---- Uploads (a local .wgt/.tpk, installed with a job afterwards)
    .post(
      "/upload",
      async ({ body }) => {
        const match = /\.(wgt|tpk)$/i.exec(body.file.name);
        if (!match?.[1]) return PolicyError.throw("Only .wgt and .tpk packages can be uploaded");
        const uploadId = `${crypto.randomUUID()}.${match[1].toLowerCase()}`;
        await mkdir(deps.uploadDir, { recursive: true });
        await Bun.write(join(deps.uploadDir, uploadId), body.file);
        return { uploadId, name: body.file.name, size: body.file.size };
      },
      { body: t.Object({ file: t.File({ maxSize: MAX_UPLOAD }) }) },
    )

    // ---- Jobs
    .get("/jobs", () => deps.jobs.list())
    .get(
      "/jobs/:id",
      ({ params, status }) =>
        deps.jobs.get(params.id) ?? status(404, { error: "No such job", kind: "NotFound" }),
      { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
    )
    .post("/jobs/:id/retry", ({ params }) => deps.a2s.retryAnyway(params.id), {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
    })
    .post(
      "/jobs/install",
      ({ body }) =>
        deps.a2s.install({
          app: body.app,
          file: body.file,
          settings: body.settings,
          partner: body.partner,
          from: body.from,
          launch: body.launch,
          allowRemove: body.allowRemove,
          removeFirst: body.removeFirst,
          newId: body.newId,
        }),
      {
        body: t.Object({
          app: t.String({ minLength: 1, maxLength: 256 }),
          file: t.Optional(t.String({ maxLength: 256 })),
          settings: t.Optional(t.Record(t.String({ maxLength: 64 }), t.String({ maxLength: 1024 }))),
          partner: t.Optional(t.Boolean()),
          from: t.Optional(t.String({ maxLength: 128 })),
          launch: t.Optional(t.Boolean()),
          allowRemove: t.Optional(t.Boolean()),
          removeFirst: t.Optional(t.Boolean()),
          newId: t.Optional(t.Boolean()),
        }),
      },
    )
    .post("/jobs/install-upload", ({ body }) => deps.a2s.installUpload(body.uploadId, body.label), {
      body: t.Object({
        uploadId: t.String({ maxLength: 64 }),
        label: t.String({ minLength: 1, maxLength: 256 }),
      }),
    })
    .post("/jobs/sign", ({ body }) => deps.a2s.sign(body.uploadId, body.label), {
      body: t.Object({
        uploadId: t.String({ maxLength: 64 }),
        label: t.String({ minLength: 1, maxLength: 256 }),
      }),
    })
    .post("/jobs/uninstall", ({ body }) => deps.a2s.uninstall(body.appId), {
      body: t.Object({ appId: t.String({ minLength: 1, maxLength: 256 }) }),
    })
    .post(
      "/jobs/update",
      ({ body }) => deps.a2s.update(body.apps && body.apps.length > 0 ? body.apps : "all"),
      { body: t.Object({ apps: t.Optional(t.Array(t.String({ maxLength: 256 }), { maxItems: 100 })) }) },
    )
    .post("/jobs/leftovers-clear", () => deps.a2s.clearLeftovers())
    .post("/jobs/leftovers-delete", ({ body }) => deps.a2s.deleteLeftover(body.file), {
      body: t.Object({ file: t.String({ minLength: 1, maxLength: 256 }) }),
    })
    .post("/jobs/profile-save", ({ body }) => deps.a2s.saveProfile(body.name, body.withSettings ?? false), {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 64 }),
        withSettings: t.Optional(t.Boolean()),
      }),
    })
    .post("/jobs/profile-restore", ({ body }) => deps.a2s.restoreProfile(body.name, body.apps ?? []), {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 64 }),
        apps: t.Optional(t.Array(t.String({ maxLength: 256 }), { maxItems: 100 })),
      }),
    });
