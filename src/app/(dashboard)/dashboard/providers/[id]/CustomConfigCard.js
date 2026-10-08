"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Card, Badge } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const BLOCKED_REQUEST = ["host", "content-length", "content-type", "connection", "transfer-encoding", "authorization", "cookie"];
const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
const OPS = [
  { value: "set", label: "Set / override" },
  { value: "add", label: "Add" },
  { value: "remove", label: "Remove" },
];

const emptyRow = () => ({ name: "", op: "set", value: "" });

function mergeRowsForDisplay(builtinHeaders, savedRules) {
  const byLower = new Map();
  for (const [name, value] of Object.entries(builtinHeaders || {})) {
    byLower.set(name.toLowerCase(), { name, op: "set", value, fromBuiltin: true });
  }
  for (const rule of savedRules || []) {
    const name = rule.name?.trim();
    if (!name) continue;
    byLower.set(name.toLowerCase(), {
      name,
      op: rule.op || "set",
      value: rule.op === "remove" ? "" : (rule.value ?? ""),
      fromBuiltin: false,
    });
  }
  const rows = [...byLower.values()];
  return rows.length ? rows : [emptyRow()];
}

function validateRows(rows, blocked) {
  const seen = new Set();
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    if (!HEADER_NAME_RE.test(name)) return `Invalid header name: ${name}`;
    const lower = name.toLowerCase();
    if (blocked.includes(lower)) return `Header ${name} cannot be overridden`;
    if (seen.has(lower)) return `Duplicate header name: ${name}`;
    seen.add(lower);
    if (r.op !== "remove" && !String(r.value || "").trim()) return `Value required for ${name}`;
  }
  return null;
}

function buildRulesFromRows(rows, builtinHeaders, blocked) {
  const rules = [];
  for (const r of rows.filter((row) => row.name.trim())) {
    const name = r.name.trim();
    const lower = name.toLowerCase();
    if (blocked.includes(lower)) continue;
    const builtinVal = builtinHeaders?.[name] ?? builtinHeaders?.[Object.keys(builtinHeaders || {}).find((k) => k.toLowerCase() === lower) || ""];
    if (r.op === "remove") {
      rules.push({ name, op: "remove" });
      continue;
    }
    if (r.op === "set" && builtinVal === r.value) continue;
    rules.push({ name, op: r.op, value: r.value });
  }
  return rules;
}

function RuleEditor({ title, hint, rows, setRows, blocked, builtinHeaders }) {
  const setRow = (i, field, value) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs font-medium text-text-muted">{title}</p>
        {hint && <p className="mt-0.5 text-[11px] text-text-muted">{hint}</p>}
      </div>
      {rows.map((row, i) => {
        const overridden = row.fromBuiltin && row.op === "set" && row.value !== builtinHeaders?.[row.name.trim()];
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={row.name}
              onChange={(e) => setRow(i, "name", e.target.value)}
              placeholder="Header-Name"
              spellCheck={false}
              className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
            <select
              value={row.op}
              onChange={(e) => setRow(i, "op", e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              value={row.value}
              disabled={row.op === "remove"}
              onChange={(e) => setRow(i, "value", e.target.value)}
              placeholder={row.op === "remove" ? "—" : "Value"}
              spellCheck={false}
              className={`min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-40 ${
                overridden ? "border-amber-400/60" : "border-border"
              }`}
            />
            <button
              type="button"
              title="Remove row"
              onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [emptyRow()]))}
              className="shrink-0 text-text-muted hover:text-red-500"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, emptyRow()])}
        className="flex w-fit items-center gap-1 text-xs text-primary hover:underline"
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
        Add rule
      </button>
    </div>
  );
}

RuleEditor.propTypes = {
  title: PropTypes.string.isRequired,
  hint: PropTypes.string,
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  setRows: PropTypes.func.isRequired,
  blocked: PropTypes.arrayOf(PropTypes.string).isRequired,
  builtinHeaders: PropTypes.object,
};

export default function CustomConfigCard({ providerId, forceVisible = false }) {
  const notify = useNotificationStore();
  const [expanded, setExpanded] = useState(false);
  const [requestRows, setRequestRows] = useState([emptyRow()]);
  const [responseRows, setResponseRows] = useState([emptyRow()]);
  const [builtin, setBuiltin] = useState({});
  const [hasOverride, setHasOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/providers/${providerId}/overrides`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const builtinHeaders = data.builtinHeaders || {};
        setBuiltin(builtinHeaders);
        setRequestRows(mergeRowsForDisplay(builtinHeaders, data.request?.length ? data.request : legacyHeadersToRules(data.headers)));
        setResponseRows(mergeRowsForDisplay({}, data.response));
        setHasOverride(
          Object.keys(data.headers || {}).length > 0
          || (data.request?.length ?? 0) > 0
          || (data.response?.length ?? 0) > 0,
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [providerId]);

  const save = useCallback(async () => {
    const reqErr = validateRows(requestRows, BLOCKED_REQUEST);
    if (reqErr) {
      notify.error(reqErr);
      return;
    }
    const resErr = validateRows(responseRows, ["content-length", "transfer-encoding", "connection", "content-encoding", "set-cookie"]);
    if (resErr) {
      notify.error(resErr);
      return;
    }

    const request = buildRulesFromRows(requestRows, builtin, BLOCKED_REQUEST);
    const response = buildRulesFromRows(responseRows, {}, ["content-length", "transfer-encoding", "connection", "content-encoding", "set-cookie"]);

    setSaving(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, response }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify.error(err.error || "Failed to save");
        return;
      }
      const data = await res.json();
      setHasOverride((data.request?.length ?? 0) > 0 || (data.response?.length ?? 0) > 0);
      notify.success("Header rules saved");
    } finally {
      setSaving(false);
    }
  }, [requestRows, responseRows, builtin, providerId, notify]);

  const resetRequest = () => {
    setRequestRows(mergeRowsForDisplay(builtin, []));
  };

  if (!forceVisible && Object.keys(builtin).length === 0 && !hasOverride) return null;

  return (
    <Card padding="xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
          <span className="text-sm font-semibold">Custom Headers</span>
          {hasOverride && (
            <Badge variant="success" size="sm">Active</Badge>
          )}
        </div>
        <span className="material-symbols-outlined text-text-muted">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
          <RuleEditor
            title="Upstream request headers"
            hint="Applied after 9Router builds the provider request. Custom rules override registry defaults (set / add / remove)."
            rows={requestRows}
            setRows={setRequestRows}
            blocked={BLOCKED_REQUEST}
            builtinHeaders={builtin}
          />
          <RuleEditor
            title="Client response headers"
            hint="Applied on responses returned to your client (streaming and non-streaming). Rate-limit headers from upstream are still forwarded unless you override them."
            rows={responseRows}
            setRows={setResponseRows}
            blocked={["content-length", "transfer-encoding", "connection", "content-encoding", "set-cookie"]}
            builtinHeaders={{}}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={resetRequest}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.03] disabled:opacity-50"
            >
              Reset request defaults
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function legacyHeadersToRules(headers) {
  if (!headers || typeof headers !== "object") return [];
  return Object.entries(headers).map(([name, value]) => ({ name, op: "set", value }));
}

CustomConfigCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  forceVisible: PropTypes.bool,
};
