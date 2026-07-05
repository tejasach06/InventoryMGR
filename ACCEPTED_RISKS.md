# Accepted Security Risks

This register documents design tradeoffs that have been deliberately accepted.
Each entry includes a review date and an automated check to detect when the risk
condition changes.

| ID | Risk | Severity | Review by | Rationale | Check |
|----|------|----------|-----------|-----------|-------|
| RISK-001 | Docker containers bind to `0.0.0.0` | Low | 2027-01-05 | Required for container networking inside Docker; host exposure is controlled by the `ports:` mapping in docker-compose.yml. Production deployments should use a reverse proxy. | `grep -c "0.0.0.0" backend/Dockerfile frontend/package.json | grep -q "2"` |
