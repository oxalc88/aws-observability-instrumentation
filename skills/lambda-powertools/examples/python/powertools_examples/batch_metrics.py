"""Local stage/fallback coverage; queue/ack, retry, resource and trace not_applicable.

Counts attempts, not exactly-once business events. Success does not imply queue ack.
BatchDuration is a batch sample, not per-record latency. Fixed fallback primary_missing.
See references/example-contracts.md for the shared identities and emission budget.
"""
from time import perf_counter

from aws_lambda_powertools import Logger
from aws_lambda_powertools.metrics import EphemeralMetrics, MetricUnit

from .metric_publication import publish_measurements

metrics = EphemeralMetrics(namespace="Example/Ingestion", service="ingestion")
logger = Logger(service="ingestion", level="INFO")


def make_batch_handler(process_record):
    def run(event, context):
        started = perf_counter()
        attempted = processed = failed = fallbacks = 0
        results = []
        try:
            for record in event["records"]:
                attempted += 1
                try:
                    result = process_record(record)
                except Exception:
                    failed += 1
                    raise
                results.append(result)
                processed += 1
                fallbacks += int(result["usedFallback"])
            return results
        except Exception:
            try:
                logger.error("Batch processing failed", extra={
                    "event.name": "ingestion.batch.failed", "operation.name": "ingestion.batch",
                    "stage": "process", "failure.class": "unknown",
                    "reason": "unmapped_record_failure", "location": "process_record",
                    "request_id": context.aws_request_id,
                    "attempted_records": attempted, "completed_records": processed,
                })
            except Exception:
                pass
            raise
        finally:
            points = [] if not event["records"] else [
                ("ReceivedRecords", MetricUnit.Count, len(event["records"])),
                ("AttemptedRecords", MetricUnit.Count, attempted),
                ("ProcessedRecords", MetricUnit.Count, processed),
                ("FailedRecords", MetricUnit.Count, failed),
                ("FallbackRecords", MetricUnit.Count, fallbacks),
                ("BatchFailures", MetricUnit.Count, int(failed > 0)),
                ("BatchDuration", MetricUnit.Milliseconds, (perf_counter() - started) * 1000),
            ]
            publish_measurements(metrics, points, {"failure_class": "unknown" if failed else "none"})
    return run


def process_record(record):
    used_fallback = record.get("primaryScore") is None
    return {"score": 0 if used_fallback else record["primaryScore"], "usedFallback": used_fallback}


# Expected harmless local fallback needs no per-record diagnostic event.
handler = make_batch_handler(process_record)
