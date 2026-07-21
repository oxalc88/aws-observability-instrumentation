import { TraceFlags } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import { LogEventDef } from "../src/log-event.js";
import { MetricDef } from "../src/metric-def.js";
import {
  LoggingContractError,
  StructuredLogger,
  type LogRecord,
} from "../src/structured-logger.js";

const COMPLETED = new LogEventDef({
  name: "app.order.completed",
  level: "INFO",
  message: "Order completed",
  owner: "orders",
  fields: {
    outcome: "operational",
    "order.reference": "correlation",
    "customer.email": "sensitive",
  },
  required: new Set(["outcome"]),
});

const FAILURES = MetricDef.failureCounter({
  name: "app.order.failure",
  unit: "{failure}",
  owner: "orders",
  description: "Orders that terminated with an application exception.",
});

const FAILED = new LogEventDef({
  name: "app.order.failed",
  level: "ERROR",
  message: "Order failed",
  owner: "orders",
  operationName: "orders.create",
  relatedMetric: FAILURES,
  fields: {
    "failure.class": "operational",
  },
  required: new Set(["failure.class"]),
});

describe("StructuredLogger", () => {
  it("applies an ordered sampling rule consistently across one workflow", () => {
    const records: LogRecord[] = [];
    const diagnostic = new LogEventDef({
      name: "app.order.diagnostic",
      level: "INFO",
      message: "Order diagnostic recorded",
      owner: "orders",
      samplingClass: "diagnostic",
    });
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "production",
      samplingRules: [
        {
          id: "diagnostic-info",
          levels: ["INFO"],
          samplingClasses: ["diagnostic"],
          rate: 0.1,
        },
      ],
      sink: (record) => records.push(record),
      activeSpanContext: () => undefined,
    });

    const decisions = new Set<boolean>();
    for (let index = 0; index < 100; index += 1) {
      const correlationId = `workflow-${index}`;
      const first = logger.emit(diagnostic, {}, { correlationId });
      const second = logger.emit(diagnostic, {}, { correlationId });
      expect(second).toBe(first);
      decisions.add(first);
    }

    expect(decisions).toEqual(new Set([false, true]));
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThan(200);
    expect(records[0]).toMatchObject({
      "sampling.policy": "diagnostic-info",
      "sampling.rate": 0.1,
    });
  });

  it("always retains errors and security events even when a broad rule drops records", () => {
    const records: LogRecord[] = [];
    const securityEvent = new LogEventDef({
      name: "app.auth.validation.failed",
      level: "INFO",
      message: "Authentication input validation failed",
      owner: "security",
      securityRelevant: true,
    });
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "production",
      samplingRules: [{ id: "drop-all", rate: 0 }],
      sink: (record) => records.push(record),
      activeSpanContext: () => undefined,
    });

    expect(
      logger.emit(
        FAILED,
        { "failure.class": "internal_error" },
        { correlationId: "flow-1" },
      ),
    ).toBe(true);
    expect(logger.emit(securityEvent, {}, { correlationId: "flow-1" })).toBe(
      true,
    );
    expect(
      logger.emit(
        COMPLETED,
        { outcome: "success" },
        { correlationId: "flow-1" },
      ),
    ).toBe(false);
    expect(records.map((record) => record["sampling.policy"])).toEqual([
      "mandatory.error",
      "mandatory.security",
    ]);
    expect(records.every((record) => record["sampling.rate"] === 1)).toBe(true);
  });

  it("rejects sampling policies that weaken mandatory retention or reuse an id", () => {
    const options = {
      serviceName: "orders-api",
      environment: "production",
      sink: () => undefined,
    };
    expect(
      () =>
        new StructuredLogger({
          ...options,
          samplingRules: [
            { id: "errors", levels: ["ERROR"], rate: 0.5, locked: true },
          ],
        }),
    ).toThrow("Locked sampling policy");
    expect(
      () =>
        new StructuredLogger({
          ...options,
          samplingRules: [
            { id: "diagnostic", levels: ["INFO"], rate: 0.1 },
            { id: "diagnostic", levels: ["DEBUG"], rate: 0.01 },
          ],
        }),
    ).toThrow("Duplicate sampling policy");
    for (const rule of [
      { id: "errors", levels: ["ERROR"] as const, rate: 1 },
      { id: "security", securityRelevant: true, rate: 1 },
    ]) {
      expect(
        () =>
          new StructuredLogger({
            ...options,
            samplingRules: [rule],
          }),
      ).toThrow("must be locked");
    }
  });

  it("rejects an unsupported field classification at the event boundary", () => {
    expect(
      () =>
        new LogEventDef({
          name: "app.order.invalid",
          level: "INFO",
          message: "Invalid event schema",
          owner: "orders",
          fields: { outcome: "unclassified" as never },
        }),
    ).toThrow("classification");
  });

  it("rejects direct session identifiers and raw error messages", () => {
    for (const field of ["session.id", "error.message"]) {
      expect(
        () =>
          new LogEventDef({
            name: "app.order.failed",
            level: "ERROR",
            message: "Order failed",
            owner: "orders",
            fields: { [field]: "sensitive" },
          }),
      ).toThrow("Forbidden log field");
    }
  });

  it("reserves logger-managed correlation and source fields", () => {
    for (const field of [
      "service.name",
      "metric.name",
      "exception.type",
      "code.file.path",
      "sampling.policy",
      "sampling.rate",
    ]) {
      expect(
        () =>
          new LogEventDef({
            name: "app.order.invalid",
            level: "ERROR",
            message: "Invalid event schema",
            owner: "orders",
            fields: { [field]: "operational" },
          }),
      ).toThrow("Managed log field");
    }
  });

  it("writes one correlated JSON-shaped record", () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      serviceVersion: "1.2.3",
      environment: "test",
      sink: (record) => records.push(record),
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      activeSpanContext: () => ({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.SAMPLED,
      }),
    });

    expect(
      logger.emit(COMPLETED, {
        outcome: "success",
        "order.reference": "ord_7",
      }),
    ).toBe(true);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: "2026-01-02T03:04:05.000Z",
      level: "INFO",
      message: "Order completed",
      "event.name": "app.order.completed",
      "service.name": "orders-api",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
      correlation_id: "0af7651916cd43dd8448eb211c80319c",
    });
  });

  it("reads the workflow correlation id from the active OTel context", () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({
      serviceName: "orders-worker",
      environment: "test",
      sink: (record) => records.push(record),
      activeSpanContext: () => ({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.SAMPLED,
      }),
      activeCorrelationId: () => "order-workflow-7",
    });

    logger.emit(COMPLETED, { outcome: "success" });

    expect(records[0]).toMatchObject({
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      correlation_id: "order-workflow-7",
    });
  });

  it("links a failure metric to its trace and safe thrown source location", () => {
    const records: LogRecord[] = [];
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'id')",
    );
    error.stack = [
      `TypeError: ${error.message}`,
      "    at createOrder (/var/task/src/orders/create-order.ts:84:17)",
      "    at handler (/var/task/src/handler.ts:21:9)",
    ].join("\n");
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      serviceVersion: "1.2.3",
      environment: "production",
      sink: (record) => records.push(record),
      activeSpanContext: () => ({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.SAMPLED,
      }),
    });

    logger.emit(FAILED, { "failure.class": "internal_error" }, { error });

    expect(records[0]).toMatchObject({
      "event.name": "app.order.failed",
      "operation.name": "orders.create",
      "metric.name": "app.order.failure",
      "failure.class": "internal_error",
      "exception.type": "TypeError",
      "code.file.path": "/var/task/src/orders/create-order.ts",
      "code.function.name": "createOrder",
      "code.line.number": 84,
      "code.column.number": 17,
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
    });
    expect(records[0]).not.toHaveProperty("exception.message");
    expect(records[0]).not.toHaveProperty("exception.stacktrace");
  });

  it("rejects undeclared and disabled sensitive fields", () => {
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "test",
      sink: () => undefined,
    });
    expect(() =>
      logger.emit(COMPLETED, { outcome: "success", extra: "no" }),
    ).toThrow(LoggingContractError);
    expect(() =>
      logger.emit(COMPLETED, {
        outcome: "success",
        "customer.email": "person@example.com",
      }),
    ).toThrow("Sensitive field");
  });

  it("filters below the configured minimum level", () => {
    const records: LogRecord[] = [];
    const debug = new LogEventDef({
      name: "app.order.diagnostic",
      level: "DEBUG",
      message: "Order diagnostic",
      owner: "orders",
    });
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "test",
      minimumLevel: "WARN",
      sink: (record) => records.push(record),
    });

    expect(logger.emit(debug)).toBe(false);
    expect(records).toHaveLength(0);
  });

  it("neutralizes log injection and contains sink failures", () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "test",
      sink: (record) => records.push(record),
    });
    logger.emit(COMPLETED, {
      outcome: "success\nforged",
      "order.reference": "ord_7",
    });
    expect(records[0]?.outcome).toBe("success\\u000aforged");

    const failingLogger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "test",
      sink: () => {
        throw new Error("sink unavailable");
      },
      onSinkError: () => {
        throw new Error("fallback unavailable");
      },
    });
    expect(failingLogger.emit(COMPLETED, { outcome: "success" })).toBe(false);
  });

  it("does not filter security-relevant events", () => {
    const records: LogRecord[] = [];
    const securityEvent = new LogEventDef({
      name: "app.auth.validation.failed",
      level: "INFO",
      message: "Authentication input validation failed",
      owner: "security",
      securityRelevant: true,
    });
    const logger = new StructuredLogger({
      serviceName: "orders-api",
      environment: "test",
      minimumLevel: "ERROR",
      sink: (record) => records.push(record),
    });
    expect(logger.emit(securityEvent)).toBe(true);
    expect(records[0]?.["security.relevant"]).toBe(true);
  });
});
