# Data Processing Agreement (DPA) — InboxPilot

> **DRAFT — NOT LEGALLY REVIEWED**
>
> This is a starting template adapted from the [Open Data Commons DPA](https://opendatacommons.org/) and standard SaaS DPA structures, customized for InboxPilot's data classes and sub-processor list.
>
> **This document must be reviewed and approved by qualified legal counsel before any tenant is asked to sign it.** Square-bracketed text (`[ ... ]`) marks placeholders and decisions that require legal review.

**Effective Date:** `[EFFECTIVE_DATE]`
**Version:** 0.1.0 (template, pre-review)

---

## 1. Parties

This Data Processing Agreement ("**DPA**") is entered into between:

- **InboxPilot, Inc.** ("**Processor**" / "**we**" / "**us**"), the provider of the InboxPilot customer support platform, with principal place of business at `[PROCESSOR_ADDRESS]`.

- **`[CUSTOMER_LEGAL_NAME]`** ("**Controller**" / "**Customer**" / "**you**"), the customer identified in the underlying Master Services Agreement ("**MSA**") or Terms of Service.

The Controller and Processor are each a "**Party**" and together the "**Parties**."

This DPA supplements and forms part of the MSA. In the event of a conflict between this DPA and the MSA regarding the Processing of Personal Data, this DPA prevails.

---

## 2. Definitions

- **"Personal Data"** has the meaning given in the EU General Data Protection Regulation (Regulation (EU) 2016/679) ("**GDPR**") and includes equivalent terms under the UK GDPR, the California Consumer Privacy Act as amended by the CPRA ("**CCPA/CPRA**"), the LGPD, the PIPL, and other applicable data protection laws ("**Data Protection Laws**").
- **"Process"** and **"Processing"** mean any operation performed on Personal Data, whether or not by automated means.
- **"Sub-processor"** means any third party engaged by the Processor to Process Personal Data on behalf of the Controller.
- **"Data Subject"** means the identified or identifiable natural person to whom Personal Data relates.
- **"Special Category Data"** means Personal Data revealing racial or ethnic origin, political opinions, religious beliefs, trade union membership, genetic data, biometric data, data concerning health, sex life, or sexual orientation, and any equivalent under applicable law.
- **"Personal Data Breach"** means a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorized disclosure of, or access to Personal Data.
- **"Standard Contractual Clauses"** or **"SCCs"** means the standard contractual clauses for the transfer of Personal Data to third countries adopted by the European Commission Implementing Decision (EU) 2021/914.

Capitalized terms not defined here have the meanings given in the MSA or, failing that, in the GDPR.

---

## 3. Roles, Scope, and Details of Processing

### 3.1 Roles

The Parties acknowledge that, for Personal Data Processed under this DPA, the **Customer acts as Controller** and **InboxPilot acts as Processor**. Where the Customer is itself a Processor for an underlying end-customer (e.g., a reseller or system integrator), the Customer acts as Processor and InboxPilot acts as Sub-processor; in that case the Customer shall ensure it has a valid legal basis for the engagement and shall flow down substantially equivalent obligations on InboxPilot.

### 3.2 Subject Matter and Duration

InboxPilot Processes Personal Data only for the purpose of providing the InboxPilot platform (inbound and outbound SMS/email customer support, AI-assisted drafting and auto-reply, knowledge-base retrieval, agent UI, analytics) to the Controller in accordance with the MSA, and for the duration of the MSA plus a reasonable wind-down period not to exceed 30 days following termination, except as required by law.

### 3.3 Nature and Purpose of Processing

- Inbound message ingestion, normalization, and routing across SMS and email channels.
- AI-assisted drafting, classification, and (if enabled) auto-reply using third-party LLM providers.
- Retrieval-augmented generation over a per-tenant knowledge base (vector embeddings).
- Storage and display of conversation history to authorized Customer users.
- Operational analytics and audit logging for security, abuse detection, and product improvement.

### 3.4 Categories of Data Subjects

- The Customer's **end customers / contacts** who send inbound SMS or email messages to the Customer.
- The Customer's **authorized users** (agents, admins, owners) who use the InboxPilot UI.

### 3.5 Types of Personal Data ("Data Classes")

| Data Class | Examples | Source |
|---|---|---|
| **Contact identifiers (PII)** | Full name, phone number, email address, mailing address | Customer-provided on contact import; end-customer-provided in message body |
| **Message content** | Free-text SMS/email body, subject lines, attachments metadata, internal notes | End-customer and Customer agents |
| **Vector embeddings** | Numerical representations of message content and knowledge chunks used for semantic search | Derived from message content and Customer-uploaded documents |
| **Knowledge-base content** | Customer-uploaded documents (PDFs, text, FAQs) and their chunks/embeddings | Customer-uploaded |
| **Account / user data** | Email, role, organization membership, hashed password, last-login IP/timestamp | Customer-provided at signup |
| **Operational metadata** | Delivery status, provider message IDs, error logs, audit log entries | System-generated |
| **Cookies / session data** | Session tokens, CSRF tokens, anonymous usage analytics | System-generated |

**Special Category Data:** InboxPilot is not designed to process Special Category Data. The Customer shall not upload or cause to be uploaded Special Category Data through the platform. The Customer is responsible for scrubbing, redacting, or otherwise preventing the transmission of Special Category Data through the platform.

### 3.6 Processing Instructions

InboxPilot shall Process Personal Data only on documented instructions from the Controller, including with regard to transfers of Personal Data to a third country or international organization, unless required to do so by applicable law (in which case InboxPilot shall inform the Controller of that legal requirement before Processing, unless that law prohibits such information on important grounds of public interest). The MSA and this DPA constitute the Controller's complete and final instructions. Additional instructions outside the scope of the MSA require a written change order.

---

## 4. Sub-processors

### 4.1 Current Sub-processors

The Controller authorizes InboxPilot to engage the following Sub-processors:

| Sub-processor | Purpose | Data Processed | Region |
|---|---|---|---|
| **InsForge, Inc.** | Managed Postgres database, auth, edge functions, file storage, realtime | All tenant data (full database) | US (configurable) |
| **OpenRouter** | LLM inference (AI drafting, classification, auto-reply) | Message content, knowledge chunks (no persistent storage) | US (per model) |
| **Twilio Inc.** | Inbound/outbound SMS delivery, phone-number provisioning | Phone numbers, message bodies, delivery status | US / regional |
| **Telnyx / alternate SMS provider** *(optional, only if Customer enables)* | Inbound/outbound SMS delivery | Phone numbers, message bodies, delivery status | US / regional |
| **Postmark (ActiveCampaign)** | Inbound/outbound email delivery | Email addresses, message bodies, delivery status | US |

A current list is maintained at `[SUB-PROCESSOR_LIST_URL]` and is updated at least 30 days before a new Sub-processor is engaged.

### 4.2 New Sub-processors

InboxPilot shall provide the Controller with at least **30 days' prior written notice** (by email to the Customer's admin contact and via the in-app notice) of any new or replacement Sub-processor. During that period, the Controller may object on reasonable, documented data-protection grounds. The Parties shall work in good faith to resolve the objection. If unresolved, the Controller may terminate the affected services for cause without further liability, with a pro-rata refund of any prepaid fees for the unused portion of the subscription term.

### 4.3 Sub-processor Obligations

InboxPilot imposes on each Sub-processor data-protection terms no less protective than those in this DPA, including appropriate technical and organizational measures. InboxPilot remains fully liable to the Controller for the performance of each Sub-processor's obligations.

---

## 5. Data Location and International Transfers

### 5.1 Primary Region

InboxPilot's primary data region is the United States (`us-east-1`). Customer data is stored in the United States by default. `[TO BE REVIEWED BY COUNSEL: confirm whether a regional residency option is available at general availability and how it is selected per tenant.]`

### 5.2 Transfer Mechanisms

Where Personal Data is transferred from the EEA, UK, or Switzerland to a country not recognized by the European Commission, UK government, or Swiss Federal Data Protection and Information Commissioner as providing an adequate level of protection, the Parties rely on:

1. **EU Standard Contractual Clauses (Module 2: Controller-to-Processor)** — the SCCs are incorporated by reference and the Parties are deemed to have executed them. In the event of any conflict between the SCCs and this DPA, the SCCs prevail.
2. **UK International Data Transfer Addendum** (where applicable) — the UK addendum issued by the UK ICO, as in force from time to time, is incorporated.
3. **Swiss FDPIC equivalent clauses** (where applicable) — incorporated to the extent required.

Annexes I–III of the SCCs are populated as follows:

- **Annex I.A (List of Parties):** Controller = Customer entity identified in the Order Form; Processor = InboxPilot, Inc. at `[PROCESSOR_ADDRESS]`. Contact: `[DPO_EMAIL]`. `[TO BE REVIEWED BY COUNSEL: confirm whether the data importer contact must be a named individual or DPO.]`
- **Annex I.B (Description of Transfer):** see Section 3 of this DPA.
- **Annex II (Technical and Organizational Measures):** see Section 8 of this DPA.
- **Annex III (Sub-processors):** see Section 4.1 of this DPA.

---

## 6. Confidentiality

InboxPilot ensures that persons authorized to Process Personal Data are committed to confidentiality (via written confidentiality agreements or statutory obligations of professional secrecy) and Process Personal Data only as necessary to perform the services.

---

## 7. Security of Processing

### 7.1 Technical and Organizational Measures

InboxPilot implements and maintains at minimum the following technical and organizational measures ("**TOMs**"), as further described at `[SECURITY_PAGE_URL]`:

- **Encryption in transit:** TLS 1.2 or higher for all client and provider traffic.
- **Encryption at rest:** AES-256 or equivalent for all production databases and object storage.
- **Access control:** Role-based access control with least-privilege defaults; multi-tenant isolation via PostgreSQL Row Level Security (RLS); per-user authentication via JWT with short-lived access tokens.
- **Authentication:** Argon2id (or equivalent) password hashing; optional MFA `[TO BE REVIEWED BY COUNSEL: confirm whether MFA is mandatory for admin accounts or only recommended]`.
- **Network controls:** Private subnets for compute; security groups / WAFs; rate limiting on public endpoints.
- **Logging and monitoring:** Structured application logging; per-tenant audit log of authentication, configuration changes, and data access events; alerting on anomalous patterns.
- **Backups:** Encrypted daily backups with point-in-time recovery; tested restores at least quarterly.
- **Vulnerability management:** Dependency scanning on every build; `[TO BE REVIEWED BY COUNSEL: confirm cadence of penetration testing — annually is typical]`.
- **Personnel security:** Background checks for personnel with production access `[TO BE REVIEWED BY COUNSEL: confirm scope]`.
- **Incident response plan:** documented runbook, tabletop exercises annually.

### 7.2 Updates to TOMs

InboxPilot may update the TOMs from time to time provided that the level of security is not materially decreased. Material decreases are communicated in accordance with Section 13.4.

---

## 8. Personal Data Breaches

### 8.1 Notification

InboxPilot shall notify the Controller without undue delay, and in any case within **72 hours**, of becoming aware of a Personal Data Breach affecting the Controller's Personal Data ("**Breach Notice**").

### 8.2 Content of Notice

The Breach Notice shall include, to the extent then known:

1. The nature of the Breach, including categories and approximate numbers of Data Subjects and records affected.
2. The name and contact details of InboxPilot's point of contact.
3. The likely consequences of the Breach.
4. The measures taken or proposed to address the Breach and mitigate adverse effects.

InboxPilot shall provide reasonable cooperation and assistance to the Controller in fulfilling the Controller's obligations to notify competent supervisory authorities and affected Data Subjects under applicable Data Protection Laws.

### 8.3 No Acknowledgement of Fault

A Breach Notice is provided for the Controller's regulatory compliance and is not an acknowledgement by InboxPilot of fault or liability.

---

## 9. Data Subject Rights

### 9.1 InboxPilot's Assistance

InboxPilot shall, taking into account the nature of the Processing, make available to the Controller the ability to fulfill Data Subject requests, including:

- **Access** — provide a copy of Personal Data Processed about a Data Subject on request.
- **Deletion** — erase Personal Data on request, subject to legal retention obligations.
- **Export / Portability** — export conversations, messages, and contact data in a structured, commonly used, machine-readable format (JSON, CSV).
- **Correction** — update or correct inaccurate Personal Data on request.
- **Restriction / Objection** — restrict or stop Processing on receipt of a valid request.

### 9.2 Functionality

The InboxPilot UI exposes these capabilities to authorized users (typically the Customer's Owner and Admin roles) at:

- **Self-serve:** Settings → Privacy → "Subject requests" `[TO BE REVIEWED BY COUNSEL: confirm final in-app path; see also `t_sec_data_subject_rights` roadmap card]`
- **Email fallback:** `[PRIVACY_EMAIL]` (e.g., `privacy@inboxpilot.com`)

### 9.3 Fees

InboxPilot shall not charge the Controller for fulfilling Data Subject requests, except where requests are manifestly unfounded or excessive, in which case InboxPilot may charge a reasonable fee reflecting the administrative cost.

---

## 10. Data Protection Impact Assessment and Prior Consultation

InboxPilot shall, on reasonable request, provide the Controller with information necessary to conduct a Data Protection Impact Assessment ("**DPIA**") or to consult with a supervisory authority, taking into account the nature of the Processing and the information available to InboxPilot. Any such assistance beyond the documented functionality of the platform may be subject to a separate services agreement.

---

## 11. Audits

### 11.1 Audit Rights

InboxPilot shall make available to the Controller, on reasonable request, all information necessary to demonstrate compliance with this DPA, by providing:

- A current SOC 2 Type II report (or equivalent third-party attestation) `[TO BE REVIEWED BY COUNSEL: confirm target — SOC 2 Type II is typical; ISO 27001 is common internationally]`.
- Responses to a written security questionnaire (e.g., CAIQ, SIG, or a custom security review).
- A summary of any penetration test results and remediation status, on a confidential basis.

### 11.2 On-Site Audits

The Controller may, no more than once per 12-month period and on at least 60 days' prior written notice, conduct an on-site audit of InboxPilot's Processing activities, provided that:

1. The audit is conducted during normal business hours and in a manner that does not unreasonably disrupt InboxPilot's operations.
2. The audit is scoped to the Controller's data and to controls relevant to this DPA.
3. The auditor executes a confidentiality agreement reasonably acceptable to InboxPilot.
4. The audit findings are shared with InboxPilot and treated as confidential.

In lieu of an on-site audit, the Parties may mutually agree to accept a third-party audit report.

### 11.3 Costs

The Controller bears its own costs of any audit. InboxPilot bears its own costs of making personnel and systems available.

---

## 12. Return and Deletion of Personal Data

### 12.1 On Termination

On termination of the MSA, and subject to applicable law, InboxPilot shall, at the Controller's choice:

1. Return the Personal Data to the Controller in a structured, commonly used, machine-readable format (e.g., JSON or CSV); and/or
2. Delete the Personal Data, including all copies, except where retention is required by applicable law.

### 12.2 Window

Return or deletion shall be completed within **30 days** of termination, subject to a written request from the Controller made within that period. In the absence of a written instruction, InboxPilot may delete the Personal Data at its sole discretion after 30 days.

### 12.3 Legal Retention

Notwithstanding the foregoing, InboxPilot may retain Personal Data to the extent and for so long as required by applicable law, provided that the retained Personal Data remains subject to this DPA.

---

## 13. General Provisions

### 13.1 Liability

Liability under this DPA is subject to the limitation-of-liability provisions of the MSA, except where a stricter standard is required by applicable Data Protection Laws (in which case the stricter standard prevails for the affected Processing).

### 13.2 Order of Precedence

In the event of a conflict in respect of the Processing of Personal Data, the order of precedence is: (1) the SCCs (if applicable); (2) this DPA; (3) the MSA.

### 13.3 Changes to Data Protection Laws

If a change in Data Protection Laws materially affects the Parties' rights or obligations, the Parties shall negotiate in good faith to amend this DPA to maintain the original level of protection.

### 13.4 Material Changes

InboxPilot may update this DPA from time to time to reflect changes in law, regulation, or the InboxPilot platform. Material changes that materially decrease the Controller's rights or InboxPilot's obligations shall be communicated to the Controller with at least 30 days' prior notice. If the Controller does not agree to the change, the Controller may terminate the affected services without further liability.

### 13.5 Severability

If any provision of this DPA is held to be invalid or unenforceable, the remainder shall continue in full force and effect.

### 13.6 Governing Law and Venue

This DPA is governed by the laws of `[JURISDICTION]`, without regard to conflict-of-laws principles, and any dispute shall be resolved in the courts of `[VENUE]`, except where Data Protection Laws require a different forum.

---

## 14. Regulatory Cooperation

The Parties shall cooperate in good faith with respect to investigations, complaints, audits, and inquiries from competent supervisory authorities concerning the Processing of Personal Data under this DPA. InboxPilot shall not respond directly to a supervisory authority on behalf of the Controller without prior written consent, except as required by law.

---

## 15. California-Specific Terms (CCPA/CPRA)

To the extent the CCPA/CPRA applies, the Parties agree:

- InboxPilot is a "**service provider**" within the meaning of the CCPA/CPRA.
- InboxPilot shall not (a) Sell or Share Personal Information; (b) retain, use, or disclose Personal Information outside the direct business relationship with the Customer; or (c) combine Personal Information received from the Customer with Personal Information received from any other source, except as permitted under § 1798.140(ag)(1) of the CCPA/CPRA.
- InboxPilot certifies that it understands and will comply with these restrictions.

---

## 16. UK-Specific Terms (UK GDPR)

To the extent the UK GDPR applies, references to "GDPR" are read as references to the UK GDPR, references to the European Commission are read as references to the UK ICO, and the EU SCCs are read with the UK International Data Transfer Addendum in force.

---

## 17. Signatures

`[TO BE REVIEWED BY COUNSEL: confirm whether e-signature (DocuSign / HelloSign) is acceptable; whether counterparty must be the entity named in the MSA or a separate DPA signature block is required.]`

**InboxPilot, Inc.**

By: `______________________________`
Name: `[NAME]`
Title: `[TITLE]`
Date: `[DATE]`

**`[CUSTOMER_LEGAL_NAME]`**

By: `______________________________`
Name: `[NAME]`
Title: `[TITLE]`
Date: `[DATE]`

---

## Appendix A — Sub-processor Detail (to be completed)

For each Sub-processor, record: legal entity, contact, processing purpose, data classes, transfer region, transfer mechanism (SCCs / adequacy / BCRs), and link to the Sub-processor's public privacy / security page.

| Sub-processor | Legal Entity | Security URL | DPA URL |
|---|---|---|---|
| InsForge | `[InsForge, Inc., [address]]` | `[URL]` | `[URL]` |
| OpenRouter | `[OpenRouter, [address]]` | `[URL]` | `[URL]` |
| Twilio | `[Twilio Inc., [address]]` | `[URL]` | `[URL]` |
| Telnyx | `[Telnyx, [address]]` | `[URL]` | `[URL]` |
| Postmark | `[ActiveCampaign, [address]]` | `[URL]` | `[URL]` |

---

## Appendix B — Data Subject Request Workflow

Outline the operational steps the Customer should follow to submit and track a Data Subject request via the InboxPilot UI, including:

1. **Identify** the Data Subject (per the Customer's identity-verification policy).
2. **Submit** the request in-product or via the privacy inbox email.
3. **Track** the request in the Customer's audit log.
4. **Fulfill** within the statutory window (typically 30 days under GDPR/UK GDPR; 45 days under CCPA/CPRA).
5. **Notify** the Data Subject and, if applicable, supervisory authorities.

`[TO BE REVIEWED BY COUNSEL: confirm statutory windows and the policy on partial fulfillment (e.g., a partial export with redactions for other tenants' data).]`

---

*End of DPA template.*
