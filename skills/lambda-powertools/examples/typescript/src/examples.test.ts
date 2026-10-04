import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { handler as validate, logger as validationLogger, metrics as validationMetrics } from "./validation-handler.js";
import { handler as batch, makeBatchHandler, metrics, logger as batchLogger } from "./batch-metrics.js";
import { client, lambdaHandler, logger as dependencyLogger, lookupOrder, tracer, metrics as dependencyMetrics, handler as tracedHandler } from "./dependency-handler.js";

const context = { awsRequestId: "invocation-1" } as Context;
const event = (body: string) => ({ body } as APIGatewayProxyEventV2);

afterEach(() => mock.restoreAll());

test("validation logs a useful safe contract without values or unknown field names", async () => {
  let diagnostic: Record<string, unknown> = {};
  mock.method(validationLogger, "warn", (_message: unknown, fields: Record<string, unknown>) => { diagnostic = fields; });
  const response = await validate(event('{"secret-key-containing-personal-data":"TOP_SECRET"}'), context);
  assert.equal(response.statusCode, 400);
  assert.equal(diagnostic["validation.code"], "NO_SUPPORTED_ENRICHMENT_FIELDS");
  assert.equal(diagnostic["validation.rule"], "supported_enrichment");
  assert.equal(diagnostic["validation.path"], "body");
  assert.equal(diagnostic["validation.received_type"], "object");
  assert.deepEqual(diagnostic["validation.received_fields"], []);
  assert.equal(diagnostic["validation.unknown_field_count"], 1);
  assert.equal(diagnostic.request_id, "invocation-1");
  assert.doesNotMatch(JSON.stringify(diagnostic), /TOP_SECRET|secret-key-containing-personal-data/);
});

test("malformed JSON has one shape rejection and contains no parser exception", async () => {
  const warn = mock.method(validationLogger, "warn", () => undefined);
  await validate(event('PASSWORD=SECRET'), context);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal((warn.mock.calls[0]?.arguments[1] as Record<string, unknown>)["validation.code"], "BODY_NOT_OBJECT");
  assert.doesNotMatch(JSON.stringify(warn.mock.calls), /PASSWORD|SECRET|SyntaxError/);
});

test("ordinary accepted input does not require a success log", async () => {
  const warn = mock.method(validationLogger, "warn", () => undefined);
  assert.equal((await validate(event('{"notes":"private"}'), context)).statusCode, 204);
  assert.equal(warn.mock.callCount(), 0);
});

test("Logger failure preserves intended rejection outcome", async () => {
  mock.method(validationLogger, "warn", () => { throw new Error("sink unavailable"); });
  assert.equal((await validate(event('[]'), context)).statusCode, 400);
});

test("two warm invocations publish one aggregate EMF record each without leakage", async () => {
  const records: Record<string, any>[] = [];
  const serialize = metrics.serializeMetrics.bind(metrics);
  mock.method(metrics, "serializeMetrics", () => {
    const emf = serialize();
    records.push(emf as Record<string, any>);
    return emf;
  });
  metrics.addDimension("stale", "previous-invocation");
  metrics.addMetadata("stale_metadata", "PRIVATE");
  await batch({ records: [{ primaryScore: 1 }, {}, {}] }, context);
  await batch({ records: [{ primaryScore: 2 }] }, context);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.ReceivedRecords, 3);
  assert.equal(records[0]?.AttemptedRecords, 3);
  assert.equal(records[0]?.FailedRecords, 0);
  assert.equal(records[0]?.BatchFailures, 0);
  assert.ok(Number(records[0]?.BatchDuration) >= 0);
  assert.equal(records[0]?.ProcessedRecords, 3);
  assert.equal(records[0]?.FallbackRecords, 2);
  assert.equal(records[1]?.ProcessedRecords, 1);
  assert.equal(records[1]?.FallbackRecords, 0);
  assert.deepEqual(records[0]?._aws.CloudWatchMetrics[0].Dimensions, [["service", "failure_class"]]);
  assert.doesNotMatch(JSON.stringify(records), /stale|PRIVATE|request_id/);
  assert.equal(metrics.hasStoredMetrics(), false);
});

test("empty batch produces no EMF or empty-publication warning", async () => {
  const publication = mock.method(metrics, "publishStoredMetrics", () => metrics);
  await batch({ records: [] }, context);
  assert.equal(publication.mock.callCount(), 0);
});

test("failed publication clears state and preserves the successful business result", async () => {
  mock.method(metrics, "publishStoredMetrics", () => { throw new Error("SDK failure"); });
  assert.deepEqual(await batch({ records: [{}] }, context), [{ score: 0, usedFallback: true }]);
  assert.equal(metrics.hasStoredMetrics(), false);
});

test("telemetry and cleanup failure cannot replace the original application error", async () => {
  const original = new Error("domain failure");
  mock.method(metrics, "publishStoredMetrics", () => { throw new Error("SDK failure"); });
  const clear = metrics.clearMetrics.bind(metrics);
  mock.method(metrics, "clearMetrics", () => { clear(); throw new Error("cleanup failure"); });
  const run = makeBatchHandler(async () => { throw original; });
  await assert.rejects(run({ records: [{}] }, context), (error) => error === original);
});

test("completed attempts before business failure are published once", async () => {
  const records: Record<string, any>[] = [];
  const serialize = metrics.serializeMetrics.bind(metrics);
  mock.method(metrics, "serializeMetrics", () => {
    const emf = serialize();
    records.push(emf as Record<string, any>);
    return emf;
  });
  let calls = 0;
  const original = new Error("domain failure");
  const run = makeBatchHandler(async () => {
    if (++calls === 2) throw original;
    return { score: 0, usedFallback: true };
  });
  await assert.rejects(run({ records: [{}, {}] }, context), (error) => error === original);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ProcessedRecords, 1);
  assert.equal(records[0]?.AttemptedRecords, 2);
  assert.equal(records[0]?.FailedRecords, 1);
  assert.equal(records[0]?.BatchFailures, 1);
  assert.equal(records[0]?.failure_class, "unknown");
});

test("dependency failure emits one safe record and closes the meaningful boundary", async () => {
  let closed = 0;
  let fault = 0;
  const names: string[] = [];
  const segment = { close: () => { closed++; }, addFaultFlag: () => { fault++; } };
  mock.method(tracer, "getSegment", () => ({ addNewSubsegment: (name: string) => { names.push(name); return segment; } }) as never);
  mock.method(client, "send", async () => { throw Object.assign(new Error("SECRET SDK TEXT"), { $metadata: { httpStatusCode: 503 } }); });
  const log = mock.method(dependencyLogger, "error", () => undefined);
  await assert.rejects(lambdaHandler({ orderId: "PRIVATE_ORDER" }, context), /ORDER_LOOKUP_FAILED/);
  assert.deepEqual(names, ["DynamoDB.GetItem"]);
  assert.equal(closed, 1);
  assert.equal(fault, 1);
  assert.equal(log.mock.callCount(), 1);
  const fields = log.mock.calls[0]?.arguments[1] as Record<string, unknown>;
  assert.equal(fields["dependency.operation"], "GetItem");
  assert.equal(fields["http.status_class"], "5xx");
  assert.equal(fields.request_id, "invocation-1");
  assert.doesNotMatch(JSON.stringify(fields), /SECRET|PRIVATE_ORDER|stack/);
});

test("trace setup failure preserves the dependency result", async () => {
  mock.method(tracer, "getSegment", () => { throw new Error("trace unavailable"); });
  mock.method(client, "send", async () => ({ Item: {} }));
  assert.deepEqual(await lookupOrder("private"), { Item: {} });
});

test("Powertools full-error capture is disabled, independently of SDK capture", () => {
  assert.equal(process.env.POWERTOOLS_TRACER_CAPTURE_ERROR, "false");
  assert.equal(process.env.POWERTOOLS_TRACER_CAPTURE_RESPONSE, "false");
  let errorCaptured = false;
  mock.method(tracer, "getSegment", () => ({ addError: () => { errorCaptured = true; } }) as never);
  tracer.addErrorAsMetadata(new Error("PRIVATE"));
  assert.equal(errorCaptured, false);
});

test("trace close failure preserves a successful dependency response", async () => {
  mock.method(tracer, "getSegment", () => ({ addNewSubsegment: () => ({ close: () => { throw new Error("close failed"); } }) }) as never);
  mock.method(client, "send", async () => ({ Item: {} }));
  assert.deepEqual(await lookupOrder("private"), { Item: {} });
});

function captureEmf(target: typeof metrics) {
  const records: Record<string, any>[] = [];
  const serialize = target.serializeMetrics.bind(target);
  mock.method(target, "serializeMetrics", () => {
    const record = serialize();
    records.push(record as Record<string, any>);
    return record;
  });
  return records;
}

test("request coverage counts accepted and handled rejection without payload dimensions", async () => {
  const records = captureEmf(validationMetrics);
  mock.method(validationLogger, "warn", () => undefined);
  validationMetrics.addDimension("stale", "PRIVATE");
  validationMetrics.addMetadata("stale", "SECRET");
  await validate(event('{"notes":"PRIVATE"}'), context);
  await validate(event('{"secret":"SECRET"}'), { awsRequestId: "invocation-2" } as Context);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(r => [r.Requests, r.RequestFailures, r.result, r.failure_class]),
    [[1, 0, "accepted", "none"], [1, 1, "rejected", "validation_failure"]]);
  assert.ok(records.every(r => r.RequestDuration >= 0));
  assert.deepEqual(records[0]?._aws.CloudWatchMetrics[0].Dimensions,
    [["service", "result", "failure_class", "status_class"]]);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE|SECRET|request_id|invocation-2/);
  assert.equal(validationMetrics.hasStoredMetrics(), false);
});

test("request publication failure preserves accepted and rejected responses", async () => {
  mock.method(validationMetrics, "publishStoredMetrics", () => { throw new Error("EMF unavailable"); });
  mock.method(validationLogger, "warn", () => { throw new Error("logger unavailable"); });
  assert.equal((await validate(event('{"notes":"private"}'), context)).statusCode, 204);
  assert.equal((await validate(event('[]'), context)).statusCode, 400);
  assert.equal(validationMetrics.hasStoredMetrics(), false);
});

test("logical dependency calls have aggregate duration, failures and throttles alongside tracing", async () => {
  const records = captureEmf(dependencyMetrics);
  mock.method(tracer, "getSegment", () => undefined);
  let calls = 0;
  mock.method(client, "send", async () => {
    calls++;
    if (calls === 2) throw Object.assign(new Error("SECRET"), { name: "ThrottlingException" });
    if (calls === 3) throw Object.assign(new Error("SECRET"), { name: "TimeoutError" });
    if (calls === 4) throw new Error("SECRET unknown provider failure");
    return { Item: {} };
  });
  await lookupOrder("PRIVATE_ORDER");
  for (let i = 0; i < 3; i++) await assert.rejects(lookupOrder("PRIVATE_ORDER"));
  assert.equal(records.length, 4);
  assert.deepEqual(records.map(r => [r.DependencyCalls, r.DependencyFailures, r.DependencyThrottles, r.failure_class]),
    [[1, 0, 0, "none"], [1, 1, 1, "rate_limited"], [1, 1, 0, "timeout"], [1, 1, 0, "unknown"]]);
  assert.ok(records.every(r => r.DependencyDuration >= 0));
  assert.doesNotMatch(JSON.stringify(records), /SECRET|PRIVATE_ORDER/);
  assert.equal(dependencyMetrics.hasStoredMetrics(), false);
});

test("dependency metric loss preserves successful response and original SDK failure", async () => {
  mock.method(tracer, "getSegment", () => undefined);
  mock.method(dependencyMetrics, "publishStoredMetrics", () => { throw new Error("metric failure"); });
  const original = new Error("original SDK error");
  let calls = 0;
  mock.method(client, "send", async () => { if (++calls === 2) throw original; return { Item: {} }; });
  assert.deepEqual(await lookupOrder("private"), { Item: {} });
  await assert.rejects(lookupOrder("private"), error => error === original);
  assert.equal(dependencyMetrics.hasStoredMetrics(), false);
});

test("unmapped dependency errors with unsafe getters retain the original business error", async () => {
  const records = captureEmf(dependencyMetrics);
  mock.method(tracer, "getSegment", () => undefined);
  const original = Object.defineProperty(new Error("PRIVATE"), "name", {
    get() { throw new Error("unsafe getter"); },
  });
  mock.method(client, "send", async () => { throw original; });
  await assert.rejects(lookupOrder("private"), error => error === original);
  assert.equal(records[0]?.failure_class, "unknown");
});

test("batch failure requires one safe diagnostic event while preserving the original error", async () => {
  const original = new Error("SECRET record failure");
  const log = mock.method(batchLogger, "error", () => undefined);
  const run = makeBatchHandler(async () => { throw original; });
  await assert.rejects(run({ records: [{}] }, context), error => error === original);
  assert.equal(log.mock.callCount(), 1);
  const fields = log.mock.calls[0]?.arguments[1] as Record<string, unknown>;
  assert.equal(fields.location, "processRecord");
  assert.equal(fields.request_id, "invocation-1");
  assert.equal(fields["failure.class"], "unknown");
  assert.doesNotMatch(JSON.stringify(fields), /SECRET|stack/);
});

test("batch logging and publication failures cannot replace the original error", async () => {
  const original = new Error("business error");
  mock.method(batchLogger, "error", () => { throw new Error("sink failure"); });
  mock.method(metrics, "publishStoredMetrics", () => { throw new Error("EMF failure"); });
  await assert.rejects(makeBatchHandler(async () => { throw original; })({ records: [{}] }, context), error => error === original);
});

test("failed cleanup prevents stale metadata publication and still resets other state", async () => {
  metrics.addMetadata("private", "SECRET");
  const clear = metrics.clearMetadata.bind(metrics);
  mock.method(metrics, "clearMetadata", () => { throw new Error("cleanup unavailable"); });
  const publication = mock.method(metrics, "publishStoredMetrics", () => metrics);
  assert.deepEqual(await batch({ records: [{}] }, context), [{ score: 0, usedFallback: true }]);
  assert.equal(publication.mock.callCount(), 0);
  assert.equal(metrics.hasStoredMetrics(), false);
  clear(); // Restore the simulated broken sink for later tests.
});


test("SDK attempt totals use actual metadata and expose missing evidence", async () => {
  const records = captureEmf(dependencyMetrics);
  mock.method(tracer, "getSegment", () => undefined);
  let calls = 0;
  mock.method(client, "send", async () => {
    if (++calls === 1) return { Item: {}, $metadata: { attempts: 2 } };
    if (calls === 2) throw Object.assign(new Error("PRIVATE"), { $metadata: { attempts: 3 } });
    return { Item: {} };
  });
  await lookupOrder("private");
  await assert.rejects(lookupOrder("private"));
  await lookupOrder("private");
  assert.deepEqual(records.map(r => [r.DependencyAttempts, r.MissingAttemptEvidence]), [[2, 0], [3, 0], [undefined, 1]]);
});

test("handler trace setup failure cannot prevent the dependency result", async () => {
  mock.method(tracer, "isTracingEnabled", () => true);
  mock.method(tracer, "getSegment", () => { throw new Error("trace setup failed"); });
  mock.method(client, "send", async () => ({ Item: {} }));
  assert.deepEqual(await tracedHandler({ orderId: "private" }, context), { found: true });
});

test("handler restores parent context despite trace close failure", async () => {
  const handlerSegment = { close: () => { throw new Error("close failed"); }, addNewSubsegment: () => undefined };
  const parent = { addNewSubsegment: () => handlerSegment };
  let active: unknown = parent;
  mock.method(tracer, "isTracingEnabled", () => true);
  mock.method(tracer, "getSegment", () => active as never);
  mock.method(tracer, "setSegment", (segment: unknown) => { active = segment; });
  mock.method(tracer, "annotateColdStart", () => undefined);
  mock.method(tracer, "addServiceNameAnnotation", () => undefined);
  mock.method(client, "send", async () => ({ Item: {} }));
  assert.deepEqual(await tracedHandler({ orderId: "private" }, context), { found: true });
  assert.equal(active, parent);
});
