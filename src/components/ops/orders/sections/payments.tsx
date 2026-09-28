"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import type { OpsOrderDetail } from "@/server/ops/orders";
import { PAYMENT_KINDS, PAYEES } from "@/db/enums";
import { FormShell } from "@/components/shared/form-shell";
import { PaymentStatusChip } from "@/components/shared/chips";
import { Money, DateTime, Pct } from "@/components/shared/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { markPaymentPaidAction, setPaymentDueDateAction, addPaymentAction, waivePaymentAction } from "@/app/(ops)/ops/orders/actions";
import { OrderSection, useAct, TextField, DateField, SelectField, fd, str, opt, minor } from "../ui";
import { PAYEE } from "../strings";
import { today } from "@/server/shared/clock";

/** 02 Payments — kind · % · amount · payee · due · paid (date + reference) · Mark paid. Totals row. */
export function PaymentsSection({ d }: { d: OpsOrderDetail }) {
  const tk = useTranslations("payment_kind");
  const o = d.order;
  const open = d.payments.filter((p) => p.status === "pending").length;
  const total = d.payments.reduce((s, p) => (p.status === "waived" ? s : s + p.amountMinor), 0);
  const paid = d.payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountMinor, 0);
  return (
    <OrderSection id="payments" number={2} title="Payments" count={open} action={<AddPaymentSheet orderId={o.id} orderRef={o.ref} />}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm" data-testid="payments-table">
          <thead>
            <tr className="rule-ink text-left text-2xs font-semibold uppercase tracking-[0.06em] text-foreground">
              <th className="h-9 px-3">Kind</th><th className="h-9 px-3 text-right">%</th><th className="h-9 px-3 text-right">Amount</th><th className="h-9 px-3">Payee</th><th className="h-9 px-3">Due</th><th className="h-9 px-3">Paid</th><th className="h-9 px-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {d.payments.map((p) => (
              <tr key={p.id} className="border-b border-hairline-faint last:border-b-0" data-testid="payment-row" data-kind={p.kind} data-status={p.status}>
                <td className="h-10 px-3 font-medium text-foreground">{tk(p.kind)}</td>
                <td className="h-10 px-3 text-right font-mono text-[13px] text-ink-2">{p.pct !== null ? <Pct pct={p.pct} /> : "—"}</td>
                <td className="h-10 px-3 text-right"><Money minor={p.amountMinor} currency={p.currency} strong /></td>
                <td className="h-10 px-3"><Badge variant={p.payee === "factory" ? "outline" : "neutral"}>{PAYEE[p.payee]}</Badge></td>
                <td className="h-10 px-3 font-mono text-[13px]">{p.dueOn ? <span className={p.overdue ? "font-medium text-warning" : "text-ink-2"}><DateTime value={p.dueOn} variant="short" />{p.overdue && " · overdue"}</span> : p.status === "pending" && p.kind === "balance" ? <span className="text-muted-foreground">on QC pass</span> : <span className="text-faint">—</span>}</td>
                <td className="h-10 px-3">
                  {p.status === "paid" ? <span className="inline-flex items-center gap-2 font-mono text-[13px]"><PaymentStatusChip status="paid" /><DateTime value={p.paidAt} variant="short" />{p.reference && <span className="text-muted-foreground">{p.reference}</span>}</span>
                    : p.status === "waived" ? <PaymentStatusChip status="waived" />
                    : <MarkPaidSheet paymentId={p.id} kind={tk(p.kind)} amount={<Money minor={p.amountMinor} currency={p.currency} strong />} orderRef={o.ref} />}
                </td>
                <td className="h-10 px-3 text-right">
                  {p.status === "pending" && (
                    <span className="inline-flex gap-1">
                      <DueDateSheet paymentId={p.id} dueOn={p.dueOn} kind={tk(p.kind)} orderRef={o.ref} />
                      {o.isAdmin && <WaiveButton paymentId={p.id} />}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-rule-ink font-medium">
              <td className="h-10 px-3" colSpan={2}>Total</td>
              <td className="h-10 px-3 text-right"><Money minor={total} currency={o.currency} strong /></td>
              <td className="h-10 px-3" colSpan={2}></td>
              <td className="h-10 px-3 font-mono text-[13px] text-ink-2">paid <Money minor={paid} currency={o.currency} /></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </OrderSection>
  );
}

function MarkPaidSheet({ paymentId, kind, amount, orderRef }: { paymentId: string; kind: string; amount: React.ReactNode; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell
      trigger={<Button size="sm" variant="outline" data-testid="mark-paid">Mark paid</Button>}
      eyebrow={orderRef} title={`Mark ${kind.toLowerCase()} paid`} description={<span>Amount {amount}. The client sees &ldquo;Paid&rdquo; and the date — never the reference.</span>} submitLabel="Record payment"
      onSubmit={async (e) => { const f = fd(e); return act(() => markPaymentPaidAction({ paymentId, reference: str(f, "reference"), paidAt: opt(f, "paidAt") ?? undefined }), { success: `${kind} recorded as paid` }); }}
    >
      <TextField name="reference" label="Bank reference" placeholder="WIRE-0922-A" required mono autoFocus hint="At least 3 characters." />
      <DateField name="paidAt" label="Paid on" defaultValue={today()} required />
    </FormShell>
  );
}

function DueDateSheet({ paymentId, dueOn, kind, orderRef }: { paymentId: string; dueOn: string | null; kind: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="ghost">Due date</Button>} eyebrow={orderRef} title={`${kind} due date`} submitLabel="Save"
      onSubmit={async (e) => { const f = fd(e); return act(() => setPaymentDueDateAction({ paymentId, dueOn: opt(f, "dueOn") }), { success: "Due date saved" }); }}>
      <DateField name="dueOn" label="Due on" defaultValue={dueOn} hint="Leave empty for “on QC pass” (balance)." />
    </FormShell>
  );
}

function WaiveButton({ paymentId }: { paymentId: string }) {
  const { act, pending } = useAct();
  return <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => { if (confirm("Waive this payment?")) void act(() => waivePaymentAction({ paymentId }), { success: "Waived" }); }}>Waive</Button>;
}

function AddPaymentSheet({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const { act } = useAct();
  return (
    <FormShell trigger={<Button size="sm" variant="ghost">Add payment</Button>} eyebrow={orderRef} title="Add payment" submitLabel="Add"
      onSubmit={async (e) => { const f = fd(e); return act(() => addPaymentAction({ orderId, kind: str(f, "kind") as (typeof PAYMENT_KINDS)[number], amountMinor: minor(f, "amount"), dueOn: opt(f, "dueOn"), payee: str(f, "payee") as (typeof PAYEES)[number] }), { success: "Payment added" }); }}>
      <SelectField name="kind" label="Kind" defaultValue="sample" options={PAYMENT_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} />
      <TextField name="amount" label="Amount (USD)" placeholder="45.00" required mono />
      <SelectField name="payee" label="Payee" defaultValue="agency" options={PAYEES.map((k) => ({ value: k, label: PAYEE[k] }))} />
      <DateField name="dueOn" label="Due on" />
    </FormShell>
  );
}
