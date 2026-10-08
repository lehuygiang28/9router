import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { patchProviderOverride } from "@/lib/db/repos/settingsRepo.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import {
  BLOCKED_REQUEST_HEADERS,
  BLOCKED_RESPONSE_HEADERS,
  MAX_HEADER_RULES,
  MAX_HEADER_VALUE_LENGTH,
  normalizeHeaderRuleList,
  isValidHeaderValue,
} from "open-sse/utils/providerHeaderRules.js";
import {
  isCustomCompatibleProvider,
  normalizeBodyRuleList,
  normalizeBodyOptions,
} from "open-sse/utils/providerBodyRules.js";
import { normalizeBodyTransform } from "open-sse/utils/providerBodyTransform.js";

export const dynamic = "force-dynamic";

// RFC 7230 token subset: letters, digits, hyphen (no spaces, no unicode)
const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;

/**
 * Validate + normalize an override payload. Returns { override } or { error }.
 * An override with no rules is normalized to null (= delete).
 */
function normalizeOverride({ headers, request, response, body, options, bodyTransform }, providerId) {
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
      if (!isValidHeaderValue(value)) {
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

  const customCompatible = isCustomCompatibleProvider(providerId);
  if ((body !== undefined || options !== undefined || bodyTransform !== undefined) && !customCompatible) {
    return { error: "Body rules, transform script, and options are only supported for custom OpenAI/Anthropic compatible providers" };
  }

  if (body !== undefined) {
    const { rules, error } = normalizeBodyRuleList(body);
    if (error) return { error };
    if (rules?.length) out.body = rules;
  }

  if (options !== undefined) {
    const { options: normalizedOptions, error } = normalizeBodyOptions(options);
    if (error) return { error };
    if (normalizedOptions) out.options = normalizedOptions;
  }

  if (bodyTransform !== undefined) {
    if (bodyTransform === null) {
      // explicit clear
    } else {
      const { bodyTransform: normalizedTransform, error } = normalizeBodyTransform(bodyTransform);
      if (error) return { error };
      if (normalizedTransform) out.bodyTransform = normalizedTransform;
    }
  }

  const hasContent = Boolean(
    (out.headers && Object.keys(out.headers).length)
    || out.request?.length
    || out.response?.length
    || out.body?.length
    || out.options
    || out.bodyTransform,
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
      body: override.body || [],
      options: override.options || {},
      bodyTransform: override.bodyTransform || null,
      bodyRulesSupported: isCustomCompatibleProvider(canonical),
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
    const { override, error } = normalizeOverride(body, canonical);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    await patchProviderOverride(canonical, override);
    return NextResponse.json({
      headers: override?.headers || {},
      request: override?.request || [],
      response: override?.response || [],
      body: override?.body || [],
      options: override?.options || {},
      bodyTransform: override?.bodyTransform || null,
    });
  } catch (error) {
    console.log("Error saving provider overrides:", error);
    return NextResponse.json({ error: "Failed to save overrides" }, { status: 500 });
  }
}
