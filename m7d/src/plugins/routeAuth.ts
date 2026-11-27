import { Elysia, t } from "elysia";
import type { Auth } from "../auth/auth";
import { DEVICE_COOKIE, readCookie } from "../auth/auth";
import type { SettingsStore } from "../services/settings-store";

/** Name a browser gives itself ("Chrome on Windows"). */
const NameField = t.String({ maxLength: 60 });

/** Handlers' `set` (only the headers part is used). */
interface ResponseSet {
  headers: Record<string, string | number>;
}

/**
 * Public `/auth` routes: who am I, sign in with the token, ask for approval (and poll for it),
 * sign out. Everything else about devices needs a signed-in caller ({@link authAdminPlugin}).
 */
export const authPublicPlugin = (auth: Auth) =>
  new Elysia({ prefix: "/auth" })
    .get("/me", async ({ request, set }) => {
      const who = await auth.identify(request, (cookie) => {
        (set as ResponseSet).headers["set-cookie"] = cookie;
      });
      return {
        signedIn: who.kind !== "none",
        via: who.kind === "none" ? null : who.kind,
        device: who.kind === "device" ? who.device : null,
      };
    })
    .post(
      "/token",
      async ({ request, body, set, status }) => {
        const verdict = auth.checkToken(request, body.token);
        if (verdict === "locked") return status(429, { error: "Too many wrong tokens; wait 10 minutes", kind: "Locked" });
        if (verdict === "wrong") return status(401, { error: "Wrong token", kind: "Unauthorized" });
        const { device, cookie } = await auth.devices.create({
          name: body.name,
          userAgent: request.headers.get("user-agent") ?? "",
          ip: auth.clientIp(request),
          via: "token",
          ephemeral: !body.remember,
        });
        (set as ResponseSet).headers["set-cookie"] = auth.cookieHeader(request, cookie, !body.remember);
        return { device };
      },
      { body: t.Object({ token: t.String({ minLength: 1, maxLength: 256 }), name: NameField, remember: t.Boolean() }) },
    )
    .post(
      "/requests",
      ({ request, body }) =>
        auth.requests.open({
          name: body.name,
          userAgent: request.headers.get("user-agent") ?? "",
          ip: auth.clientIp(request),
          remember: body.remember,
        }),
      { body: t.Object({ name: NameField, remember: t.Boolean() }) },
    )
    .get(
      "/requests/:requestId",
      async ({ request, params, set }) => {
        const result = auth.requests.poll(params.requestId);
        if (result.status !== "approved" || !result.grant) return { status: result.status, device: null };
        const { device, cookie } = await auth.devices.create({
          name: result.grant.name,
          userAgent: result.grant.userAgent,
          ip: auth.clientIp(request),
          via: "approval",
          ephemeral: !result.grant.remember,
        });
        (set as ResponseSet).headers["set-cookie"] = auth.cookieHeader(request, cookie, !result.grant.remember);
        return { status: result.status, device };
      },
      { params: t.Object({ requestId: t.String({ minLength: 16, maxLength: 64 }) }) },
    )
    .post("/logout", async ({ request, set }) => {
      const id = readCookie(request.headers.get("cookie"), DEVICE_COOKIE)?.split(".")[0];
      // Only a valid cookie may forget its device (an unknown id is just cleared).
      const who = await auth.identify(request, () => {});
      if (id && who.kind === "device" && who.device.id === id) await auth.devices.revoke([id]);
      (set as ResponseSet).headers["set-cookie"] = auth.clearCookieHeader(request);
      return { signedOut: true as const };
    });

/** `/auth` routes for signed-in callers: remembered browsers and pending access requests. */
export const authAdminPlugin = (auth: Auth, settings: SettingsStore) =>
  new Elysia({ prefix: "/auth" })
    .get("/devices", async ({ request }) => {
      const who = await auth.identify(request, () => {});
      const currentId = who.kind === "device" ? who.device.id : null;
      return {
        idleDays: settings.deviceIdleDays,
        devices: auth.devices.list().map((device) => ({ ...device, current: device.id === currentId })),
      };
    })
    .patch(
      "/devices/:id",
      async ({ params, body, status }) =>
        (await auth.devices.rename(params.id, body.name))
          ? { renamed: true as const }
          : status(404, { error: "No such browser", kind: "NotFound" }),
      { params: t.Object({ id: t.String({ maxLength: 32 }) }), body: t.Object({ name: NameField }) },
    )
    .delete(
      "/devices/:id",
      async ({ params, status }) =>
        (await auth.devices.revoke([params.id])) > 0
          ? { removed: 1 }
          : status(404, { error: "No such browser", kind: "NotFound" }),
      { params: t.Object({ id: t.String({ maxLength: 32 }) }) },
    )
    .post("/devices/remove-others", async ({ request }) => {
      const who = await auth.identify(request, () => {});
      const keep = who.kind === "device" ? who.device.id : undefined;
      return { removed: await auth.devices.revoke("all", keep) };
    })
    .get("/pending", () => auth.requests.pending())
    .post(
      "/pending/:code/:decision",
      ({ params, status }) =>
        auth.requests.decide(params.code, params.decision === "approve")
          ? { decided: true as const }
          : status(404, { error: "That request is gone (expired or already decided)", kind: "NotFound" }),
      {
        params: t.Object({
          code: t.String({ pattern: "^[A-Z0-9]{2}-[A-Z0-9]{2}$" }),
          // Not t.UnionEnum (breaks under Bun.serve, see routeApi).
          decision: t.Union([t.Literal("approve"), t.Literal("deny")]),
        }),
      },
    );
