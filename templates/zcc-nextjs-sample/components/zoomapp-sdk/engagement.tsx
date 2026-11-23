"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import zoomSdk from "@zoom/appssdk";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";

type EngagementStatusState = "start" | "hold" | "resume" | "end" | string;

type EngagementContextPayload = {
  engagementContext: {
    engagementId: string;
    queueName?: string;
  };
};

type EngagementStatusPayload = {
  engagementStatus: {
    state: EngagementStatusState;
  };
};

const DISPOSITIONS = [
  { value: "resolved", label: "Resolved" },
  { value: "follow-up-needed", label: "Follow-up needed" },
  { value: "escalated", label: "Escalated" },
];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const FOLLOW_UP_ACTIONS = [
  { value: "send-summary", label: "Send a summary" },
  { value: "schedule-callback", label: "Schedule a callback" },
  { value: "create-ticket", label: "Create a support ticket" },
];

type FormData = {
  text: string;
  date: string;
  contactMethod: "email" | "phone" | "";
  disposition: string;
  priority: string;
  followUpActions: string[];
};

const DEFAULT_FORM: FormData = {
  text: "",
  date: "",
  contactMethod: "",
  disposition: "",
  priority: "",
  followUpActions: [],
};

const isBrowser = typeof window !== "undefined";
const storageKey = (id: string) => `zcc-engagement:${id}`;

export default function Engagement() {
  const [engagementId, setEngagementId] = useState<string>("");
  const [engagementStatus, setEngagementStatus] = useState<EngagementStatusState>("");
  const [engagementContext, setEngagementContext] = useState<string>("");
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState("");
  const [contextUnavailable, setContextUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState("");
  const [storageStatus, setStorageStatus] = useState<"idle" | "saved" | "cleared" | "unavailable">("idle");
  const [activity, setActivity] = useState<Array<{ id: number; time: string; title: string; detail: string }>>([]);
  const [rawContext, setRawContext] = useState<unknown>(null);
  const [rawStatus, setRawStatus] = useState<unknown>(null);
  const engagementRef = useRef("");
  const contextSequence = useRef(0);
  const statusSequence = useRef(0);
  const activitySequence = useRef(0);

  // Subscribe before the initial read so an event cannot be overwritten by an older snapshot.
  useEffect(() => {
    let cancelled = false;
    let subscribed = false;
    setSdkReady(false);
    setSdkError("");
    const record = (title: string, detail: string) => {
      if (cancelled) return;
      const entry = { id: ++activitySequence.current, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), title, detail };
      setActivity(previous => [entry, ...previous].slice(0, 30));
    };
    const applyContext = (payload: EngagementContextPayload, resetStatus = true) => {
      const id = payload?.engagementContext?.engagementId ?? "";
      if (engagementRef.current !== id && resetStatus) {
        setEngagementStatus("");
        setRawStatus(null);
      }
      setCopied("");
      engagementRef.current = id;
      setEngagementId(id);
      setEngagementContext(payload?.engagementContext?.queueName ?? "");
      setRawContext(payload);
      setContextUnavailable(false);
    };
    const onContextChange = (payload: EngagementContextPayload) => {
      if (cancelled) return;
      contextSequence.current++;
      statusSequence.current++;
      applyContext(payload);
      record("Engagement context changed", payload?.engagementContext?.engagementId ? "Context received for the current engagement." : "Waiting for the next engagement.");
    };
    const onStatusChange = (payload: EngagementStatusPayload) => {
      if (cancelled) return;
      statusSequence.current++;
      const state = payload?.engagementStatus?.state ?? "";
      setEngagementStatus(state);
      setRawStatus(payload);
      record("Engagement status changed", state ? "Status is now " + state + "." : "Zoom sent a status update.");
      if (state === "end" && engagementRef.current) {
        try { localStorage.removeItem(storageKey(engagementRef.current)); setStorageStatus("cleared"); }
        catch { setStorageStatus("unavailable"); }
        setFormData(DEFAULT_FORM);
      }
    };
    const init = async () => {
      try {
        if (typeof zoomSdk?.config !== "function") throw new Error("SDK unavailable");
        await zoomSdk.config({
          capabilities: ["getEngagementContext", "getEngagementStatus", "onEngagementContextChange", "onEngagementStatusChange"],
        });
        if (cancelled) return;
        zoomSdk.addEventListener("onEngagementContextChange", onContextChange);
        zoomSdk.addEventListener("onEngagementStatusChange", onStatusChange);
        subscribed = true;
        setSdkReady(true);
        record("Zoom Apps SDK connected", "Listening for engagement context and status events.");
        const contextVersion = contextSequence.current;
        const statusVersion = statusSequence.current;
        const [context, status] = await Promise.allSettled([
          zoomSdk.callZoomApi("getEngagementContext") as Promise<EngagementContextPayload>,
          zoomSdk.callZoomApi("getEngagementStatus") as Promise<EngagementStatusPayload>,
        ]);
        if (cancelled) return;
        if (contextSequence.current === contextVersion) {
          if (context.status === "fulfilled") applyContext(context.value, statusSequence.current === statusVersion);
          else setContextUnavailable(true);
        }
        if (status.status === "fulfilled" && statusSequence.current === statusVersion && contextSequence.current === contextVersion) {
          setEngagementStatus(status.value?.engagementStatus?.state ?? "");
          setRawStatus(status.value);
        }
        if (contextSequence.current === contextVersion && context.status === "fulfilled" && context.value?.engagementContext?.engagementId) {
          record("Engagement loaded", "Initial engagement context received from Zoom.");
        }
      } catch {
        if (!cancelled) {
          setSdkReady(false);
          setSdkError("The Zoom Apps SDK could not connect. Open this sample inside Zoom Contact Center, then try again.");
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
      if (subscribed) {
        zoomSdk.removeEventListener("onEngagementContextChange", onContextChange);
        zoomSdk.removeEventListener("onEngagementStatusChange", onStatusChange);
      }
    };
  }, [retry]);

  // Local storage
  const initialForm = useMemo<FormData>(() => DEFAULT_FORM, []);
  const [formData, setFormData] = useState<FormData>(initialForm);

  const loadFromStorage = useCallback((id: string) => {
    if (!isBrowser || !id) return DEFAULT_FORM;
    try {
      const raw = localStorage.getItem(storageKey(id));
      if (!raw) return DEFAULT_FORM;
      const parsed = JSON.parse(raw) as Partial<FormData>;
      return {
        text: parsed.text ?? "",
        date: parsed.date ?? "",
        contactMethod: (parsed.contactMethod as FormData["contactMethod"]) ?? "",
        disposition: DISPOSITIONS.some(option => option.value === parsed.disposition) ? parsed.disposition! : "",
        priority: PRIORITIES.includes(parsed.priority ?? "") ? parsed.priority! : "",
        followUpActions: Array.isArray(parsed.followUpActions)
          ? parsed.followUpActions.filter(value => FOLLOW_UP_ACTIONS.some(option => option.value === value)) : [],
      } satisfies FormData;
    } catch {
      return DEFAULT_FORM;
    }
  }, []);

  const persistToStorage = useCallback(
    (id: string, patch: Partial<FormData>) => {
      if (!isBrowser || !id) return;
      try {
        const current = loadFromStorage(id);
        const next = { ...current, ...patch };
        localStorage.setItem(storageKey(id), JSON.stringify(next));
        setStorageStatus("saved");
      } catch {
        setStorageStatus("unavailable");
      }
    },
    [loadFromStorage]
  );

  const handleChange = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      if (!engagementId || engagementStatus === "end") return;
      setFormData(previous => ({ ...previous, [field]: value }));
      persistToStorage(engagementId, { [field]: value } as Partial<FormData>);
    },
    [engagementId, engagementStatus, persistToStorage]
  );

  const handleFollowUpToggle = useCallback(
    (value: string, checked: boolean) => {
      if (!engagementId || engagementStatus === "end") return;
      const followUpActions = checked
        ? Array.from(new Set([...formData.followUpActions, value]))
        : formData.followUpActions.filter(item => item !== value);
      setFormData(previous => ({ ...previous, followUpActions }));
      persistToStorage(engagementId, { followUpActions });
    },
    [engagementId, engagementStatus, formData.followUpActions, persistToStorage]
  );

  // Reload saved form when engagement changes
  useEffect(() => {
    setFormData(engagementId ? loadFromStorage(engagementId) : DEFAULT_FORM);
    setStorageStatus("idle");
  }, [engagementId, loadFromStorage]);

  const active = Boolean(engagementId) && engagementStatus !== "end";
  const statusLabel = ({ start: "Active", hold: "On hold", resume: "Resumed", end: "Ended" } as Record<string, string>)[engagementStatus] || engagementStatus || "Waiting";
  const hasLiveEvent = activity.some(item => item.title.endsWith("changed"));
  const copyId = async () => {
    try { await navigator.clipboard.writeText(engagementId); setCopied("Engagement ID copied."); }
    catch { setCopied("Copy unavailable. Select the engagement ID to copy it."); }
  };

  return (
    <main className="zcc-explorer">
      <header className="zcc-explorer-header">
        <div><p className="zcc-eyebrow">Zoom Contact Center · Developer sample</p><h1>Engagement Explorer</h1><p className="zcc-explorer-subtitle">See the context. Follow the events. Build your workflow.</p></div>
        <span className={"zcc-sdk-badge " + (sdkReady ? "is-connected" : "")}><span aria-hidden="true">●</span> {sdkReady ? "SDK connected" : sdkError ? "Connection needs attention" : "Connecting to Zoom"}</span>
      </header>

      {sdkError && <section className="zcc-explorer-alert" role="alert"><h2>Let’s connect to Zoom</h2><p>{sdkError}</p><button className="zcc-outline-button" onClick={() => setRetry(value => value + 1)}>Try again</button></section>}

      {!sdkError && !active && <section className="zcc-explorer-empty">
        <span className="zcc-empty-icon" aria-hidden="true">◎</span>
        <div><h2>{engagementStatus === "end" ? "This engagement has ended" : "Ready for your first engagement"}</h2><p>{sdkReady ? "Open this app during an engagement from an assigned queue. Context and status will appear here as Zoom sends them." : "Connecting to the Zoom Apps SDK. Your engagement details will appear when they’re available."}</p>
        {contextUnavailable && <p className="zcc-small">The SDK is connected, but engagement context is unavailable. Confirm the app is assigned to the engagement’s queue.</p>}</div>
      </section>}

      <div className="zcc-explorer-grid">
        <section className="zcc-explorer-panel">
          <div className="zcc-panel-heading"><h2>Current engagement</h2><span className={"zcc-engagement-status " + (active ? "is-active" : "")}>{statusLabel}</span></div>
          <dl className="zcc-engagement-details">
            <div><dt>Engagement ID</dt><dd className="zcc-id-row"><code>{engagementId || "Waiting for an engagement"}</code>{engagementId && <button className="zcc-text-button" onClick={copyId} aria-label="Copy engagement ID">Copy</button>}</dd></div>
            <div><dt>Queue</dt><dd>{engagementContext || "Not provided by Zoom"}</dd></div>
            <div><dt>Source</dt><dd>Zoom Apps SDK <span className="zcc-small">· live client data</span></dd></div>
          </dl>
          <p className="zcc-small" role="status">{copied}</p>
          <details className="zcc-sdk-response"><summary>View SDK response</summary><p className="zcc-small">Available context may include engagement identifiers. Share only what you intend to disclose.</p><pre>{JSON.stringify({ context: rawContext, status: rawStatus }, null, 2)}</pre></details>
        </section>

        <section className="zcc-explorer-panel">
          <div className="zcc-panel-heading"><h2>Live activity</h2><span className="zcc-small">Latest {activity.length} / 30</span></div>
          <p className="zcc-small zcc-activity-intro">Events appear as they arrive from Zoom during this visit.</p>
          {activity.length ? <ol className="zcc-activity-list">{activity.map(item => <li key={item.id}><span className="zcc-activity-dot" aria-hidden="true" /><div><h3>{item.title}</h3><p>{item.detail}</p><time>{item.time}</time></div></li>)}</ol> : <p className="zcc-activity-placeholder">Waiting for the SDK connection and your first event.</p>}
        </section>
      </div>

      <section className="zcc-explorer-panel zcc-workspace">
        <div className="zcc-panel-heading">
          <div><p className="zcc-eyebrow">Build on the engagement</p><h2>Engagement workspace</h2></div>
          <span className={"zcc-save-status " + (storageStatus === "unavailable" ? "is-warning" : "")} role="status">
            {{ idle: "Local to this browser", saved: "Saved locally", cleared: "Cleared at engagement end", unavailable: "Storage unavailable" }[storageStatus]}
          </span>
        </div>
        <p className="zcc-workspace-description">Capture notes and follow-up details for the current engagement. Switch engagements to see each draft reload.</p>
        {!active && <p className="zcc-workspace-hint">Open an active engagement to use this workspace.</p>}
        {storageStatus === "unavailable" && <p className="zcc-workspace-hint" role="alert">Your changes are visible here, but this browser could not save them. Copy any notes you need before leaving.</p>}
        <fieldset disabled={!active} className="zcc-notes-fields">
          <div className="zcc-workspace-grid">
            <div className="zcc-workspace-notes">
              <Label htmlFor="notes">Engagement notes</Label>
              <Textarea id="notes" value={formData.text} onChange={event => handleChange("text", event.target.value)}
                placeholder="Capture the request, useful context, and the next action…" className="zcc-workspace-textarea" />
              <p className="zcc-small">Drafts stay in this browser. An engagement end event clears its saved form.</p>
            </div>
            <div className="zcc-workspace-followup">
              <h3>Follow-up details</h3>
              <div className="zcc-workspace-field"><Label htmlFor="date">Follow-up date</Label>
                <Input id="date" type="date" value={formData.date} onChange={event => handleChange("date", event.target.value)} />
              </div>
              <div className="zcc-workspace-field"><Label id="contact-method-label">Preferred contact method</Label>
                <RadioGroup aria-labelledby="contact-method-label" disabled={!active} value={formData.contactMethod}
                  onValueChange={(value: "email" | "phone") => handleChange("contactMethod", value)} className="flex gap-5">
                  <div className="flex items-center gap-2"><RadioGroupItem id="contact-email" value="email" /><Label htmlFor="contact-email">Email</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem id="contact-phone" value="phone" /><Label htmlFor="contact-phone">Phone</Label></div>
                </RadioGroup>
              </div>
              <p className="zcc-small">Use this pattern to attach workflow fields to an engagement.</p>
            </div>
          </div>
          <div className="zcc-workflow-fields">
            <div className="zcc-workspace-field"><Label htmlFor="disposition">Disposition</Label>
              <select id="disposition" value={formData.disposition} onChange={event => handleChange("disposition", event.target.value)}>
                <option value="">Choose an outcome</option>
                {DISPOSITIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="zcc-small">Record the planned outcome for this interaction.</p>
            </div>
            <div className="zcc-workspace-field"><Label htmlFor="priority">Priority</Label>
              <select id="priority" value={formData.priority} onChange={event => handleChange("priority", event.target.value)}>
                <option value="">Choose a priority</option>
                {PRIORITIES.map(priority => <option key={priority} value={priority}>{priority}</option>)}
              </select>
              <p className="zcc-small">Help the next agent understand what needs attention.</p>
            </div>
            <div className="zcc-workspace-field"><Label id="follow-up-actions-label">Follow-up actions</Label>
              <div className="zcc-follow-up-actions" role="group" aria-labelledby="follow-up-actions-label">
                {FOLLOW_UP_ACTIONS.map(option => <div key={option.value} className="flex items-center gap-2">
                  <Checkbox id={option.value} disabled={!active} checked={formData.followUpActions.includes(option.value)}
                    onCheckedChange={value => handleFollowUpToggle(option.value, Boolean(value))} />
                  <Label htmlFor={option.value}>{option.label}</Label>
                </div>)}
              </div>
            </div>
          </div>
          <p className="zcc-small zcc-workflow-note">Saved as a local workflow draft. Connect these fields to your workflow API to execute follow-up actions.</p>

        </fieldset>
      </section>

      <section className="zcc-explorer-panel zcc-guided-panel">
        <div className="zcc-panel-heading"><h2>Try it yourself</h2><a className="zcc-text-button" href="https://developers.zoom.us/docs/contact-center/apps/" target="_blank" rel="noreferrer">Developer guide ↗</a></div>
        <ol className="zcc-guided-steps">
          <li><span className={"zcc-step-indicator " + (sdkReady ? "is-done" : "")}>{sdkReady ? "✓" : "1"}</span><div><h3>Connect the sample</h3><p>Open the app in Zoom Contact Center and confirm the SDK connects.</p></div></li>
          <li><span className={"zcc-step-indicator " + (active ? "is-done" : "")}>{active ? "✓" : "2"}</span><div><h3>Load an engagement</h3><p>Handle a test engagement from a queue assigned to this app.</p></div></li>
          <li><span className={"zcc-step-indicator " + (hasLiveEvent ? "is-done" : "")}>{hasLiveEvent ? "✓" : "3"}</span><div><h3>Watch a change arrive</h3><p>Change the engagement status or switch engagements. Watch Live activity update.</p></div></li>
        </ol>
      </section>


    </main>
  );
}
