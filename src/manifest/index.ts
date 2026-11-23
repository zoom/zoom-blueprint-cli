// Build General App manifests for templates that do not supply one.
// Local checks cover input constraints. Marketplace validates the complete manifest.

import fs from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = {
  display_name: 50,
  description: 150,
  long_description: 2000,
  scope_description: 2000,
} as const;

/** Truncate to `max` chars, adding an ellipsis when it overflows. */
export function clip(str: string | undefined, max: number): string {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

/** Slugify an app name into a valid alias_name with a configurable prefix (≤64 chars). */
export function slugifyAlias(appName: string, prefix = 'zoom_agent_'): string {
  const base = (appName || 'my-agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, '_$1');
  return `${prefix}${base}`.slice(0, 64);
}

export interface ManifestInputIssuesArgs {
  displayName?: string;
  description?: string;
  longDescription?: string;
  scopeDescription?: string;
  aliasName?: string;
}

/** Pre-generation input validation. Returns a list of human-readable issues (empty = valid). */
export function validateManifestInputs({
  displayName,
  description,
  longDescription,
  scopeDescription,
  aliasName,
}: ManifestInputIssuesArgs): string[] {
  const issues: string[] = [];
  if (!displayName || !displayName.trim()) {
    issues.push('displayName is required.');
  } else if (displayName.length > LIMITS.display_name) {
    issues.push(`display_name is ${displayName.length} chars (limit ${LIMITS.display_name}).`);
  }
  if (description && description.length > LIMITS.description)
    issues.push(`description is ${description.length} chars (limit ${LIMITS.description}).`);
  if (longDescription && longDescription.length > LIMITS.long_description)
    issues.push(`long_description is ${longDescription.length} chars (limit ${LIMITS.long_description}).`);
  if (scopeDescription && scopeDescription.length > LIMITS.scope_description)
    issues.push(`scope_description is ${scopeDescription.length} chars (limit ${LIMITS.scope_description}).`);
  if (aliasName && !/^[a-z][a-z0-9_]{2,63}$/.test(aliasName))
    issues.push(
      `alias_name "${aliasName}" must be 3-64 chars, lowercase letters/digits/underscore, must start with a letter.`,
    );
  return issues;
}

const VALID_USAGE = ['USER_OPERATION', 'ADMIN_MANAGEMENT'] as const;
export type Usage = (typeof VALID_USAGE)[number];

export interface McpConnectInput {
  url: string;
  name?: string;
  description?: string;
  transportType?: string;
  type?: string;
  authSchemaKey?: string;
}

export interface GeneralAppManifestInput {
  displayName: string;
  aliasName?: string;
  aliasPrefix?: string;
  description?: string;
  longDescription?: string;
  scopeDescription?: string;
  usage?: Usage;
  strictMode?: boolean;
  subdomainStrictMode?: boolean;
  devRedirectUri?: string;
  prodRedirectUri?: string;
  devHomeUri?: string;
  prodHomeUri?: string;
  oauthAllowList?: string[];
  discoverType?: 'LISTED' | 'UNLISTED';
  installType?: string;
  /** Zoom products to advertise under features.products, e.g. ['ZOOM_AIC','ZOOM_VIRTUAL_AGENT']. */
  products?: string[];
  connectSecurityType?: number;
  thirdPartyApiUrl?: string;
  /** Optional MCP connect block — only emitted when provided (non-MCP templates omit it). */
  mcp?: McpConnectInput | null;
}

// The manifest shape is intentionally `any`-ish: it mirrors Zoom's untyped JSON contract exactly.
export type ZoomManifest = Record<string, any>;

/**
 * Build a General-App manifest object (the bare inner object; wrap it with
 * wrapManifestForCreateApp before POSTing). The static `enable:false` capability skeleton is a
 * clean General-App baseline carried over verbatim from the Composio CLI.
 */
export function generateGeneralAppManifest(input: GeneralAppManifestInput): ZoomManifest {
  const {
    displayName,
    aliasName,
    aliasPrefix = 'zoom_agent_',
    description = '',
    longDescription = '',
    scopeDescription = '',
    usage = 'USER_OPERATION',
    strictMode = true,
    subdomainStrictMode = false,
    devRedirectUri = '',
    prodRedirectUri = '',
    devHomeUri = '',
    prodHomeUri = '',
    oauthAllowList = [],
    discoverType = 'LISTED',
    installType = 'APP_DIRECTORY',
    products = [],
    connectSecurityType = 6,
    thirdPartyApiUrl = '',
    mcp = null,
  } = input;

  if (!displayName) throw new Error('generateGeneralAppManifest: displayName is required');
  if (!VALID_USAGE.includes(usage)) {
    throw new Error(`generateGeneralAppManifest: usage must be one of ${VALID_USAGE.join('|')}, got "${usage}"`);
  }

  const connect: ZoomManifest = {
    url: thirdPartyApiUrl,
    security: { type: connectSecurityType, oauth_config: {} }, // 6 = no-auth
    routes: [],
    incoming_webhooks: [],
    auth: [],
  };
  if (mcp && mcp.url) {
    connect.mcp = {
      base_url: mcp.url,
      name: mcp.name || displayName,
      ext: {
        description: mcp.description || description || `${displayName}.`,
        mcpTransportType: mcp.transportType || 'STREAMABLE',
        mcpType: mcp.type || 'COMPOSIO',
        dcr_enabled: false,
        support_multi_auth: false,
      },
      auth_schema_key: mcp.authSchemaKey || 'noauth',
    };
  }

  return {
    display_information: {
      display_name: clip(displayName, LIMITS.display_name),
      description: clip(description || `${displayName}.`, LIMITS.description),
      long_description: clip(longDescription || description || `${displayName}.`, LIMITS.long_description),
      discover_type: discoverType,
      install_type: installType,
      alias_name: aliasName || slugifyAlias(displayName, aliasPrefix),
    },
    oauth_information: {
      usage,
      development_redirect_uri: devRedirectUri,
      production_redirect_uri: prodRedirectUri,
      oauth_allow_list: oauthAllowList,
      strict_mode: strictMode,
      subdomain_strict_mode: subdomainStrictMode,
      // NOTE: Zoom's manifest carries scope intent as free text here, not a granular scope array.
      // Templates declare requiredScopes for docs/.env; they are summarized into this description.
      scope_description: clip(scopeDescription || `Used by ${displayName}.`, LIMITS.scope_description),
    },
    features: {
      products: [...products],
      development_home_uri: devHomeUri,
      production_home_uri: prodHomeUri,
      in_client_feature: {
        zoom_app_api: { enable: false, zoom_app_apis: [] },
        guest_mode: { enable: false, enable_test_guest_mode: false },
        in_client_oauth: { enable: false },
        collaborate_mode: {
          enable: false,
          enable_screen_sharing: false,
          enable_play_together: false,
          enable_start_immediately: false,
          enable_join_immediately: false,
        },
        team_chat_tab: { enable_home_tab: false, enable_channel_tab: false },
      },
      zoom_client_support: {
        mobile: { enable: false },
        zoom_room: {
          enable: false,
          enable_personal_zoom_room: false,
          enable_shared_zoom_room: false,
          enable_digital_signage: false,
          enable_zoom_rooms_controller: false,
        },
        pwa_client: { enable: false },
      },
      embed: {
        meeting_sdk: { enable: false, enable_device: false, devices: [] },
        contact_center_sdk: { enable: false },
        phone_sdk: { enable: false },
      },
      team_chat_subscription: { enable: false, enable_support_channel: false, shortcuts: [] },
      event_subscription: { enable: false, events: [] },
      ...(mcp?.url || thirdPartyApiUrl ? { connect } : {}),
      custom_form: { enable: false },
      marketplace_actions: { enable: false },
      marketplace_triggers: { enable: false },
    },
  };
}

/**
 * Idempotently merge `products` into manifest.features.products. Handles a bare manifest or a
 * { manifest } wrapper, and dedups. Returns the same (mutated) object. Ported from
 * ensureRequiredProducts; the product list is now a parameter instead of a hardcoded constant.
 */
export function ensureProducts(manifest: ZoomManifest, products: string[]): ZoomManifest {
  if (!manifest || typeof manifest !== 'object' || !products?.length) return manifest;
  const target =
    manifest.manifest && typeof manifest.manifest === 'object' && manifest.display_information === undefined
      ? manifest.manifest
      : manifest;
  if (!target.features || typeof target.features !== 'object') target.features = {};
  const existing = Array.isArray(target.features.products) ? target.features.products : [];
  const merged = [...existing];
  for (const p of products) if (!merged.includes(p)) merged.push(p);
  target.features.products = merged;
  return manifest;
}

/** The Create App API expects the manifest under a top-level `manifest` key. Idempotent. */
export function wrapManifestForCreateApp(manifest: ZoomManifest): { manifest: ZoomManifest } {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('wrapManifestForCreateApp: manifest object is required');
  }
  if (manifest.manifest && manifest.display_information === undefined) {
    return manifest as { manifest: ZoomManifest };
  }
  return { manifest };
}

/** Persist a manifest (bare inner object, suitable for manual UI upload) to disk. */
export async function saveManifest(manifest: ZoomManifest, outPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  return outPath;
}
