"""Governed OpenTelemetry metric definitions.

Copy this module into the consumer project's shared observability package.
Create OTel instruments from these definitions only in the emission module.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Literal

MetricKind = Literal["counter", "gauge", "histogram"]
MetricPurpose = Literal["outcome", "latency", "load", "resource", "correctness"]
EmitFrequency = Literal["per_request", "per_step", "per_event", "periodic"]
LoopPolicy = Literal["forbidden", "aggregate_only", "allowed"]
Cardinality = Literal["low", "medium"]
AttributeConstraint = frozenset[str] | str

_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_.\-/]{0,254}$")


@dataclass(frozen=True, eq=False)
class MetricDef:
    """Immutable contract for one custom OTel metric instrument."""

    name: str
    kind: MetricKind
    unit: str
    purpose: MetricPurpose
    description: str
    allowed_attributes: frozenset[str]
    required_attributes: frozenset[str]
    attribute_constraints: Mapping[str, AttributeConstraint]
    cardinality: Cardinality
    emit_frequency: EmitFrequency
    histogram_boundaries: tuple[float, ...] = ()
    loop_policy: LoopPolicy = "aggregate_only"
    owner: str = ""
    version: int = 1
    deprecated: bool = False
    replaced_by: str | None = None
    retired_at: date | None = None

    def __post_init__(self) -> None:
        if not _NAME.fullmatch(self.name):
            raise ValueError(f"invalid OTel metric name: {self.name!r}")
        if not self.description.strip():
            raise ValueError(f"metric {self.name!r} requires a description")
        if not self.unit.strip():
            raise ValueError(f"metric {self.name!r} requires a UCUM unit")
        if not self.required_attributes <= self.allowed_attributes:
            raise ValueError("required_attributes must be a subset of allowed_attributes")
        if frozenset(self.attribute_constraints) != self.allowed_attributes:
            raise ValueError("attribute_constraints must define every allowed attribute")
        if self.kind == "histogram":
            if not self.histogram_boundaries:
                raise ValueError("histograms require explicit boundaries")
            if tuple(sorted(set(self.histogram_boundaries))) != self.histogram_boundaries:
                raise ValueError("histogram boundaries must be unique and ascending")
        elif self.histogram_boundaries:
            raise ValueError("only histograms may define histogram_boundaries")
        if self.deprecated and self.replaced_by is None and self.retired_at is None:
            raise ValueError("deprecated metrics require replaced_by or retired_at")

    def __hash__(self) -> int:
        return hash(self.name)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, MetricDef):
            return NotImplemented
        return self.name == other.name

    @classmethod
    def counter(
        cls,
        name: str,
        *,
        purpose: MetricPurpose,
        owner: str,
        means: str,
        unit: str = "{event}",
        attributes: Mapping[str, AttributeConstraint] | None = None,
        required: frozenset[str] = frozenset(),
        emit_frequency: EmitFrequency = "per_event",
        loop_policy: LoopPolicy = "aggregate_only",
        cardinality: Cardinality = "low",
        version: int = 1,
        deprecated: bool = False,
        replaced_by: str | None = None,
        retired_at: date | None = None,
    ) -> MetricDef:
        """Create a monotonic counter for additive non-negative values."""

        constraints = dict(attributes or {})
        return cls(
            name=name,
            kind="counter",
            unit=unit,
            purpose=purpose,
            description=means,
            allowed_attributes=frozenset(constraints),
            required_attributes=required,
            attribute_constraints=constraints,
            cardinality=cardinality,
            emit_frequency=emit_frequency,
            loop_policy=loop_policy,
            owner=owner,
            version=version,
            deprecated=deprecated,
            replaced_by=replaced_by,
            retired_at=retired_at,
        )

    @classmethod
    def latency(
        cls,
        name: str,
        *,
        owner: str,
        means: str,
        attributes: Mapping[str, AttributeConstraint] | None = None,
        required: frozenset[str] = frozenset(),
        boundaries_seconds: tuple[float, ...] = (
            0.005,
            0.01,
            0.025,
            0.05,
            0.1,
            0.25,
            0.5,
            1.0,
            2.5,
            5.0,
            10.0,
        ),
        emit_frequency: EmitFrequency = "per_event",
        loop_policy: LoopPolicy = "aggregate_only",
        cardinality: Cardinality = "low",
        version: int = 1,
        deprecated: bool = False,
        replaced_by: str | None = None,
        retired_at: date | None = None,
    ) -> MetricDef:
        """Create a duration histogram measured in seconds."""

        constraints = dict(attributes or {})
        return cls(
            name=name,
            kind="histogram",
            unit="s",
            purpose="latency",
            description=means,
            allowed_attributes=frozenset(constraints),
            required_attributes=required,
            attribute_constraints=constraints,
            cardinality=cardinality,
            emit_frequency=emit_frequency,
            histogram_boundaries=boundaries_seconds,
            loop_policy=loop_policy,
            owner=owner,
            version=version,
            deprecated=deprecated,
            replaced_by=replaced_by,
            retired_at=retired_at,
        )

    @classmethod
    def gauge(
        cls,
        name: str,
        *,
        unit: str,
        owner: str,
        means: str,
        attributes: Mapping[str, AttributeConstraint] | None = None,
        required: frozenset[str] = frozenset(),
        emit_frequency: EmitFrequency = "periodic",
        cardinality: Cardinality = "low",
        version: int = 1,
        deprecated: bool = False,
        replaced_by: str | None = None,
        retired_at: date | None = None,
    ) -> MetricDef:
        """Create a synchronous gauge for current state."""

        constraints = dict(attributes or {})
        return cls(
            name=name,
            kind="gauge",
            unit=unit,
            purpose="load",
            description=means,
            allowed_attributes=frozenset(constraints),
            required_attributes=required,
            attribute_constraints=constraints,
            cardinality=cardinality,
            emit_frequency=emit_frequency,
            loop_policy="aggregate_only",
            owner=owner,
            version=version,
            deprecated=deprecated,
            replaced_by=replaced_by,
            retired_at=retired_at,
        )

    @classmethod
    def resource(
        cls,
        name: str,
        *,
        unit: str,
        owner: str,
        means: str,
        attributes: Mapping[str, AttributeConstraint] | None = None,
        required: frozenset[str] = frozenset(),
        emit_frequency: EmitFrequency = "per_event",
        loop_policy: LoopPolicy = "aggregate_only",
        cardinality: Cardinality = "low",
        version: int = 1,
        deprecated: bool = False,
        replaced_by: str | None = None,
        retired_at: date | None = None,
    ) -> MetricDef:
        """Create a counter for bytes, tokens, quota units, or similar use."""

        return cls.counter(
            name,
            purpose="resource",
            owner=owner,
            means=means,
            unit=unit,
            attributes=attributes,
            required=required,
            emit_frequency=emit_frequency,
            loop_policy=loop_policy,
            cardinality=cardinality,
            version=version,
            deprecated=deprecated,
            replaced_by=replaced_by,
            retired_at=retired_at,
        )

    @classmethod
    def failure_counter(
        cls,
        name: str,
        *,
        owner: str,
        means: str,
        attributes: Mapping[str, AttributeConstraint] | None = None,
        required: frozenset[str] = frozenset(),
        emit_frequency: EmitFrequency = "per_event",
        loop_policy: LoopPolicy = "aggregate_only",
        cardinality: Cardinality = "low",
        version: int = 1,
        deprecated: bool = False,
        replaced_by: str | None = None,
        retired_at: date | None = None,
    ) -> MetricDef:
        """Create a counter that always requires bounded `failure.class`."""

        from .failure_taxonomy import FailureClass

        constraints = dict(attributes or {})
        constraints.setdefault(
            "failure.class", frozenset(item.value for item in FailureClass)
        )
        return cls.counter(
            name,
            purpose="outcome",
            owner=owner,
            means=means,
            attributes=constraints,
            required=frozenset((*required, "failure.class")),
            emit_frequency=emit_frequency,
            loop_policy=loop_policy,
            cardinality=cardinality,
            version=version,
            deprecated=deprecated,
            replaced_by=replaced_by,
            retired_at=retired_at,
        )


REGISTRY: list[MetricDef] = []

__all__ = [
    "AttributeConstraint",
    "Cardinality",
    "EmitFrequency",
    "LoopPolicy",
    "MetricDef",
    "MetricKind",
    "MetricPurpose",
    "REGISTRY",
]
