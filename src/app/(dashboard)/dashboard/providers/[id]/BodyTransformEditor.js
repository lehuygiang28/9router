"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import PropTypes from "prop-types";
import { parseRuleJsonText } from "open-sse/utils/parseRuleJsonValue.js";
import {
  DEFAULT_BODY_TRANSFORM_EXAMPLE,
  DEFAULT_BODY_TRANSFORM_SAMPLE,
} from "open-sse/utils/providerBodyTransform.shared.js";

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sampleText, setSampleText] = useState(
    () => JSON.stringify(DEFAULT_BODY_TRANSFORM_SAMPLE, null, 2),
  );
  const [previewOut, setPreviewOut] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const insertExample = useCallback(() => {
    setScript(DEFAULT_BODY_TRANSFORM_EXAMPLE);
    setEnabled(true);
  }, [setScript, setEnabled]);

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
      setPreviewOut(JSON.stringify(data.body, null, 2));
    } catch (e) {
      setPreviewError(e.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [providerId, sampleText, script, enabled]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-black/[0.02] p-3 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text-muted">Advanced body transform (JavaScript)</p>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-text-muted">
            Runs on the upstream JSON <strong className="font-medium">after</strong> translation and body field rules.
            Define <code className="text-[10px]">function transform(body) &#123; … return body; &#125;</code>.
            Use <code className="text-[10px]">helpers</code> for common patterns (e.g. move Anthropic{" "}
            <code className="text-[10px]">system</code> into the first <code className="text-[10px]">user</code> message).
            Scripts run in a short-timeout sandbox on this server — only enable for providers you control.
          </p>
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={insertExample}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        >
          Insert system → user example
        </button>
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
        >
          {previewOpen ? "Hide preview" : "Preview on sample JSON"}
        </button>
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

      {previewOpen && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-[11px] text-text-muted">Sample request body (JSON)</p>
          <textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            spellCheck={false}
            rows={8}
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
              <p className="mb-1 text-[11px] text-text-muted">Transformed body</p>
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
