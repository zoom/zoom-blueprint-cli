import { readRegisteredBlueprints } from "./catalog.js";
import { parseDefinition, type BlueprintDefinition } from "./definition.js";
// Template metadata drives scaffolding, provider selection, and local development.
// Bundled samples supply their own environment examples and Marketplace manifests.

import type { ProviderId } from "../providers.js";
import type { UrlMapping } from "../manifest/resolve.js";

export type AppType = "general";

/** How a template runs locally and how its public URL maps into its manifest (for `zoom dev`). */
export interface TemplateRuntime {
  /** 'server' = a local HTTP server to tunnel; 'docker' = compose-managed; 'batch' = run-and-exit. */
  kind: "server" | "docker" | "batch";
  /** Instructions for testing the integration after URL sync. */
  testInstructions?: string;
  /** Command to start local development, argv-style (e.g. ['npm','run','dev']). */
  devCommand: string[];
  /** Packages that must be installed before starting this multi-package sample. */
  dependencyDirs?: string[];
  /** Env var the app reads for its listen port. */
  portEnv?: string;
  /** Fallback port when portEnv is unset. */
  defaultPort?: number;
  /** GET path that returns 2xx once the server is ready (e.g. '/health'). */
  readinessPath?: string;
  /** Env var the app reads for its own public base URL (set by `zoom dev` for docker templates). */
  publicUrlEnv?: string;
  /** Manifest URL fields (dev convention) that get the public HTTPS base + route during `zoom dev`. */
  urlMappings?: UrlMapping[];
}
/**
 * How `zoom configure` / `zoom dev` reconcile a generated project's runtime `.env` against the active
 * dev URL and the Marketplace app. Every field is optional; a template opts in only to what applies.
 */
export interface EnvReconcileSpec {
  /**
   * Env vars derived from the active development base URL. `kind: 'url'` → baseUrl + `route`;
   * `kind: 'origin'` → just the scheme://host of baseUrl. These are "generated" values — safe to
   * refresh whenever the tunnel URL changes (no confirmation needed).
   */
  urlVars?: {
    name: string;
    route?: string;
    kind?: "url" | "origin";
    label?: string;
  }[];
  /**
   * Developer-supplied identifiers/secrets that NO documented API exposes (e.g. the Bot JID and the
   * webhook Secret Token). Prompted for + format-validated ONLY when still a placeholder; an existing
   * real value is never overwritten without explicit confirmation.
   */
  promptVars?: {
    name: string;
    label: string;
    validate?: "botJid" | "secretToken";
    marketplacePage?: "surface" | "access";
    help?: string;
  }[];
  /** Env vars auto-generated (cryptographically random) when still a placeholder/empty. */
  generateVars?: { name: string; label?: string }[];
  /** Env var defaulted from GET /apps/{appId}.app_name when still a placeholder/empty. */
  appNameVar?: { name: string; label?: string };
}

// 'sample-native' = the sample ships its own AI client; 'fetch' = bundled provider-agnostic adapter;
// 'none' = a working Zoom app with no built-in AI yet (you wire in your provider during customization).
export type ProviderIntegration = "sample-native" | "fetch" | "none";
export type ZoomSurface =
  | "team_chat"
  | "zoom_app"
  | "meeting"
  | "rtms"
  | "account_api"
  | "contact_center";

export type TemplateSource =
  | { type: "local"; directory: string } // path relative to the package `templates/` dir
  | { type: "registered"; directory: string } // absolute path to a saved local snapshot
  | { type: "github"; repo: string; ref: string; directory: string };

export interface Template {
  id: string;
  name: string;
  description: string;
  source: TemplateSource;
  /** Upstream repository for the bundled sample. */
  sourceRepo?: string;
  /** Pinned commit / tag of the bundled sample. */
  sourceRef?: string;
  compatibleAppTypes: AppType[];
  supportedProviders: ProviderId[];
  aiMode: "fixed" | "feature-specific" | "none";
  aiFeatures: {
    name: string;
    provider: ProviderId;
    keyEnv: string;
    modelEnv: string;
    defaultModel: string;
  }[];
  /** Zoom scopes the app needs — informs the manifest scope_description and docs. */
  requiredScopes: string[];
  /** Zoom app capabilities/features this template exercises (informational). */
  requiredCapabilities: string[];
  /** Where in Zoom Workplace this agent surfaces. */
  supportedSurfaces: ZoomSurface[];
  /** How the app talks to the LLM: a sample's own SDK, or the bundled fetch adapter. */
  providerIntegration: ProviderIntegration;
  /** Whether the CLI offers an optional Claude Code customization step for this template. */
  claudeCodeSupported: boolean;
  /** Zoom products to advertise if the CLI generates the manifest (ignored when manifestPath set). */
  products: string[];
  /**
   * How the Marketplace app gets set up. 'auto' (default): the CLI creates it via the API. 'manual':
   * the sample has its own Marketplace build flow (Zoom Apps / RTMS configuration that a generic
   * generated manifest can't express) — the CLI does NOT create an app and points to the README.
   */
  marketplaceSetup?: "auto" | "manual";
  /**
   * Relative path (within the scaffolded project) to a capability-complete manifest the CLI should
   * use for Marketplace creation instead of generating a generic one. Only set for samples whose
   * bundled manifest matches the Create App API shape.
   */
  manifestPath?: string;
  /** Env vars the generated project needs (informational for sample templates with their own .env.example). */
  requiredEnv: string[];
  /** The sample can start locally with provider-backed features disabled. */
  aiOptionalInDevelopment?: boolean;
  /** Template-specific guidance shown when reviewing generated configuration. */
  setupNotes?: string[];
  setupCommands: string[];
  startCommands: string[];
  /** How `zoom dev` runs the project and maps the tunnel URL into the manifest. */
  runtime?: TemplateRuntime;
  /** How to reconcile the generated project's runtime `.env` after creation (`zoom configure`/`dev`). */
  reconcile?: EnvReconcileSpec;
}

const BOT_SETUP_PROMPTS: NonNullable<EnvReconcileSpec["promptVars"]> = [
  {
    name: "ZOOM_BOT_JID",
    label: "Bot JID",
    validate: "botJid",
    marketplacePage: "surface",
    help: "In Development, open Features → Surface → Chat subscription.\nClick Copy beside Bot JID.",
  },
  {
    name: "ZOOM_VERIFICATION_TOKEN",
    label: "Secret token",
    validate: "secretToken",
    marketplacePage: "access",
    help: "In Development, open Features → Access → Token.\nClick Copy beside Secret token.",
  },
];

export const TEMPLATES: Template[] = [
  {
    id: "chat-ai-assistant",
    name: "Zoom Chat Research Assistant (Claude)",
    description:
      "A Zoom Chat bot sample (Express + OAuth + webhooks + in-client webview) that replies with Claude. Reuses the bundled Zoom sample; ships its own capability-complete manifest.",
    source: { type: "local", directory: "chatbot-services" },
    sourceRef: "f411f72",
    compatibleAppTypes: ["general"],
    supportedProviders: ["anthropic"],
    aiMode: "fixed",
    aiFeatures: [
      {
        name: "Zoom Chat research",
        provider: "anthropic",
        keyEnv: "ANTHROPIC_API_KEY",
        modelEnv: "ANTHROPIC_MODEL",
        defaultModel: "claude-sonnet-4-6",
      },
    ], // the sample ships an Anthropic client only
    requiredScopes: [
      "team_chat:read:user_message",
      "imchat:userapp",
      "marketplace:read:app",
      "message:write:content",
      "zoomapp:inmeeting",
      "app:channel_content:write",
    ],
    requiredCapabilities: [
      "team_chat",
      "oauth",
      "in_client_webview",
      "event_subscription",
    ],
    supportedSurfaces: ["team_chat", "zoom_app"],
    providerIntegration: "sample-native",
    claudeCodeSupported: true,
    products: ["ZOOM_CHAT"],
    manifestPath: "0-app-manifest/app-manifest.json",
    requiredEnv: [
      "ZOOM_CLIENT_ID",
      "ZOOM_CLIENT_SECRET",
      "ZOOM_ACCOUNT_ID",
      "ZOOM_BOT_JID",
    ],
    aiOptionalInDevelopment: true,
    setupNotes: [
      "Node.js 22.23.5 (verified) is recommended for the bundled samples.",
      "The CLI will guide you to Features → Surface for Bot JID and Features → Access for Secret token.",
      "Claude replies are optional locally. Upstash Redis is optional locally.",
    ],
    setupCommands: ["npm install"],
    startCommands: ["npm run dev"],
    runtime: {
      kind: "server",
      devCommand: ["npm", "run", "dev"],
      portEnv: "PORT",
      defaultPort: 4000,
      readinessPath: "/health",
      testInstructions:
        "In Marketplace Development, open Local Test and complete any listed requirements.\nClick Add app now, then open the bot in Zoom Chat and send menu.\nConfirm the menu appears. Research replies require ANTHROPIC_API_KEY.",
      urlMappings: [
        {
          path: "oauth_information.development_redirect_uri",
          route: "/auth/callback",
          label: "OAuth callback",
        },
        {
          path: "oauth_information.oauth_allow_list.0",
          route: "/auth/callback",
          label: "OAuth allow-list",
        },
        {
          path: "features.development_home_uri",
          route: "/webview",
          label: "App Home (webview)",
        },
        {
          path: "features.event_subscription.events.0.development_webhook_url",
          route: "/webhooks",
          label: "Webhook",
        },
        {
          path: "features.team_chat_subscription.slash_command.development_message_url",
          route: "/webhooks",
          label: "Chatbot webhook endpoint",
        },
      ],
    },
    reconcile: {
      urlVars: [
        {
          name: "ZOOM_REDIRECT_URI",
          route: "/auth/callback",
          kind: "url",
          label: "OAuth redirect URI",
        },
        {
          name: "WEBVIEW_URL",
          route: "/webview",
          kind: "url",
          label: "In-client webview URL",
        },
        {
          name: "FRONTEND_ORIGIN",
          kind: "origin",
          label: "Webview/CORS origin",
        },
      ],
      promptVars: BOT_SETUP_PROMPTS,
      generateVars: [
        { name: "SESSION_SECRET", label: "Session signing secret" },
      ],
      appNameVar: { name: "ZOOM_BOT_NAME", label: "Bot display name" },
    },
  },
  {
    id: "hitl-workplace-agent",
    name: "Meeting Intelligence & Approvals (OpenAI + Claude)",
    description:
      "The comprehensive reference: RTMS meeting capture → AI recommendations → human approval → execute (Observe→Recommend→Approve→Execute). Zoom Apps SDK, Zoom Chat, MCP, Tasks. Express backend + Next.js frontend.",
    source: { type: "local", directory: "hitl-workplace-agent" },
    sourceRepo:
      "https://github.com/zoom/human-in-the-loop-workplace-agent-sample",
    sourceRef: "66a3740723b032a87457e2f41d6ad52cc33b0b7d",
    compatibleAppTypes: ["general"],
    supportedProviders: ["anthropic", "openai"],
    aiMode: "feature-specific",
    aiFeatures: [
      {
        name: "Zoom Chat research",
        provider: "anthropic",
        keyEnv: "ANTHROPIC_API_KEY",
        modelEnv: "ANTHROPIC_MODEL",
        defaultModel: "claude-sonnet-4-6",
      },
      {
        name: "Meeting intelligence and approvals",
        provider: "openai",
        keyEnv: "OPENAI_API_KEY",
        modelEnv: "OPENAI_MODEL",
        defaultModel: "gpt-4.1-mini",
      },
      {
        name: "Zoom document creation",
        provider: "openai",
        keyEnv: "OPENAI_API_KEY",
        modelEnv: "OPENAI_MODEL",
        defaultModel: "gpt-4.1-mini",
      },
    ],
    requiredScopes: [
      "imchat:userapp",
      "team_chat:read:user_message",
      "app:channel_content:write",
      "user:read:user",
      "meeting:read:meeting",
      "zoomapp:inmeeting",
      "meeting:update:participant_rtms_app_status",
      "meeting:read:meeting_transcript",
      "rtms:read:rtms_interrupted",
      "rtms:read:rtms_started",
      "rtms:read:rtms_stopped",
      "docs:write:import",
    ],
    requiredCapabilities: [
      "rtms",
      "zoom_apps",
      "team_chat",
      "mcp",
      "tasks",
      "oauth",
    ],
    supportedSurfaces: ["meeting", "rtms", "team_chat", "zoom_app"],
    providerIntegration: "sample-native",
    claudeCodeSupported: true,
    products: [],
    manifestPath: "0-app-manifest/app-manifest.json", // capability-complete manifest (source of truth)
    requiredEnv: [
      "ZOOM_CLIENT_ID",
      "ZOOM_CLIENT_SECRET",
      "ZOOM_BOT_JID",
      "SESSION_SECRET",
    ],
    setupNotes: [
      "Use Node.js 22.23.5 (verified) and npm run install:all to install the backend and frontend.",
      "The CLI guides Bot JID and Secret token setup. AI keys enable their respective features.",
      "The public URL points to Next.js on port 3000. Express remains on port 4000.",
    ],
    reconcile: {
      urlVars: [
        {
          name: "PUBLIC_BASE_URL",
          kind: "origin",
          label: "Public frontend origin",
        },
        {
          name: "ZOOM_REDIRECT_URI",
          route: "/auth/callback",
          label: "OAuth callback",
        },
      ],
      promptVars: BOT_SETUP_PROMPTS,
      generateVars: [
        { name: "SESSION_SECRET", label: "Session signing secret" },
      ],
    },
    setupCommands: ["npm run install:all"],
    startCommands: ["npm run dev"],
    runtime: {
      kind: "server",
      devCommand: ["npm", "run", "dev"],
      dependencyDirs: [".", "backend", "frontend"],
      portEnv: "FRONTEND_PORT",
      defaultPort: 3000,
      readinessPath: "/health",
      testInstructions:
        "In Marketplace Development, open Local Test, complete the requirements, and click Add app now.\nOpen the app in Zoom and authorize it through the sample sign-in flow.\nTest Zoom Chat with menu, or open the meeting view and confirm it loads.\nFor live meeting capture, enable RTMS on the account and use a test meeting. AI features require their respective provider keys.",
      publicUrlEnv: "PUBLIC_BASE_URL",
      urlMappings: [
        {
          path: "oauth_information.development_redirect_uri",
          route: "/auth/callback",
          label: "OAuth callback",
        },
        {
          path: "oauth_information.oauth_allow_list.0",
          route: "/auth/callback",
          label: "OAuth allow list",
        },
        {
          path: "features.development_home_uri",
          route: "/",
          label: "App Home",
        },
        {
          path: "features.event_subscription.events.0.development_webhook_url",
          route: "/webhooks",
          label: "Webhook",
        },
        {
          path: "features.team_chat_subscription.slash_command.development_message_url",
          route: "/webhooks",
          label: "Chatbot webhook endpoint",
        },
      ],
    },
  },
  {
    id: "zcc-nextjs-sample",
    name: "Zoom Contact Center Engagement Explorer (Next.js)",
    description:
      "Explore Contact Center engagement context and status with the Zoom Apps SDK. Next.js frontend with no built-in AI integration.",
    source: { type: "local", directory: "zcc-nextjs-sample" },
    compatibleAppTypes: ["general"],
    supportedProviders: [],
    aiMode: "none",
    aiFeatures: [],
    providerIntegration: "none",
    claudeCodeSupported: false,
    requiredScopes: ["zoomapp:inmeeting"],
    requiredCapabilities: ["zoom_apps", "contact_center"],
    supportedSurfaces: ["contact_center"],
    products: ["ZOOM_CONTACT_CENTER"],
    manifestPath: "0-app-manifest/app-manifest.json",
    requiredEnv: ["SITE_URL", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"],
    setupNotes: [
      "SITE_URL is updated automatically by zoom dev.",
      "No LLM key is required. Browser authorization uses the app Client ID and Client Secret.",
      "Testing requires Contact Center access and an admin who can assign the app to a queue.",
    ],
    setupCommands: ["npm install"],
    startCommands: ["npm run dev"],
    reconcile: {
      urlVars: [
        {
          name: "SITE_URL",
          kind: "origin",
          label: "Contact Center app origin",
        },
        {
          name: "ZOOM_REDIRECT_URI",
          route: "/auth/callback",
          label: "OAuth callback",
        },
      ],
    },
    runtime: {
      kind: "server",
      devCommand: ["npm", "run", "dev"],
      portEnv: "PORT",
      defaultPort: 3000,
      readinessPath: "/",
      testInstructions:
        "Open the public URL in your browser and click Authorize and open in Zoom.\nApprove the authorization request, then click Open in Zoom.\nAsk your Contact Center admin to assign the app to your test queue.\nIn the Zoom desktop app, handle an engagement from that queue and open the app.\nConfirm engagement context and status appear.",
      urlMappings: [
        {
          path: "features.development_home_uri",
          route: "/",
          label: "Contact Center app home",
        },
        {
          path: "oauth_information.development_redirect_uri",
          route: "/auth/callback",
          label: "OAuth callback",
        },
        {
          path: "oauth_information.oauth_allow_list.0",
          route: "/auth/callback",
          label: "OAuth allow list",
        },
      ],
    },
  },
];

/** One discovery path for bundled samples, local registrations, and project commands. */
export function listTemplates(): Template[] {
  const registered = readRegisteredBlueprints();
  if (registered.some((t) => TEMPLATES.some((b) => b.id === t.id)))
    throw new Error(
      "A local blueprint conflicts with a bundled ID. Unregister the local blueprint and choose a unique ID.",
    );
  return [...TEMPLATES, ...registered];
}

export function templateDefinition(template: Template): BlueprintDefinition {
  const { source: _source, compatibleAppTypes: _types, ...metadata } = template;
  return { schemaVersion: 1, ...metadata };
}

export function getTemplate(
  id: string,
  projectDefinition?: BlueprintDefinition,
): Template | undefined {
  // Generated registered projects retain their configuration even after unregistering the source.
  if (projectDefinition) {
    const { schemaVersion: _version, ...metadata } =
      parseDefinition(projectDefinition);
    if (metadata.id !== id)
      throw new Error("Project blueprint ID does not match its templateId.");
    return {
      ...metadata,
      compatibleAppTypes: ["general"],
      source: { type: "local", directory: "." },
    };
  }
  return listTemplates().find((t) => t.id === id);
}

/** Templates compatible with the given app type and (optionally) provider. */
export function compatibleTemplates(
  appType: AppType,
  provider?: ProviderId,
): Template[] {
  return listTemplates().filter(
    (t) =>
      t.compatibleAppTypes.includes(appType) &&
      (!provider || t.supportedProviders.includes(provider)),
  );
}
