import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { TEMPLATES } from "../../src/templates/registry.js";
it.each(TEMPLATES)(
  "$id metadata matches the actual manifest scope set and ships safe ignore rules",
  async (template) => {
    const folder = path.resolve(
      "templates",
      template.source.type === "local" ? template.source.directory : "",
    );
    const raw = JSON.parse(
        await fs.readFile(path.join(folder, template.manifestPath!), "utf8"),
      ),
      manifest = raw.manifest ?? raw;
    expect([...template.requiredScopes].sort()).toEqual(
      manifest.oauth_information.scopes.map((v: any) => v.scope).sort(),
    );
    const ignore = await fs.readFile(path.join(folder, ".gitignore"), "utf8");
    expect(await fs.readFile(path.join(folder, "gitignore"), "utf8")).toBe(
      ignore,
    );
    for (const name of [".claude/", ".idea/"]) expect(ignore).toContain(name);
  },
);
it("requests transcript-only RTMS and subscribes only to handled RTMS lifecycle events", async () => {
  const text = await fs.readFile(
    "templates/hitl-workplace-agent/0-app-manifest/app-manifest.json",
    "utf8",
  );
  const manifest = JSON.parse(text).manifest;
  for (const scope of manifest.oauth_information.scopes.map(
    (v: any) => v.scope,
  ))
    expect(scope).not.toMatch(
      /meeting_audio|meeting_video|meeting_screenshare|zcc_voice|cloud_recording|ai_companion:read:search/,
    );
  const events = manifest.features.event_subscription.events.flatMap(
    (v: any) => v.event_types,
  );
  expect(events).toContain("meeting.rtms_interrupted");
  expect(events).not.toContain("contact_center.voice_rtms_started");
});

it("enables HITL in-client OAuth and the SDK APIs needed to complete sign-in", async () => {
  const manifest = JSON.parse(await fs.readFile(
    "templates/hitl-workplace-agent/0-app-manifest/app-manifest.json", "utf8",
  )).manifest;
  const features = manifest.features.in_client_feature;
  expect(features.in_client_oauth.enable).toBe(true);
  expect(features.zoom_app_api.enable).toBe(true);
  expect(features.zoom_app_api.zoom_app_apis).toEqual(
    expect.arrayContaining(["authorize", "onAuthorized"]),
  );
});
