# Product

## Register

product

## Platform

web

## Users

Sysadmins and IT ops staff who maintain VM, storage, and physical hardware records as part of their infrastructure work. They come to InventoryMGR mid-task — provisioning, decommissioning, auditing — needing to read or update a record quickly and get back to the actual job. The hypervisor itself is never contacted; every value here is user-entered or CSV-imported, so the tool's only job is making that manual record-keeping fast and trustworthy.

## Product Purpose

A documentation inventory for VMs, storage arrays, and physical clusters — the single source of truth for infrastructure records that would otherwise live in stale spreadsheets or tribal knowledge. Success looks like: nobody hesitates to update a record because the tool is faster than not bothering.

## Positioning

Structured, auditable infrastructure documentation — replacing ad-hoc spreadsheets and wikis with one place that's always current.

## Brand Personality

Precise, calm, trustworthy. This is a tool people reach for constantly during real ops work, not a product being sold to them — it should feel understated and get out of the way, while inspiring confidence that the data on screen is correct. No persuasion, no flourish; the design earns trust through clarity and consistency, not decoration.

## Anti-references

Not a bloated enterprise SaaS tool (ServiceNow / Jira-style dense chrome, modal-on-modal flows, buried actions). Avoid anything that makes a two-second edit feel like a form wizard.

## Design Principles

- Clarity over persuasion — every screen answers "what is true right now," not "why should you care."
- Fast edits stay fast — inline and single-step where possible; no unnecessary confirmation modals or multi-page wizards for routine changes.
- Consistency builds trust — the same patterns (tables, forms, status colors) recur across VMs, storage, and clusters so nothing has to be relearned.
- Density with breathing room — support power users scanning many records, without tipping into cramped enterprise-chrome territory.
- Quiet by default — status and criticality color carries meaning; everything else stays restrained so those signals stand out.

## Accessibility & Inclusion

WCAG AA baseline: sufficient contrast, full keyboard navigation, no interaction that depends on color alone (status/criticality already pair color with text labels).
