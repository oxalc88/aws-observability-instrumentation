import assert from "node:assert/strict";
import { diagnosticEvidence, emitDiagnostic } from "./diagnostic-evidence.js";
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
  const original = Object.assign(new Error("SECRET SDK TEXT"), { $metadata: { httpStatusCode: 503 } });
  mock.method(client, "send", async () => { throw original; });
  const log = mock.method(dependencyLogger, "error", () => undefined);
  await assert.rejects(lambdaHandler({ orderId: "PRIVATE_ORDER" }, context), (error) => error === original);
  assert.deepEqual(names, ["DynamoDB.GetItem"]);
  assert.equal(closed, 1);
  assert.equal(fault, 1);
  assert.equal(log.mock.callCount(), 1);
  const fields = log.mock.calls[0]?.arguments[1] as Record<string, unknown>;
  assert.equal(fields["dependency.operation"], "GetItem");
  assert.equal(fields["http.status_class"], "5xx");
  assert.equal(fields["http.status_code"], 503);
  assert.equal(fields["exception.name"], "Error");
  assert.equal(typeof fields["exception.stack"], "string");
  assert.equal(fields["retry.decision"], "propagate");
  assert.equal(fields.request_id, "invocation-1");
  assert.doesNotMatch(JSON.stringify(fields), /SECRET|PRIVATE_ORDER/);
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

test("unknown provider HTTP 426 retains sanitized code/message and independent classification", () => {
  const original = new Error("Provider returned HTTP 426", { cause: new Error("connection upgraded") });
  const evidence = diagnosticEvidence(original, {
    httpStatus: 426, providerCode: "NON_DOCUMENTED_CODE",
    providerMessage: "Unexpected condition reported by provider",
  });
  assert.equal(evidence["http.status_code"], 426);
  assert.equal(evidence["http.status_class"], "4xx");
  assert.equal(evidence["provider.error_code"], "NON_DOCUMENTED_CODE");
  assert.equal(evidence["provider.error_message"], "Unexpected condition reported by provider");
  assert.match(String(evidence["exception.stack"]), /Provider returned HTTP 426/);
  assert.equal((evidence["exception.causes"] as Array<Record<string, unknown>>)[0]?.message, "connection upgraded");
});

test("sanitization removes sensitive material from all evidence surfaces", () => {
  const original = new Error("Bearer my_access_token SECRET contact someone@example.com", {
    cause: new Error("password=hunter2 request https://provider.test/path?token=abc123"),
  });
  const evidence = diagnosticEvidence(original, {
    httpStatus: 426, providerCode: "STRANGE_CODE",
    providerMessage: "Authorization: Bearer someToken email ops@example.com",
  });
  const json = JSON.stringify(evidence);
  for (const secret of ["my_access_token", "hunter2", "abc123", "ops@example.com", "someone@example.com", "someToken"]) {
    assert.equal(json.includes(secret), false, "leaked " + secret);
  }
  assert.ok((evidence["diagnostic.redacted"] as string[]).length > 0);
});

test("unexpected provider shape and cause cycles preserve available evidence", () => {
  const original = new Error("x".repeat(1200));
  original.stack = "Error: " + "line".repeat(2000);
  (original as Error & { cause?: unknown }).cause = original;
  const evidence = diagnosticEvidence(original, {
    httpStatus: "426", providerCode: { code: "INVALID" },
    providerMessage: "DO NOT LOG AN UNREVIEWED RESPONSE",
  });
  assert.equal(evidence["http.status_code"], undefined);
  assert.equal(evidence["provider.error_message"], "DO NOT LOG AN UNREVIEWED RESPONSE");
  assert.equal(JSON.stringify(evidence["provider.error_code"]), JSON.stringify({ code: "INVALID" }));
  assert.equal(String(evidence["exception.message"]).length, 1200);
  assert.equal(String(evidence["exception.stack"]).length, 8007);
  assert.deepEqual(evidence["diagnostic.truncated"], []);
  assert.ok((evidence["diagnostic.omitted"] as string[]).includes("exception.causes:cycle"));
});

test("two records do not exchange diagnostic context and hostile getters cannot replace business error", () => {
  const first = Object.defineProperty(new Error("first incident"), "cause", { get() { throw new Error("PRIVATE_SECRET"); } });
  const second = new Error("second incident");
  const a = diagnosticEvidence(first, { httpStatus: 426, providerCode: "FIRST" });
  const b = diagnosticEvidence(second, { httpStatus: 503, providerCode: "SECOND" });
  assert.equal(a["http.status_code"], 426);
  assert.equal(b["http.status_code"], 503);
  assert.equal(b["provider.error_code"], "SECOND");
  assert.equal(JSON.stringify(b).includes("FIRST"), false);
  assert.equal(first.message, "first incident");
  assert.equal(second.message, "second incident");
});

test("long stacks and all six causes are retained without cuts", () => {
  const original = new Error("x".repeat(700));
  original.stack = "frame".repeat(1500);
  let current = original;
  for (let i = 0; i < 6; i++) {
    const next = new Error("x".repeat(700));
    next.stack = "frame".repeat(1500);
    (current as Error & { cause?: Error }).cause = next;
    current = next;
  }
  const evidence = diagnosticEvidence(original, {
    httpStatus: 426, providerCode: "UNEXPECTED",
    providerMessage: "provider diagnostic".repeat(100),
  });
  assert.equal((evidence["exception.causes"] as unknown[]).length, 6);
  assert.equal(evidence["exception.stack"], original.stack);
  assert.ok((evidence["exception.causes"] as Record<string, unknown>[]).every(cause => cause.stack === "frame".repeat(1500)));
  assert.deepEqual(evidence["diagnostic.truncated"], []);
});

test("unknown response formats preserve numeric codes, structure and sanitize keys and values", () => {
  for (const response of [{ unknown: [17, { message: "undocumented", code: 731 }] }, ["undocumented", 731], 731, false, null, "non-JSON undocumented text"]) {
    const evidence = diagnosticEvidence(new Error("original"), { httpStatus: 426, providerCode: 731, providerResponse: response });
    assert.equal(evidence["provider.error_code"], 731);
    assert.equal(evidence["http.status_code"], 426);
    assert.equal(JSON.stringify(evidence["provider.error_response"]), JSON.stringify(response));
  }
  const response = { unfamiliar: "ops@example.com", token: { nested: "abc123" }, password: "hunter2", "ops@example.com": "safe", extra: { authorization: "Bearer abc123" } };
  const e = diagnosticEvidence(new Error("failure"), { providerResponse: response });
  assert.doesNotMatch(JSON.stringify(e), /abc123|hunter2|ops@example.com/);
  assert.ok((e["diagnostic.redacted"] as string[]).length);
  const hostile = Object.defineProperty({}, "surprise", { enumerable: true, get() { throw Error("PRIVATE_SECRET"); } });
  const h = diagnosticEvidence(new Error("failure"), { providerResponse: hostile });
  assert.ok((h["diagnostic.omitted"] as string[]).some(x => x.includes("accessor_failed")));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.match(JSON.stringify(diagnosticEvidence(new Error("failure"), { providerResponse: cyclic })), /cycle/);
});

test("multipart evidence reassembles exactly at INFO and failed parts are declared", () => {
  const records: Record<string, unknown>[] = [];
  const original = new Error("original"); original.stack = "frame 😀\n".repeat(16000);
  const evidence = diagnosticEvidence(original, { httpStatus: 426, providerCode: 731, providerResponse: { unknown: "large".repeat(15000) } });
  const fake = { error: (_: string, record: object) => records.push(record as Record<string, unknown>), warn: () => {} };
  assert.equal(emitDiagnostic(fake as never, "Dependency failed", { request_id: "one", "failure.class": "unknown", "retry.decision": "propagate" }, evidence), true);
  const parts = records.filter(r => r["diagnostic.kind"] === "part");
  assert.ok(parts.length > 1);
  assert.equal(Buffer.concat(parts.map(r => Buffer.from(String(r["diagnostic.data"]), "base64"))).toString("utf8"), JSON.stringify(evidence));
  assert.ok(records.every(r => Buffer.byteLength(JSON.stringify(r)) + 8192 <= 60 * 1024));
  assert.equal(new Set(records.map(r => r["diagnostic.id"])).size, 1);
  const manifest = records.at(-1)!;
  assert.equal(manifest["diagnostic.parts"], parts.length);
  assert.equal(manifest["diagnostic.emission_complete"], true);
  records.length = 0;
  let calls = 0;
  fake.error = (_, record) => { if (++calls === 2) throw Error("sink unavailable"); return records.push(record as Record<string, unknown>); };
  assert.equal(emitDiagnostic(fake as never, "Dependency failed", {}, evidence), false);
  assert.equal(records.at(-1)!["diagnostic.emission_complete"], false);
  assert.equal(records.at(-1)!["diagnostic.failed_parts"], 1);
  const unavailable = { error() { throw Error("offline"); }, warn() { throw Error("offline"); } };
  assert.equal(emitDiagnostic(unavailable as never, "Dependency failed", {}, evidence), false);
});

test("real Powertools INFO logger emits ordered WARN evidence parts within the budget", () => {
  const lines: string[] = [];
  mock.method(process.stdout, "write", (chunk: unknown) => { lines.push(String(chunk)); return true; });
  mock.method(process.stderr, "write", (chunk: unknown) => { lines.push(String(chunk)); return true; });
  const evidence = diagnosticEvidence(new Error("original"), { httpStatus: 426, providerCode: 731, providerResponse: "undocumented 😀\n".repeat(12000) });
  assert.equal(emitDiagnostic(dependencyLogger, "Dependency failed", { request_id: "one" }, evidence, "warn"), true);
  const records = lines.map(line => JSON.parse(line));
  assert.ok(records.length > 2);
  assert.ok(records.every(r => r.level === "WARN" && r.service === "orders"));
  assert.ok(lines.every(line => Buffer.byteLength(line, "utf8") < 60 * 1024));
  const parts = records.filter(r => r["diagnostic.kind"] === "part");
  assert.equal(Buffer.concat(parts.map(r => Buffer.from(r["diagnostic.data"], "base64"))).toString("utf8"), JSON.stringify(evidence));
});

test("HTTP 426 boundary preserves numeric evidence and original identity when all telemetry fails", async () => {
  const original = Object.assign(new Error("original"), { $metadata: { httpStatusCode: 426 }, code: 731,
    providerMessage: "Undocumented upgrade condition", providerResponse: { unknown: [731, "Undocumented upgrade condition"] } });
  mock.method(client, "send", async () => { throw original; });
  mock.method(tracer, "getSegment", () => { throw Error("trace unavailable"); });
  const log = mock.method(dependencyLogger, "error", () => undefined);
  await assert.rejects(lambdaHandler({ orderId: "private" }, context), e => e === original);
  const record = log.mock.calls[0]!.arguments[1] as Record<string, unknown>;
  assert.equal(record["http.status_code"], 426);
  assert.equal(record["provider.error_code"], 731);
  assert.equal(record["provider.error_message"], original.providerMessage);
  assert.equal(JSON.stringify(record["provider.error_response"]), JSON.stringify(original.providerResponse));
  assert.equal(record["failure.class"], "unknown");
  assert.equal(record["retry.decision"], "propagate");
  mock.method(dependencyLogger, "error", () => { throw Error("logger unavailable"); });
  mock.method(dependencyMetrics, "publishStoredMetrics", () => { throw Error("metrics unavailable"); });
  await assert.rejects(lambdaHandler({ orderId: "private" }, context), e => e === original);
  mock.method(client, "send", async () => ({ Item: {} }));
  assert.deepEqual(await lambdaHandler({ orderId: "private" }, context), { found: true });
});

test("JSON transport text sanitizes nested credentials without hiding unknown evidence", () => {
  assert.equal(diagnosticEvidence(new Error("original"), { providerCode: "123456789012" })["provider.error_code"], "123456789012");
  const evidence = diagnosticEvidence(new Error("original"), { providerResponse: '{"unknown":[731,"undocumented"],"access_token":"opaqueCredential","nested":{"password":"hunter2"}}' });
  const body = JSON.parse(String(evidence["provider.error_response"]));
  assert.deepEqual(body.unknown, [731, "undocumented"]);
  assert.doesNotMatch(JSON.stringify(evidence), /opaqueCredential|hunter2/);
  assert.ok((evidence["diagnostic.normalized"] as string[]).includes("provider.error_response"));
});

test("unavailable original stack is declared without serializing a throwing accessor", () => {
  const original = Object.defineProperty(new Error("original"), "stack", { get() { throw Error("PRIVATE_SECRET"); } });
  const evidence = diagnosticEvidence(original);
  assert.equal(evidence["exception.stack"], undefined);
  assert.ok((evidence["diagnostic.omitted"] as string[]).includes("exception.stack:accessor_failed"));
  assert.equal(evidence["diagnostic.capture_complete"], false);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_SECRET/);
  assert.equal(original.message, "original");
});
