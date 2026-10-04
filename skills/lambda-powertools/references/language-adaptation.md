# Language-neutral contract, language-specific APIs

Apply all shared surface, signal, diagnostic, cost and review rules regardless of language. TypeScript and Python are tested examples, not a supported-language allowlist. Preserve semantic coverage when porting; do not transliterate APIs, constructor flags or defaults.

## Detect and load

Inspect the Lambda entry point, deployment runtime and nearest manifest. A root manifest can belong to tooling in a mixed-language repository, so select the language of the actual handler. Extend existing emitters and package versions rather than scaffolding a second architecture.

| Evidence | Implementation guidance |
| --- | --- |
| package.json / Node.js handler | TypeScript or JavaScript; load [TypeScript](languages/typescript.md) and examples/typescript |
| pyproject.toml / requirements / Python handler | Load [Python](languages/python.md) and examples/python |
| pom.xml / build.gradle / JVM handler | Verify official Powertools Java APIs and runtime compatibility; map the shared contract with idiomatic wrappers/annotations |
| .csproj / .fsproj / .sln / .NET handler | Verify official Powertools .NET APIs, supported runtime and utility support; map the shared contract with idiomatic lifecycle hooks |
| Another language/runtime | Apply the same measurement and diagnostic contract. Verify whether an official Powertools SDK exists; do not invent a package or copy another language's API |

Official Powertools SDKs are available for Python, TypeScript/JavaScript, Java and .NET. This repository validates representative TypeScript and Python implementations only. Other ports require language-specific compatibility checks and tests; do not claim tested parity merely because the policy is shared.

If an SDK/utility is unavailable, report the implementation gap and existing equivalent coverage. Do not silently switch to the root OTel contract or build a competing generic framework. Choosing another instrumentation architecture is a separate explicit decision; the operational requirements still apply.

## Port acceptance

Preserve fixed names/units/purposes, populations, boundary timing, taxonomy, compatible denominators, bounded dimensions and one emission owner. Use a monotonic clock. Preserve individual latency samples and unsampled exact counts. Assess async/concurrent execution, metric state ownership and warm-invocation cleanup rather than assuming module globals are isolated.

Verify installed SDK behavior for metric aggregation/flushing/reset, default dimensions, Logger exception/event serialization, trace auto-patching, capture flags, parent restoration, sampling and propagation. Language-specific SDK defaults may leak data or share state. Contain telemetry failures at the selected owner without changing application/retry/ack behavior; test safe fields and failures using the language's native tools.

[Official SDK overview](https://docs.aws.amazon.com/lambda/latest/dg/powertools-for-lambda.html), [Java](https://docs.aws.amazon.com/powertools/java/latest/), [.NET](https://docs.aws.amazon.com/powertools/dotnet/).
