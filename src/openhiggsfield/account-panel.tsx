"use client";

import { useEffect, useRef, useState } from "react";
import { getBillingBalance, getSpendDaily, getMonthlyReport, getMonthlyCsv, getWebhookDeliveries } from "@/generation/actions";
import { apiErrorMessage, unwrapResult } from "./api-result";
import { saveText } from "./download";
import { CloseIcon } from "./icons";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const dollars = (value: unknown) => typeof value === "number" ? `$${(value / 1_000_000).toFixed(4)}` : "Unavailable";

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [balance, setBalance] = useState<Row>({});
  const [daily, setDaily] = useState<Row[]>([]);
  const [report, setReport] = useState<Row | null>(null);
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [start, setStart] = useState(new Date().toISOString().slice(0, 7) + "-01");
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [model, setModel] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(apiErrorMessage(caught)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    dialog.current?.showModal();
    void load(async () => setBalance(object(unwrapResult(await getBillingBalance()))));
  }, []);
  const postpaid = object(balance.postpaid);
  return <dialog ref={dialog} aria-labelledby="ohf-account-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <div className="ohf-dialog-panel ohf-account-panel">
      <div className="ohf-keys-head"><h2 id="ohf-account-title">Usage & billing</h2><button className="ohf-icon-btn" aria-label="Close" onClick={onClose}><CloseIcon /></button></div>
      {error && <p className="ohf-alert" role="alert">{error}</p>}
      <section><h3>Available funds</h3><p>{postpaid.active ? `Invoice cycle remaining: ${dollars(object(postpaid.cycle).remaining_micro_usd)}` : `Prepaid balance: ${dollars(balance.balance_micro_usd)}`}</p>
        <a href="https://dev.pika.art/billing" target="_blank" rel="noreferrer">Manage billing</a></section>
      <section><h3>Daily spend</h3><div className="ohf-account-fields">
        <label>From<input className="ohf-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Through<input className="ohf-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>Model (optional)<input className="ohf-input" value={model} onChange={(e) => setModel(e.target.value)} /></label>
        <label>API key ID (optional)<input className="ohf-input" value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)} /></label>
      </div><button className="ohf-btn-solid" disabled={busy} onClick={() => void load(async () => setDaily(rows(object(unwrapResult(await getSpendDaily({ start_date: start, end_date: end, model: model || undefined, api_key_id: apiKeyId || undefined }))).results)))}>Load spend</button>
        <table><thead><tr><th>Date</th><th>Model</th><th>Requests</th><th>Spend</th></tr></thead><tbody>{daily.map((row, i) => <tr key={i}><td>{String(row.date)}</td><td>{String(row.model ?? "All")}</td><td>{String(row.request_count)}</td><td>{dollars(row.amount_micro_usd)}</td></tr>)}</tbody></table></section>
      <section><h3>Monthly report</h3><p>Reports use UTC calendar months. A report still being prepared can be loaded again.</p><div className="ohf-account-fields"><label>Month<input className="ohf-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <button className="ohf-btn-solid" disabled={busy} onClick={() => void load(async () => setReport(object(unwrapResult(await getMonthlyReport(month)))))}>Load report</button>
        <button className="ohf-btn-solid" disabled={busy} onClick={() => void load(async () => saveText(unwrapResult(await getMonthlyCsv(month)), `pika-${month}.csv`))}>Download CSV</button></div>
        {report && <><p>Total charges: {dollars(object(report.totals).charges_micros)}</p><table><thead><tr><th>Model</th><th>Requests</th><th>Charges</th></tr></thead><tbody>{rows(report.lines).map((row, i) => <tr key={i}><td>{String(row.model ?? "Other")}</td><td>{String(row.billed_requests)}</td><td>{dollars(row.charges_micros)}</td></tr>)}</tbody></table></>}</section>
      <section><h3>Webhook deliveries</h3><a href="https://dev.pika.art/webhooks" target="_blank" rel="noreferrer">Manage webhook endpoints</a><p>Recent events and delivery attempts for this key’s organization.</p>
        <button className="ohf-btn-solid" disabled={busy} onClick={() => void load(async () => { const data = object(unwrapResult(await getWebhookDeliveries({ limit: 20 }))); setDeliveries(rows(data.results)); setCursor(typeof data.next_cursor === "string" ? data.next_cursor : undefined); })}>Refresh deliveries</button>
        <table><thead><tr><th>Event</th><th>Job</th><th>Status</th><th>Attempts</th></tr></thead><tbody>{deliveries.map((row, i) => <tr key={i}><td>{String(row.event_type ?? "Event")}</td><td>{String(row.source_id ?? "—")}</td><td>{String(row.status)}</td><td>{String(row.attempt_count)}</td></tr>)}</tbody></table>
        {cursor && <button className="ohf-btn-solid" disabled={busy} onClick={() => void load(async () => { const data = object(unwrapResult(await getWebhookDeliveries({ limit: 20, cursor }))); setDeliveries((prev) => [...prev, ...rows(data.results)]); setCursor(typeof data.next_cursor === "string" ? data.next_cursor : undefined); })}>More deliveries</button>}
      </section>
    </div>
  </dialog>;
}
