import { useState } from "react";
import type { ReviewPreview } from "../../src/review-export";

export function ReviewedExport({
  id,
  request,
}: {
  id: string;
  request: (path: string, body?: unknown) => Promise<Response>;
}) {
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  async function prepare() {
    setBusy(true);
    setError("");
    setStatus("");
    setPreview(null);
    setSelected([]);
    setAcknowledged(false);
    try {
      setPreview(
        await (
          await request("/review-export?id=" + encodeURIComponent(id))
        ).json(),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!preview) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await request("/review-export", {
        id,
        review: {
          snapshotDigest: preview.snapshotDigest,
          recordIds: selected,
          note,
          acknowledgedPartial: acknowledged,
          format,
        },
      });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `x-reviewed-${id}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(
        `Reviewed ${format.toUpperCase()} export downloaded. Original collection unchanged.`,
      );
    } catch (e) {
      setError((e as Error).message);
      setAcknowledged(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card padded reviewed-export"
      aria-label="Reviewed research export"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">RESEARCH HANDOFF</span>
          <h2>Choose what leaves the collection.</h2>
          <p>
            Review selected records with their capture limits. Raw exports above
            still contain the full collection.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => void prepare()}
          disabled={busy}
        >
          {preview ? "Reload review preview" : "Prepare reviewed export"}
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error} Your note is retained; reload the preview if its source
          changed.
        </p>
      )}
      {busy && <p role="status">Preparing the local handoff...</p>}
      {status && <p role="status">{status}</p>}
      {preview && (
        <>
          <div className="review-coverage">
            <h3>Partial-result review</h3>
            <p>
              Stopped: <strong>{preview.source.stopReason}</strong> ·{" "}
              {preview.rawCount} captured copies · {preview.uniqueCount} unique
              records · {preview.duplicateCopies} identical duplicate copies
              collapsed.
            </p>
            <p>
              {selected.length} selected ·{" "}
              {preview.uniqueCount - selected.length} excluded. Source file
              fingerprint: <code>{preview.snapshotDigest.slice(0, 16)}</code>
            </p>
            <ul>
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <fieldset disabled={busy}>
            <legend>Select records for this handoff</legend>
            <div className="button-row">
              <button
                className="button secondary small"
                onClick={() => {
                  setSelected(preview.records.map((r) => r.record.id));
                  setAcknowledged(false);
                }}
              >
                Select all records
              </button>
              <button
                className="button secondary small"
                onClick={() => {
                  setSelected([]);
                  setAcknowledged(false);
                }}
              >
                Clear selection
              </button>
            </div>
            <div className="review-records">
              {preview.records.map(({ record, originalIndices }) => (
                <article key={record.id}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      aria-label={`Include record ${record.id}`}
                      checked={selected.includes(record.id)}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked
                            ? [...selected, record.id]
                            : selected.filter((i) => i !== record.id),
                        );
                        setAcknowledged(false);
                      }}
                    />
                    <strong>Record {record.id}</strong>
                  </label>
                  <p>
                    {String(
                      record.text ??
                        record.description ??
                        record.bio ??
                        "No text field captured.",
                    )}
                  </p>
                  <p className="review-source">
                    {typeof record.url === "string"
                      ? record.url
                      : "No individual source URL captured"}{" "}
                    · Snapshot positions {originalIndices.join(", ")}
                  </p>
                  <details className="details">
                    <summary>Review all saved fields</summary>
                    <pre>{JSON.stringify(record, null, 2)}</pre>
                  </details>
                </article>
              ))}
            </div>
            <div className="field">
              <label htmlFor={`review-note-${id}`}>
                Researcher selection note
              </label>
              <textarea
                id={`review-note-${id}`}
                value={note}
                minLength={15}
                maxLength={2000}
                rows={3}
                placeholder="Explain why these records belong in the handoff and what the sample may miss."
                onChange={(e) => {
                  setNote(e.target.value);
                  setAcknowledged(false);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor={`review-format-${id}`}>
                Reviewed export format
              </label>
              <select
                id={`review-format-${id}`}
                value={format}
                onChange={(e) => setFormat(e.target.value as "json" | "csv")}
              >
                <option value="json">JSON evidence packet</option>
                <option value="csv">CSV with provenance in every row</option>
              </select>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I reviewed this selection and its partial-result warnings. This is
              not a complete archive or a fact-check.
            </label>
            <button
              className="button"
              disabled={
                !selected.length || note.trim().length < 15 || !acknowledged
              }
              onClick={() => void download()}
            >
              Download reviewed export
            </button>
          </fieldset>
          <p className="review-footnote">
            Local operator declaration, not verified identity or approval. No X
            session is opened and no account action is performed. Exported
            copies cannot be recalled.
          </p>
        </>
      )}
    </section>
  );
}
