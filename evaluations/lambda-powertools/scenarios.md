# Realistic consumer requests

Each numbered paragraph below is an independent user prompt. Give one prompt and an ordinary minimal Lambda consumer project to each isolated agent. Do not reveal the scenario labels to the agent.

## A. Validation endpoint

An API Gateway Lambda validates an order-enrichment request and returns 400 for missing supported fields. Add production observability using Powertools. I need to know which rule rejected the request without logging its body. The existing Powertools Metrics measurements must remain correct.

## B. Unknown provider failure

A Lambda calls an HTTP menu provider. The provider sometimes returns HTTP 426 and undocumented code 731. Add production-safe diagnostics and keep the existing retry decision. Response bodies and error messages can contain tokens or personal data; never record them without an established safety contract.

## C. DynamoDB latency

A Lambda gets one DynamoDB item. Operators need invocation latency, caller-observed dependency latency, and a trace showing the meaningful dependency. Add Powertools observability with safe capture settings. Do not change the returned result or existing aggregate metrics.

## D. Existing instrumentation

A Lambda already has Powertools Logger, Metrics and Tracer. It has two duplicate terminal error logs and a manual subsegment around an already traced SDK client. Improve observability without increasing telemetry cost or changing public behavior.

## E. Large failure response

A Lambda catches an external API failure with a large, unpredictable JSON body and nested errors. Add a useful production error record that allows an engineer to find the failing operation and invocation. The body is not approved for logging; do not store customer data in CloudWatch.
