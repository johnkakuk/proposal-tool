# Roadmap

Ideas that came up after launch, roughly in priority order. Each one notes why it matters and what it touches, so it can be picked up cold.

## Next

### Client-adjustable quantities in pricing tables

**Why:** Some add-ons are priced per unit, like "$100 per extra post". Today a pricing item has a fixed quantity, so the client can only take it or leave it at that quantity. Per-unit add-ons end up written into the package description, the pricing notes, and the terms instead of the table, and the signed total doesn't include them. (First hit while Claude drafted a real proposal on 2026-09-25.)

**What it looks like:** the owner (or the AI) marks an item as adjustable, with a minimum, maximum, and step, e.g. 0–20 posts. The public viewer shows a − / + stepper on that line. Totals update live, and the chosen quantity is part of what the client signs.

**Touches:**
- `packages/shared/src/schemas/pricing.ts`: an optional `adjustable: { min, max, step }` on `PricingItem`. Selections gain per-item quantities, e.g. `quantities: Record<itemId, number>` next to `SelectionsSchema`.
- `packages/shared/src/pricing.ts`: apply quantity overrides before line subtotals, clamped to the item's bounds. It's still integer cents with the same rounding order, and it needs unit tests in `pricing.test.ts`.
- **Signing** (`services/signing.ts`): the server validates and clamps the quantities, recomputes totals from the published pricing (as it does for selections), and records the quantities in the signature snapshot, the certificate, and the signed PDF.
- **Viewer and editor:** the stepper in `PricingTable.tsx`. In the editor, the item form gets an "Client can change quantity" toggle with min/max/step.
- **Tracking:** log quantity changes as pricing interactions, so analytics show what clients tried.
- **AI:** the block schema and examples in the registry, so Claude and ChatGPT can create adjustable items. The MCP `set_pricing` / `replace_content` paths pick it up through the shared schemas.
- **Compatibility:** items without `adjustable` behave exactly as today, and existing signed snapshots stay valid.

### Fix: drafts show no expiration date

**Bug:** a new draft has no `expires_at`, whether it was made in the app or through the connector. The Settings default (30 days) is only applied at publish, as 30 days from that moment (`services/publish.ts`). So the editor and the AI both see a blank expiry and it looks like the setting is ignored. It also lands at an arbitrary time of day instead of the end of a day. (Reported 2026-09-25: John set Oct 24, 11:59 PM Pacific by hand on a Claude-drafted proposal.)

**Fix:**
- Make the default visible before publishing. Either show "Expires 30 days after publishing (Oct 25)" in the editor's expiry field while it's empty, or set `expires_at` when the proposal is created (`services/proposals.ts`, covering app, REST, and MCP). Showing the default is safer, because a draft that sits for weeks would otherwise publish with an expiry that's already close or past. Publish keeps filling it in if it's still empty.
- Round the default to **11:59 PM in the owner's timezone** (Settings → timezone) on the last day, both at publish and in the preview text, using the existing `localTime` helpers.
- Tell the AI: `get_proposal` / `create_proposal` responses should say what the expiry will be at publish, so Claude can report it or set a different one.
- Tests: an integration test for the publish default (end of day, owner timezone, DST boundary), plus the editor hint.

## Later

- **Check for a remount on the Clients page.** In local e2e runs with 460+ clients, going back to Clients re-rendered the whole list and scrolled to the top about 80ms after it appeared, which closed a ⋮ menu that had just opened. A clean database doesn't reproduce it. Look at the lazy route or auth wrapper remounting on back navigation.

- **Drawn owner signature.** The owner signature is typed only; clients can already draw theirs.
- **Git push-to-release.** A Git-connected Pages project plus Workers Builds, so pushing to `main` deploys (see README → Production).
- **Automated reminder emails to clients** (listed as out of v1 in SPEC.md).
- **QuickBooks integration**, e.g. creating an invoice when a proposal is signed (out of v1).
- **Payment collection** (Stripe or similar; out of v1). It must stay within free tiers or be pay-per-use only.
- **Multiple signers or countersigning** (out of v1; the schema allows it).
- **Team accounts** (out of v1; `owner_id` is already on every row).
