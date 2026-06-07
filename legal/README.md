# InboxPilot — Legal Documents

This directory holds legal templates that customers, prospects, and the InboxPilot team will reference during contracting and onboarding.

> **None of these documents have been reviewed by counsel.** They are starting templates adapted from publicly available open-source legal documents (the [Open Data Commons DPA](https://opendatacommons.org/) for the DPA, the [GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/github-terms/github-acceptable-use-policies) for the AUP) and customized for InboxPilot's data classes and sub-processor list. Each document must be reviewed and approved by qualified legal counsel before being signed by, or presented to, any tenant.

## Documents

| Document | Purpose | When to use |
|---|---|---|
| [`DPA.md`](./DPA.md) | Data Processing Agreement — GDPR/UK GDPR/CCPA-aligned terms governing InboxPilot's Processing of Personal Data on behalf of the Customer. | Every enterprise-ish customer; required by GDPR Art. 28 for EEA/UK Controllers; recommended for all commercial customers. |
| [`AUP.md`](./AUP.md) | Acceptable Use Policy — prohibited content and activities, AI-output disclaimer, enforcement and consequences. | Incorporated by reference into every MSA / Terms of Service. |

## How to use these templates

1. **Legal review first.** Send both documents to qualified counsel for review before any tenant is asked to sign or agree to them. The square-bracketed placeholders (`[ ... ]`) must be completed or confirmed.
2. **Counterparty data.** Complete the Parties block and the `[CUSTOMER_LEGAL_NAME]`, `[EFFECTIVE_DATE]`, and signature blocks per deal.
3. **Sub-processor list.** Verify Appendix A of the DPA against the live list at `[SUB-PROCESSOR_LIST_URL]` before signing.
4. **Region / transfer mechanism.** Confirm the customer's location and the applicable transfer mechanism (SCCs vs. adequacy). If you add tenants in new jurisdictions, revisit with counsel.
5. **BETA period.** During the closed beta, prefer the paper-lightest workflow: have tenants sign an MSA + click-through AUP and DPA, with the template versions referenced by URL and version number. `[TO BE REVIEWED BY COUNSEL: confirm click-through is sufficient for beta.]`

## Cross-references

- **Beta terms** (owned by the [beta program design card](#) — `t_pm_beta_program`) — `docs/BETA_TERMS.md` should link to `legal/DPA.md` and `legal/AUP.md` for the legal templates that design-partner tenants sign.
- **Security model** (one-pager, PM-authored) — see the security model card (`t_sec_security_model`) for the technical controls referenced in Section 7 of the DPA.
- **Incident response runbook** — see the IR card (`t_sec_incident_response`) for the operational detail behind the 72-hour breach notification in Section 8 of the DPA.

## Out of scope

The following are owned by other cards or by external counsel and are **not** produced by the legal-templates card:

- The legal review itself.
- A click-through click-wrap flow in the product (UI implementation).
- Customer-specific redlines and counter-offers.
- A `consent_records` data store and workflow (if required by counsel — see AUP § 3.2 note).
- A `t_sec_data_subject_rights` in-product flow (if required by counsel — see DPA § 9.2 note).
- A formal SOC 2 Type II audit (or equivalent) — see § 11.1 of the DPA.

## Change log

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1.0 | (initial) | pm | First-draft templates. Pre-counsel-review. |
