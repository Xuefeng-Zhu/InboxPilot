# Acceptable Use Policy (AUP) — InboxPilot

> **DRAFT — NOT LEGALLY REVIEWED**
>
> This is a starting template adapted from the [GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/github-terms/github-acceptable-use-policies) and standard SaaS AUP structures, customized for InboxPilot's SMS/email + AI auto-reply use case.
>
> **This document must be reviewed and approved by qualified legal counsel before any tenant is asked to agree to it.** Square-bracketed text (`[ ... ]`) marks placeholders and decisions that require legal review.

**Effective Date:** `[EFFECTIVE_DATE]`
**Version:** 0.1.0 (template, pre-review)

---

## 1. Introduction and Scope

This Acceptable Use Policy ("**AUP**") governs your use of the InboxPilot customer-support platform (the "**Service**"). It is incorporated into and forms part of the Master Services Agreement ("**MSA**") or Terms of Service between you ("**Customer**" or "**you**") and InboxPilot, Inc. ("**InboxPilot**," "**we**," or "**us**"). Capitalized terms not defined here have the meanings given in the MSA.

By using the Service, you agree to comply with this AUP. You are responsible for the acts and omissions of your end users (your agents, admins, owners, and any person or system accessing the Service under your account).

**Scope of "use":** This AUP applies to (a) content you send, receive, process, store, or transmit through the Service; (b) the manner in which you configure the Service; and (c) any automated systems, scripts, or third-party integrations you connect to the Service.

---

## 2. AI-Generated Content Disclaimer

InboxPilot is an AI-assisted customer-support tool. AI-generated content — including but not limited to AI-drafted replies, AI auto-replies, AI classifications, AI-extracted entities, and AI-generated summaries — is produced by large language models and **may be inaccurate, incomplete, misleading, or otherwise unsuitable for the context in which it is used**.

**You acknowledge and agree that:**

1. **AI outputs are not reviewed by a human unless you configure the Service in "draft" mode.** In "auto-reply" mode, AI-generated replies are sent to your end customers without a human in the loop.
2. **You are solely responsible for reviewing AI outputs before they are acted upon or sent**, including for high-stakes topics (legal, medical, financial, safety) where errors could cause harm. InboxPilot's deterministic escalation engine flags many of these topics, but it is not exhaustive and does not replace human judgment.
3. **InboxPilot makes no warranty as to the accuracy, completeness, fitness for a particular purpose, or non-infringement of AI outputs.** AI outputs are provided "as is."
4. **You shall not rely on AI outputs as a substitute for professional advice** (legal, medical, financial, or otherwise) for your end customers, and you shall include a clear disclaimer to that effect in any AI-assisted or AI-sent message where context requires it. A suggested short-form disclaimer is provided in Section 12.

This disclaimer is a material term of the AUP. If you do not accept it, do not use the auto-reply or AI-drafting features.

---

## 3. Prohibited Content and Activities

You shall not, and shall not permit any end user or third party under your account to, use the Service to send, process, store, or transmit any content, or to engage in any activity, that:

### 3.1 Illegal Activity

- Violates any applicable law, regulation, or court order (including, without limitation, anti-spam laws such as the U.S. CAN-SPAM Act, the EU's ePrivacy Directive and GDPR, the UK PECR, Canada's CASL, and equivalent laws; the U.S. Telephone Consumer Protection Act ("**TCPA**") and equivalent "do-not-call" or "do-not-text" laws; export-control and sanctions laws; and anti-money-laundering laws).
- Facilitates, promotes, or constitutes fraud, phishing, advance-fee fraud, romance scams, or any other deceptive practice.
- Involves the sale, distribution, or promotion of illegal goods or services (controlled substances, illegal weapons, counterfeit goods, stolen property, etc.).
- Constitutes money laundering, terrorist financing, or sanctions evasion, or involves parties subject to U.S. OFAC, EU, UK, or UN sanctions.

### 3.2 Spam, Unsolicited Communications, and Consent

- Sends unsolicited commercial SMS or email (i.e., messages to recipients who have not given prior, express, informed, and freely-revocable consent to receive them).
- Bypasses or attempts to bypass opt-out mechanisms (e.g., "STOP," "UNSUBSCRIBE," or equivalent).
- Sends messages containing false or misleading headers, sender information, or subject lines.
- Sends messages to numbers or addresses on a public do-not-call registry without the recipient's specific prior consent.

**You are responsible for maintaining documented consent for every recipient you contact through the Service.** InboxPilot does not provide consent storage as a default feature `[TO BE REVIEWED BY COUNSEL: confirm whether a consent log is required by GDPR/CAN-SPAM/TCPA and whether InboxPilot should provide a `consent_records` table]`. You shall make such records available to InboxPilot on reasonable request in connection with a regulatory inquiry or complaint.

### 3.3 Harassment, Hate, and Harm

- Threatens, harasses, bullies, intimidates, or demeans any individual or group.
- Promotes violence against, or disparages, people on the basis of race, ethnicity, national origin, religion, sex, gender, gender identity, sexual orientation, disability, medical condition, age, or any other protected characteristic.
- Encourages self-harm, suicide, or eating disorders, or contains graphic or gratuitous violence.
- Is targeted at a minor in a way that exploits, abuses, or endangers them, or that violates the U.S. Children's Online Privacy Protection Act ("**COPPA**") or equivalent laws.
- Constitutes stalking, doxxing (the publication of private personal information without consent), or blackmail.

### 3.4 Impersonation, Deception, and Identity

- Impersonates any person or entity, including InboxPilot, an InboxPilot employee, or any other customer.
- Misrepresents the source or authorship of any content, including AI-generated content presented as human-authored where context requires disclosure.
- Falsely attributes statements, endorsements, or affiliations to any third party.
- Uses a phone number, email address, or domain that you do not have the right to use.

### 3.5 Intellectual Property and Confidential Information

- Infringes, misappropriates, or violates the intellectual property rights, publicity rights, or privacy rights of any third party.
- Discloses or transmits trade secrets, confidential information, or material non-public information of any third party without the right to do so.
- Uploads documents to the knowledge base that you do not have the right to use, reproduce, or process for AI retrieval.

### 3.6 Security and System Integrity

- Probes, scans, or tests the vulnerability of the Service or any InboxPilot system or network, except as expressly permitted by InboxPilot's responsible-disclosure policy `[TO BE REVIEWED BY COUNSEL: confirm whether to publish a security.txt and link to a `security@inboxpilot.com` intake]`.
- Breaches, circumvents, or attempts to circumvent authentication, authorization, rate-limiting, or other security measures.
- Introduces malware, viruses, worms, ransomware, time bombs, trapdoors, or any other harmful code.
- Uses the Service to attack, disrupt, or interfere with any third-party system (denial-of-service, port scanning, packet injection, etc.).
- Uses automated means to access the Service except as documented in our public API documentation and within published rate limits.

### 3.7 Reverse Engineering and Competitive Misuse

- Reverse-engineers, decompiles, disassembles, or otherwise attempts to derive source code, model weights, or underlying ideas of the Service, the AI models used by the Service, or any non-open-source component thereof, except to the extent expressly permitted by applicable law notwithstanding this restriction.
- Uses the Service, or any data derived from it, to build, train, or improve a competing product or service. `[TO BE REVIEWED BY COUNSEL: confirm scope — narrow to "substantially similar" competitive product, or general?]`
- Scrapes, crawls, or otherwise extracts data from the Service by means not made available through the documented public APIs.
- Frames, mirrors, or resells the Service except as expressly permitted under the MSA.

### 3.8 Privacy and Special Category Data

- Uploads, transmits, or causes to be transmitted to the Service any Special Category Data (as defined in our DPA), including health, biometric, genetic, racial, ethnic, political, religious, trade union, sex-life, or sexual-orientation data, except where you have a documented legal basis and have first obtained InboxPilot's prior written consent.
- Processes the personal data of individuals under the age of 16 (or such higher age as the applicable jurisdiction requires) without verifiable parental consent.
- Fails to provide a privacy notice to, or to obtain consent from, your end customers as required by applicable Data Protection Laws.

### 3.9 Regulated Industries and Use Cases

- Uses the Service in connection with activity that requires a license, registration, or regulatory authorization that you do not hold, including (without limitation) the practice of law, the practice of medicine, the practice of pharmacy, debt collection in jurisdictions requiring licensing, financial advice, brokerage, banking, or the transmission of controlled gambling content.
- Uses the Service to send communications that must be preserved under sector-specific retention rules (e.g., HIPAA, FINRA, MiFID II) without first entering a separate written agreement with InboxPilot supporting those obligations. **InboxPilot is not HIPAA-, FINRA-, or MiFID-compliant out of the box.** `[TO BE REVIEWED BY COUNSEL: confirm whether to offer regulated-industry addenda.]`

### 3.10 High-Risk Use

- Uses the Service in connection with life-support, emergency-services, public-safety, aviation, or critical-infrastructure systems, where a failure or inaccuracy of the Service could reasonably be expected to cause death, personal injury, or severe environmental or property damage.

---

## 4. Prohibited AI-Generated Content

In addition to the above, the following are specifically prohibited with respect to AI-generated or AI-sent content:

- Disallowed content under the upstream model's acceptable-use policy (e.g., OpenRouter and the underlying model providers' policies, as updated from time to time). The Customer is responsible for compliance with those policies and shall not use the Service in a way that causes InboxPilot to be in violation of them.
- Generation of malware, exploits, or instructions to facilitate wrongdoing.
- Generation of personally identifying information about a real, identifiable person, except where the Customer has a documented legal basis and the person is a Data Subject under the Customer's own privacy notice.
- Generation of child sexual abuse material (CSAM). InboxPilot has a zero-tolerance policy for CSAM; reports of such content are forwarded to the National Center for Missing & Exploited Children (NCMEC) or equivalent authorities as required by law.

---

## 5. Rate Limits and Acceptable Use of Infrastructure

The Service is subject to documented per-tenant rate limits (e.g., messages per minute, knowledge-base documents, contacts, API calls). You shall not circumvent, or attempt to circumvent, these limits, including by sharding across multiple accounts. Persistent use materially in excess of documented limits constitutes a breach of this AUP and may result in throttling, suspension, or additional charges at our then-current overage rates.

---

## 6. Reporting Misuse

If you become aware of any violation of this AUP — by your own account, by another InboxPilot customer, or by an end-customer message routed through the Service — please report it to:

- **Email:** `[ABUSE_EMAIL]` (e.g., `abuse@inboxpilot.com`)
- **Web form:** `[ABUSE_FORM_URL]`

Reports should include, to the extent known: the relevant account, message IDs, sender / recipient numbers or addresses, the content at issue, and a description of the concern. We may anonymize the reporter's identity where appropriate.

---

## 7. Enforcement and Consequences

InboxPilot may, in its reasonable discretion, take any of the following actions in response to an actual or suspected violation of this AUP or applicable law, with or without prior notice:

| Step | Action | Typical Trigger |
|---|---|---|
| **1. Notice** | Email or in-product warning describing the issue and the required remediation. | First-time, low-severity issue. |
| **2. Throttling** | Temporary reduction of rate limits or other resource quotas. | Pattern of minor violations or in-progress minor issue. |
| **3. Feature suspension** | Suspension of specific features (e.g., auto-reply, knowledge base) while the issue is addressed. | Targeted abuse or unresolved notice. |
| **4. Service suspension** | Suspension of the entire Service for the affected tenant. | Repeated, unresolved, or material violation. |
| **5. Termination** | Termination of the MSA for cause, in accordance with its terms. | Severe, willful, or unremediated violation; legal requirement. |

### 7.1 Lawful Access Requests

InboxPilot may also suspend or restrict the Service as necessary to comply with a binding legal order, subpoena, or request from a competent governmental authority. Where lawful, InboxPilot will notify the affected Customer and give the Customer an opportunity to contest the request.

### 7.2 Emergency Action

InboxPilot may take immediate, unilateral action — including immediate suspension or termination — when, in our good-faith judgment, continued use of the Service is likely to cause imminent harm to InboxPilot, other customers, or any third party, or where required by law. Where practicable, we will provide advance or contemporaneous notice of the action and its reason.

### 7.3 No Monitoring Obligation

InboxPilot has no obligation to monitor, pre-screen, or review content transmitted through the Service. The decision to take any of the above actions does not imply any obligation to do so in other cases, and InboxPilot shall not be liable for any failure or delay in taking action.

---

## 8. Appeals

If you believe that an enforcement action was taken in error, you may appeal by writing to `[APPEALS_EMAIL]` within **30 days** of the action, with a written description of the basis for the appeal. We will review and respond within a reasonable time, typically within 15 business days.

---

## 9. Third-Party Rights

The Service may be used to send messages to or receive messages from third parties (your end customers). You represent and warrant that you have the right to do so, and that you have provided all required notices and obtained all required consents, in accordance with applicable law and this AUP.

You shall indemnify and hold InboxPilot harmless against any third-party claim arising from (a) your breach of this AUP, (b) your violation of any applicable law, or (c) any message or content you sent, received, or processed through the Service, in accordance with the indemnification provisions of the MSA.

---

## 10. No Warranty; Limitation of Liability

**THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE,"** without warranty of any kind, express or implied, including without limitation any warranty of merchantability, fitness for a particular purpose, non-infringement, or accuracy of AI-generated content. To the maximum extent permitted by applicable law, InboxPilot disclaims all liability for any damages arising out of or related to (a) AI-generated content, (b) the actions or omissions of other customers or third parties, (c) unauthorized access to or use of the Service, or (d) any violation of this AUP by you or your end users. Limitations of liability are as set forth in the MSA.

---

## 11. Changes to this AUP

InboxPilot may update this AUP from time to time to reflect changes in the Service, the law, or our practices. Material changes will be communicated to the Customer with at least 30 days' prior notice (e.g., by email to the admin contact and via an in-product banner). Continued use of the Service after the effective date of the updated AUP constitutes acceptance. If the Customer does not agree to the change, the Customer may terminate the affected services without further liability.

---

## 12. Recommended Customer-Facing AI Disclaimer

`[TO BE REVIEWED BY COUNSEL: confirm final wording, jurisdictional variations, and whether the disclaimer should be auto-inserted by the platform in auto-reply mode.]`

Where the Service is configured in auto-reply mode, the Customer shall consider including a brief disclaimer, such as:

> *This message was generated by an AI assistant and reviewed / sent without human verification. If your question involves legal, medical, financial, or safety-critical matters, please reply "agent" to reach a human or contact us directly at [phone / email].*

Customers in regulated or high-stakes industries should tailor the disclaimer accordingly and, where required by law, disclose AI involvement explicitly.

---

## 13. Governing Law

This AUP is governed by the laws of `[JURISDICTION]`, without regard to conflict-of-laws principles, in accordance with the MSA. Disputes are resolved in the courts of `[VENUE]`.

---

*End of AUP template.*
