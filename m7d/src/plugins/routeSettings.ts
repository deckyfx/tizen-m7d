import { Elysia, t } from "elysia";
import type { SettingsStore } from "../services/settings-store";

/** An IPv4 address, or "" to clear the saved value. */
const IpField = t.Optional(t.String({ maxLength: 15 }));

/**
 * `/settings` (behind the token): the TV IP and this box's IP, editable from the dashboard.
 * Saved values override the environment; changing the TV IP drops connections to the old one.
 */
export const settingsPlugin = (settings: SettingsStore) =>
  new Elysia({ prefix: "/settings" })
    .get("/", () => settings.view())
    .put("/", ({ body }) => settings.update(body), {
      body: t.Object({
        tvHost: IpField,
        homelabIp: IpField,
        deviceIdleDays: t.Optional(t.Integer({ minimum: 0, maximum: 3650 })),
      }),
    });
