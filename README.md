# Arvexa

**The first cross-protocol debt management layer for Solana.**

[Live App](https://arvexa.io)

---

## What is Arvexa?

Arvexa is the first cross-protocol debt management layer for Solana. Lending is Solana's largest DeFi category at ~$3B TVL across five major protocols,
but every borrower manages positions in separate UIs with no neutral layer to compare, refinance, or optimize across them. Arvexa unifies positions from
Kamino, Save, and JupLend into one dashboard and refinances to the best protocol in one click, optimized for **net APY**, which combines headline rates
with collateral yield, liquidation buffer cost, and protocol risk.

## The problem

Active Solana borrowers face three problems today:

1. **Fragmented visibility:** positions spread across multiple protocols with no unified view of total collateral, debt, health, or P&L.
2. **Suboptimal rates:** borrowers overpay because comparing across protocols requires manually checking each UI and unwinding entire positions to migrate.
3. **No safety net:** protecting against liquidation or rate spikes requires constant monitoring and manual execution across multiple dashboards.

When JupLend launched, millions of dollars in borrows migrated manually. That alone tells you how broken the existing experience is.

## What Arvexa does

### Unified portfolio

- Connect wallet and instantly see every position across **Kamino, Save, and JupLend**
- Total net worth, daily P&L in dollars, and a global health gauge at a glance
- Per-protocol cards showing collateral, debt, health, and per-asset savings opportunities

### Per-protocol management page

- **Three simulators:** price, rates, and position to model outcomes before committing
- **One-click refinancing** with a smart pre-fill engine optimized for net APY (not just the cheapest borrow rate)
- **Debt repayment** with live health-impact preview
- Full transaction history with position lineage

### Aggregated new positions

- Open new positions through a unified flow that scores every supported protocol on yield, risk, and safety
- Choose your venue based on a risk-adjusted view, not just the headline rate

## Why now

- Solana lending is the largest DeFi category on-chain at **~$3B in TVL** in 2026, growing tremendously!
- **Millions of dollars** migrated manually during JupLend's launch, the demand signal is unambiguous
- DeFiSaver has managed hundreds of millions in DeFi debt positions on Ethereum over the past several years. Solana's lending market has no
  equivalent.
- Lulo aggregates yield for depositors; nobody manages debt for borrowers

## Demo

[![Watch the demo](docs/demo-thumbnail.png)](https://www.youtube.com/watch?v=7zqdymrpvk8)

## How it works

Arvexa reads on-chain position data directly from each lending protocol's program accounts, normalizes them into a unified schema, and routes user actions
(refinance, repay, open new position) through atomic transaction flows. The **net-APY optimizer** combines headline borrow/supply rates with collateral
yield, liquidation buffer cost, and a protocol risk score, surfacing the actual cost of capital, not the marketing number.

## Tech stack

- **Frontend:** Next.js
- **Solana:** @solana/web3.js, @solana/wallet-adapter
- **Protocol integrations:**
  - Live: Kamino, Save, JupLend
  - Integration complete, awaiting protocol resumption: Drift
  - Coming soon: Marginfi

## Roadmap

- **Now (hackathon submission):** Live across **Kamino, Save, and JupLend** with unified portfolio management, cross-protocol refinancing, simulators, and
  aggregated position creation. Drift integration complete (awaiting protocol resumption), Marginfi integration in progress.

- **Q3 2026: Public beta + first power users.** Launch publicly for Solana power borrowers with automated guardrails and refinancing triggers. Target:
  **300+ active users**, **$5M+ in managed debt positions**, and **$200k+ in measurable user savings delivered through refinancing and automation**.

- **Q4 2026: Automation + institutional tooling.** Launch programmable lending intents, automated execution infrastructure, and treasury-grade monitoring
  for advanced users and DAOs. Target: **$25M+ in managed positions**, **5+ institutional / power-user clients**, and monetization live through automation
  subscriptions, routing fees, and execution infrastructure.

- **2027: Credit automation layer for Solana.** Expand Arvexa from a user-facing platform into the execution and automation layer for Solana credit markets,
  powering wallets, treasury tools, and lending interfaces through APIs and embedded infrastructure. Goal: become the default automation layer for
  borrow/lend management across the Solana ecosystem.

## Links

- **Website:** https://arvexa.io
