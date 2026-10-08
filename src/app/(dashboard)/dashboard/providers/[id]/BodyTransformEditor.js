"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import PropTypes from "prop-types";
import { parseRuleJsonText } from "open-sse/utils/parseRuleJsonValue.js";
import { MAX_BODY_TRANSFORM_SCRIPT_CHARS } from "open-sse/utils/providerBodyTransform.shared.js";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const EDITOR_OPTS = {
  minimap: { enabled: false },
  fontSize: 12,
  lineNumbers: "on",
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
  tabSize: 2,
};

export default function BodyTransformEditor({
  providerId,
  enabled,
  setEnabled,
  script,
  setScript,
}) {
  const [examples, setExamples] = useState([]);
  const [limits, setLimits] = useState(null);
  const [examplesError, setExamplesError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sampleText, setSampleText] = useState("{\n  \n}");
  const [previewOut, setPreviewOut] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeExampleId, setActiveExampleId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/body-transform-examples", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.examples) return;
        setExamples(data.examples);
        setLimits(data.limits || null);
        if (data.examples[0] && !sampleText.trim().replace(/[{}\s]/g, "").length) {
          setSampleText(JSON.stringify(data.examples[0].sample, null, 2));
        }
      })
      .catch(() => {
        if (!cancelled) setExamplesError("Could not load examples");
      });
    return () => { cancelled = true; };
  }, []);

  const applyExample = useCallback((exampleId, opts = { openPreview: true }) => {
    const ex = examples.find((e) => e.id === exampleId);
    if (!ex) return;
    setActiveExampleId(ex.id);
    setScript(ex.script);
    setSampleText(JSON.stringify(ex.sample, null, 2));
    setEnabled(true);
    setPreviewOut("");
    setPreviewError("");
    if (opts.openPreview) setPreviewOpen(true);
  }, [examples, setScript, setEnabled]);

  const runPreview = useCallback(async () => {
    setPreviewError("");
    setPreviewOut("");
    const parsed = parseRuleJsonText(sampleText);
    if (!parsed.ok) {
      setPreviewError(parsed.error);
      return;
    }
    if (!script.trim()) {
      setPreviewError("Add a transform script first");
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/providers/${providerId}/overrides/body-transform-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleBody: parsed.value,
          bodyTransform: { enabled, script },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data.error || "Preview failed");
        return;
      }
      if (!data.ok) {
        setPreviewError(data.error || "Transform failed (body unchanged)");
        if (data.body) setPreviewOut(JSON.stringify(data.body, null, 2));
        return;
      }
      setPreviewOut(JSON.stringify(data.body, null, 2));
    } catch (e) {
      setPreviewError(e.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [providerId, sampleText, script, enabled]);

  const activeExample = examples.find((e) => e.id === activeExampleId);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-black/[0.02] p-3 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text-muted">Advanced body transform (JavaScript)</p>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-text-muted">
            Runs <strong className="font-medium">after</strong> translation and simple body field rules.
            Define <code className="text-[10px]">function transform(body) &#123; … return body; &#125;</code>.
            Example scripts live in{" "}
            <code className="text-[10px]">open-sse/body-transform-examples/</code> in the repo.
          </p>
          {limits && (
            <p className="mt-1 text-[10px] text-text-muted">
              Limits: JavaScript, max {limits.maxScriptChars?.toLocaleString()} chars, {limits.timeoutMs} ms timeout,
              sandboxed ({limits.failOpen ? "errors keep the previous body" : "fail-closed"}).
              No <code className="text-[10px]">require</code>/<code className="text-[10px]">import</code>/
              <code className="text-[10px]">fetch</code>/<code className="text-[10px]">process</code>.
            </p>
          )}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border/80 bg-background/50 p-2.5">
        <p className="text-[11px] font-medium text-text-muted">Examples (from repo files)</p>
        {examplesError && <p className="text-xs text-amber-600">{examplesError}</p>}
        {!examples.length && !examplesError && (
          <p className="text-[11px] text-text-muted">Loading examples…</p>
        )}
        <div className="flex flex-col gap-2">
          {examples.map((ex) => (
            <div
              key={ex.id}
              className={`rounded-md border p-2.5 text-[11px] ${
                activeExampleId === ex.id ? "border-primary/50 bg-primary/5" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{ex.label}</p>
                  <p className="mt-1 text-text-muted leading-relaxed">{ex.description}</p>
                  {ex.afterHint && (
                    <p className="mt-1 text-text-muted">
                      <span className="font-medium text-foreground/80">After transform: </span>
                      {ex.afterHint}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => applyExample(ex.id)}
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
                >
                  Use example
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        >
          {previewOpen ? "Hide preview" : "Preview on sample JSON"}
        </button>
        {activeExample && (
          <span className="self-center text-[10px] text-text-muted">
            Sample: {activeExample.label}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <MonacoEditor
          height="220px"
          language="javascript"
          theme="vs-dark"
          value={script}
          onChange={(v) => setScript(v ?? "")}
          options={EDITOR_OPTS}
        />
      </div>
      <p className="text-[10px] text-text-muted">
        Script size: {script.length.toLocaleString()} / {MAX_BODY_TRANSFORM_SCRIPT_CHARS.toLocaleString()} chars
      </p>

      {previewOpen && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-[11px] text-text-muted">Sample request body (JSON)</p>
          <textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            spellCheck={false}
            rows={10}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            disabled={previewLoading}
            onClick={runPreview}
            className="w-fit rounded-md bg-primary/90 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {previewLoading ? "Running…" : "Run preview"}
          </button>
          {previewError && (
            <p className="text-xs text-red-500">{previewError}</p>
          )}
          {previewOut && (
            <div>
              <p className="mb-1 text-[11px] text-text-muted">Transformed body (upstream)</p>
              <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[10px]">
                {previewOut}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

BodyTransformEditor.propTypes = {
  providerId: PropTypes.string.isRequired,
  enabled: PropTypes.bool.isRequired,
  setEnabled: PropTypes.func.isRequired,
  script: PropTypes.string.isRequired,
  setScript: PropTypes.func.isRequired,
};
