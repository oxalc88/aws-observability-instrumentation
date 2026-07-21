import { describe, expect, it } from "vitest";

import { classifyFailure } from "../src/failure-taxonomy.js";

describe("classifyFailure", () => {
  it("classifies JavaScript type defects as internal errors", () => {
    expect(
      classifyFailure(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
      ),
    ).toBe("internal_error");
    expect(
      classifyFailure(new RangeError("Maximum call stack size exceeded")),
    ).toBe("internal_error");
  });
});
