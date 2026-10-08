import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { PROVIDERS } from "open-sse/config/providers.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import {
  BLOCKED_REQUEST_HEADERS,
  BLOCKED_RESPONSE_HEADERS,
  MAX_HEADER_RULES,
  MAX_HEADER_VALUE_LENGTH,
  normalizeHeaderRuleList,
} from "open-sse/utils/providerHeaderRules.js";

export const dynamic = "force-dynamic";

// RFC 7230 token subset: letters, digits, hyphen (no spaces, no unicode)
const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;

/**
 * Validate + normalize an override payload. Returns { override } or { error }.
 * An override with no rules is normalized to null (= delete).
 */
function normalizeOverride({ headers, request, response }) {
  const out = {};

  // Legacy map: header name → value (empty string = remove at runtime)
  if (headers !== undefined && headers !== null) {
    if (typeof headers !== "object" || Array.isArray(headers)) {
      return { error: "headers must be an object" };
    }
    const entries = Object.entries(headers).filter(([, v]) => v !== "" && v != null);
    if (entries.length > MAX_HEADER_RULES) {
      return { error: `Too many headers (max ${MAX_HEADER_RULES})` };
    }
    const clean = {};
    for (const [name, value] of entries) {
      if (!HEADER_NAME_RE.test(name)) {
        return { error: `Invalid header name: ${name}` };
      }
      if (typeof value !== "string" || /[\r\n]/.test(value)) {
        return { error: `Invalid value for header ${name}` };
      }
      if (value.length > MAX_HEADER_VALUE_LENGTH) {
        return { error: `Header ${name} value too long (max ${MAX_HEADER_VALUE_LENGTH})` };
      }
      if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) {
        return { error: `Header ${name} cannot be overridden` };
      }
      clean[name] = value;
    }
    if (Object.keys(clean).length) out.headers = clean;
  }

  if (request !== undefined) {
    const { rules, error } = normalizeHeaderRuleList(request, BLOCKED_REQUEST_HEADERS);
    if (error) return { error };
    if (rules?.length) out.request = rules;
  }

  if (response !== undefined) {
    const { rules, error } = normalizeHeaderRuleList(response, BLOCKED_RESPONSE_HEADERS);
    if (error) return { error };
    if (rules?.length) out.response = rules;
  }

  const hasContent = Boolean(
    (out.headers && Object.keys(out.headers).length)
    || out.request?.length
    || out.response?.length,
  );

  return { override: hasContent ? out : null };
}

async function readOverrides() {
  const settings = await getSettings();
  return settings.providerOverrides || {};
}

/**
 * GET /api/providers/[id]/overrides — user override for this provider
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const canonical = resolveProviderAlias(id);
    const override = (await readOverrides())[canonical] || {};
    return NextResponse.json({
      headers: override.headers || {},
      request: override.request || [],
      response: override.response || [],
      builtinHeaders: PROVIDERS[canonical]?.headers || {},
    });
  } catch (error) {
    console.log("Error getting provider overrides:", error);
    return NextResponse.json({ error: "Failed to get overrides" }, { status: 500 });
  }
}

/**
 * PUT /api/providers/[id]/overrides
 * Body: { headers?, request?: Rule[], response?: Rule[] }
 */
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const canonical = resolveProviderAlias(id);
    const body = await request.json().catch(() => ({}));
    const { override, error } = normalizeOverride(body);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const current = await readOverrides();
    const next = { ...current };
    if (override) next[canonical] = override;
    else delete next[canonical];
    await updateSettings({ providerOverrides: next });
    return NextResponse.json({
      headers: override?.headers || {},
      request: override?.request || [],
      response: override?.response || [],
    });
  } catch (error) {
    console.log("Error saving provider overrides:", error);
    return NextResponse.json({ error: "Failed to save overrides" }, { status: 500 });
  }
}
