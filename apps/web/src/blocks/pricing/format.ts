import { formatCents, type Billing, type CadenceAmounts } from "@bridger/shared";

export const CADENCE_SUFFIX: Record<Billing, string> = { one_time: "", monthly: "/mo", quarterly: "/qtr", yearly: "/yr" };
export const CADENCE_LABEL: Record<Billing, string> = { one_time: "One-time", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
export const CADENCES: Billing[] = ["one_time", "monthly", "quarterly", "yearly"];

export const money = (cents: number, billing: Billing = "one_time") => `${formatCents(cents)}${CADENCE_SUFFIX[billing]}`;

/** Non-zero cadences, one-time first. Returns [["one_time", 0]] when everything is zero. */
export function cadenceParts(amounts: CadenceAmounts): [Billing, number][] {
  const parts = CADENCES.filter((c) => amounts[c] !== 0).map((c) => [c, amounts[c]] as [Billing, number]);
  return parts.length ? parts : [["one_time", 0]];
}

export const formatQuantity = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0$/, ""));
