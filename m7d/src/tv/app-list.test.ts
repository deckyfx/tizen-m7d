import { expect, test } from "bun:test";
import { parseAppList } from "./app-list";

/** Two records in the exact format printed by `sdb shell 0 vd_applist` on the M7. */
const SAMPLE = [
  "get app list...",
  "apps count: 2",
  "---------------------------------------------------------------------------------------------",
  "--------------app_id                                =111299001912-------------",
  "--------------app_title                             =YouTube-------------",
  "--------------app_version                           =2.1.513-------------",
  "--------------install_date                          =2024-05-05 14:17:23-------------",
  "--------------app_tizen_id                          =9Ur5IzDKqV.TizenYouTube-------------",
  "--------------type                                  =normal-------------",
  "--------------is_removable                          =1-------------",
  "---------------------------------------------------------------------------------------------",
  "---------------------------------------------------------------------------------------------",
  "--------------app_id                                =xvvl3S1TT1.TizenTubeStandalone-------------",
  "--------------app_title                             =TizenTube-------------",
  "--------------app_version                           =2.1.1-------------",
  "--------------app_tizen_id                          =xvvl3S1TT1.TizenTubeStandalone-------------",
  "--------------type                                  =user-------------",
  "--------------ambient_screen_support                =-------------",
  "---------------------------------------------------------------------------------------------",
].join("\r\n");

test("parses app ids, tizen ids and metadata", () => {
  const apps = parseAppList(SAMPLE);
  expect(apps).toHaveLength(2);
  expect(apps[0]).toEqual({
    appId: "111299001912",
    tizenId: "9Ur5IzDKqV.TizenYouTube",
    title: "YouTube",
    version: "2.1.513",
    type: "normal",
    installDate: "2024-05-05 14:17:23",
    removable: true,
  });
  expect(apps[1]?.tizenId).toBe("xvvl3S1TT1.TizenTubeStandalone");
  expect(apps[1]?.type).toBe("user");
});

test("returns no apps for empty output", () => {
  expect(parseAppList("")).toEqual([]);
});
