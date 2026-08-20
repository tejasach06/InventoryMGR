from typing import Any


def compute_health_score(vm: Any) -> int:
    if any(tag.strip().lower() == "template" for tag in (vm.tags or [])):
        return 0
    score = 0
    if vm.description:
        score += 10
    if vm.business_owner or vm.technical_owner or vm.owner:
        score += 15
    if vm.applications:
        score += 20
    if vm.networks:
        score += 15
    if vm.disks:
        score += 15
    if vm.monitoring_enabled:
        score += 10
    if vm.decommission_date:
        score += 15
    return score
