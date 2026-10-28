# InventoryMGR Module Architecture & Parallel Development Strategy

* **Author:** EGM Brainstorm Swarm
* **Date:** 2026-10-28

## Overview

InventoryMGR is a compact inventory management system tracking virtual machines, storage volumes, and physical clusters/nodes backed by a single PostgreSQL database. This document establishes the technical layout to enable multiple engineers to work on separate modules concurrently without breaking build pipelines, database integrity, or operational observability.

## Analysis

An evaluation across six specialized architectural lenses (Design Critic, Codebase Details, Zoom Out, Comprehension, Implementation Readiness, and Structural) revealed several critical constraints:

1. **The Codebase Scale Reality (YAGNI & Minimization)**:
   The entire current inventory engine in `backend-rust/src/api/inventory/` is only 453 lines of Rust across 6 files, built around a declarative `Resource` abstraction. Forcing strict micro-domain boundaries or multi-crate workspaces introduces heavy ceremony, module indirection, and maintenance overhead without providing real autonomy.

2. **The "Leaky Slices" Paradox**:
   Permitting the VM module to execute arbitrary SQL joins across storage and hardware tables completely dissolves domain isolation at the database level. Because SQLx statically validates queries against PostgreSQL schemas, any schema change made by the storage engineer immediately breaks compile-time checks in the VM module. File-level separation in Git does not provide true independent development.

3. **Data Model Coupling**:
   In `0001_inventory_schema.sql`, relationships between VMs, physical clusters, and storage are loosely coupled through string names (`vms.cluster` maps to `physical_clusters.name`, `vm_disks.storage_name` maps to storage pools), rather than strict database foreign keys. Bulk workflows like CSV imports (`src/api/auxiliary/imports.rs`, 291 lines) and inventory reports (`src/api/auxiliary/reporting.rs`, 134 lines) are inherently cross-domain.

4. **Operational Debuggability**:
   Dynamic queries across multiple tables currently lack SQL comment marginalia, and the database error converter (`db_error`) swallows SQL details without structured `tracing::error!` logging. In a multi-engineer environment, cross-domain join failures would misdirect production triage to the VM module when the underlying failure is an unannounced storage migration or lock.

5. **Top-Level Layout Invariants**:
   Production Rust code resides in `backend-rust/`. `backend/` is a test-only Python parity oracle. The single database migration ledger (`alembic_version` head `0024`), connection pool configuration, and verification gate (`just verify`) must remain unified.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Partition route handlers, controllers, and domain logic into clear ownership directories: VM Tracking, Storage Tracking, Infrastructure/Hardware Tracking.
  * Establish an explicit **Read-Only Composite Projection layer** for queries combining VM, cluster, and storage data, preventing arbitrary cross-domain queries.
  * Create a dedicated **Ingestion & Reporting** module for cross-cutting CSV import/export and dashboard aggregations.
  * Mirror feature ownership in `frontend/src/features/` so frontend engineers have matching isolated working surfaces.
  * Add structured error logging and SQL query marginalia (`/* domain=vm ... */`) to attribute database query load and failures to specific modules.

* **Out-of-Scope Non-Goals:**
  * Multi-crate Cargo workspaces or multi-package npm monorepo tooling (retains single Rust crate and single Next.js project).
  * Multiple database instances or microservices.
  * Micro-migrations (retains single unified SQL revision chain in `backend-rust/migrations/`).
  * Moving or renaming `backend-rust/` or `backend/`.

## Alternatives Weighed

1. **Strict Micro-Domains (Service-Mediated Interfaces)**:
   * *Rejected*: Disallowing direct joins and requiring VM to fetch data from Storage and Hardware via internal Rust service calls or DTOs causes severe N+1 database queries, complex in-memory pagination/sorting, and excessive boilerplate for a 453-line subsystem.
2. **Multi-Crate Workspace (`crates/vm`, `crates/storage`, `crates/hardware`)**:
   * *Rejected*: Introduces circular dependency cycles (VMs need Storage, Storage needs Clusters, Alerts need VMs), inflates compile times, and multiplies Cargo configuration files without reducing schema coupling.
3. **Unrestricted Direct Joins inside the VM Module**:
   * *Rejected*: Turns the VM module into an uncontrolled "god module" where cross-inventory reporting, cluster capacity, and storage queries accumulate without clear ownership, while silently breaking when storage or cluster schemas evolve.

## Key Decisions & Staging for Next Steps

### 1. Structural Partitioning Layout

#### Backend (`backend-rust/src/`):
```text
backend-rust/src/
├── core/                       # Shared: config, auth, error types, permissions
├── db/                         # Shared: connection pool (max 20), migrations ledger
├── models/                     # Shared canonical entities: vm, storage, cluster
├── schemas/                    # Shared request/response DTOs
└── domains/ (or api/)
    ├── vms/                    # Engineer 1: VM lifecycle, states, CRUD, VM routes
    │   ├── handlers.rs
    │   └── projections.rs      # Explicit, documented read-only composite SQL queries
    ├── storage/                # Engineer 2: Arrays, pools, volumes, LUNs, disk attachments
    │   ├── handlers.rs
    │   └── service.rs
    ├── infrastructure/         # Engineer 3: Physical clusters, physical nodes, racks
    │   ├── handlers.rs
    │   └── service.rs
    └── integration/            # Shared / Release: CSV imports, exports, dashboard reporting
        ├── imports.rs
        └── reporting.rs
```

#### Frontend (`frontend/src/`):
```text
frontend/src/
├── components/                 # Shared UI primitives (ui.tsx, layout, navigation)
├── lib/                        # Shared utility functions and base API client
└── features/
    ├── vms/                    # Engineer 1: VM table, details, forms, VM hooks
    ├── storage/                # Engineer 2: Storage pools, arrays, disk allocation
    └── infrastructure/         # Engineer 3: Clusters, physical nodes, hardware maps
```

### 2. The Cross-Domain Data Contract
* **Read Operations**: Cross-domain queries are restricted to explicit projection functions in `vms/projections.rs`. These functions must include inline SQL marginalia (`/* caller=vm_projections */`) and define fixed result DTOs.
* **Write Operations**: No cross-domain writes. A VM endpoint cannot mutate storage pools or create clusters. Mutations to disks, arrays, or clusters must target their respective domain routes.
* **Shared Cross-Cutting Workflows**: Bulk operations like CSV import belong to `integration/`, not the VM module.


## User Decision on Integration Workflows

- **Decision**: Integration workflows (CSV import, export, and reporting) are assigned to the dedicated `integration/` module, ensuring clear ownership separated from core domain entity modules.
