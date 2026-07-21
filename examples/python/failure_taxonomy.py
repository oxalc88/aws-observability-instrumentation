"""Closed failure classes for low-cardinality metric attributes."""

from __future__ import annotations

import asyncio
from enum import StrEnum


class FailureClass(StrEnum):
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    DEPENDENCY_FAILURE = "dependency_failure"
    VALIDATION_FAILURE = "validation_failure"
    AUTH_FAILURE = "auth_failure"
    RATE_LIMITED = "rate_limited"
    QUOTA_EXHAUSTED = "quota_exhausted"
    INTERNAL_ERROR = "internal_error"
    UNKNOWN = "unknown"


_REGISTERED: dict[type[BaseException], FailureClass] = {}


def register(exc_cls: type[BaseException], failure: FailureClass) -> None:
    _REGISTERED[exc_cls] = failure


def classify(exc: BaseException) -> FailureClass:
    for cls in type(exc).__mro__:
        if cls in _REGISTERED:
            return _REGISTERED[cls]
    if isinstance(exc, asyncio.CancelledError):
        return FailureClass.CANCELLED
    if isinstance(exc, TimeoutError):
        return FailureClass.TIMEOUT
    if isinstance(exc, TypeError):
        return FailureClass.INTERNAL_ERROR
    if isinstance(exc, ValueError):
        return FailureClass.VALIDATION_FAILURE
    if isinstance(exc, PermissionError):
        return FailureClass.AUTH_FAILURE
    return FailureClass.UNKNOWN


__all__ = ["FailureClass", "classify", "register"]
