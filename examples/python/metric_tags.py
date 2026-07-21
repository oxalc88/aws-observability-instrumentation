"""Approved bucket functions for bounded metric attribute values."""

from __future__ import annotations


def status_code_class(code: int) -> str:
    if 100 <= code < 200:
        return "1xx"
    if 200 <= code < 300:
        return "2xx"
    if 300 <= code < 400:
        return "3xx"
    if 400 <= code < 500:
        return "4xx"
    if 500 <= code < 600:
        return "5xx"
    return "other"


def size_bucket(num_bytes: int) -> str:
    if num_bytes < 1_024:
        return "0_1kb"
    if num_bytes < 10 * 1_024:
        return "1_10kb"
    if num_bytes < 100 * 1_024:
        return "10_100kb"
    if num_bytes < 1_024 * 1_024:
        return "100kb_1mb"
    return "1mb_plus"


def count_bucket(n: int) -> str:
    if n <= 0:
        return "0"
    if n < 10:
        return "1-9"
    if n < 50:
        return "10-49"
    return "50+"


def attempt_bucket(n: int) -> str:
    if n <= 1:
        return "1"
    if n == 2:
        return "2"
    if n <= 5:
        return "3-5"
    return "6+"


def bool_attribute(value: bool) -> str:
    return "true" if value else "false"


__all__ = [
    "attempt_bucket",
    "bool_attribute",
    "count_bucket",
    "size_bucket",
    "status_code_class",
]
