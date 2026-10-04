import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { handler as validate, logger as validationLogger } from "./validation-handler.js";
import { handler as batch, makeBatchHandler, metrics } from "./batch-metrics.js";
import { client, lambdaHandler, logger as dependencyLogger, lookupOrder, tracer } from "./dependency-handler.js";

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
  await batch({ records: [{ primaryScore: 1 }, {}, {}] });
  await batch({ records: [{ primaryScore: 2 }] });
  assert.equal(records.length, 2);
  assert.equal(records[0]?.ProcessedRecords, 3);
  assert.equal(records[0]?.FallbackRecords, 2);
  assert.equal(records[1]?.ProcessedRecords, 1);
  assert.equal(records[1]?.FallbackRecords, 0);
  assert.deepEqual(records[0]?._aws.CloudWatchMetrics[0].Dimensions, [["service"]]);
  assert.doesNotMatch(JSON.stringify(records), /stale|PRIVATE|request_id/);
  assert.equal(metrics.hasStoredMetrics(), false);
});

test("empty batch produces no EMF or empty-publication warning", async () => {
  const publication = mock.method(metrics, "publishStoredMetrics", () => metrics);
  await batch({ records: [] });
  assert.equal(publication.mock.callCount(), 0);
});

test("failed publication clears state and preserves the successful business result", async () => {
  mock.method(metrics, "publishStoredMetrics", () => { throw new Error("SDK failure"); });
  assert.deepEqual(await batch({ records: [{}] }), [{ score: 0, usedFallback: true }]);
  assert.equal(metrics.hasStoredMetrics(), false);
});

test("telemetry and cleanup failure cannot replace the original application error", async () => {
  const original = new Error("domain failure");
  mock.method(metrics, "publishStoredMetrics", () => { throw new Error("SDK failure"); });
  const clear = metrics.clearMetrics.bind(metrics);
  mock.method(metrics, "clearMetrics", () => { clear(); throw new Error("cleanup failure"); });
  const run = makeBatchHandler(async () => { throw original; });
  await assert.rejects(run({ records: [{}] }), (error) => error === original);
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
  await assert.rejects(run({ records: [{}, {}] }), (error) => error === original);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ProcessedRecords, 1);
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
