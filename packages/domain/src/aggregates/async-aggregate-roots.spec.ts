import { describe, expect, it } from "vitest";

import { createDomainOwnerContext } from "../errors/domain-owner-context.js";
import { createFailureCategory } from "../errors/failure-category.js";
import {
  createJobId,
  createWebhookDeliveryId,
  createWebhookId,
} from "../identity/aggregate-ids.js";
import {
  completeWorkerJob,
  markWorkerJobDead,
  queueWorkerJob,
  reserveWorkerJob,
  retryWorkerJob,
  startWorkerJob,
} from "../operations/worker-job.js";
import { createAttemptNumber } from "../policies/attempt-number.js";
import { createDeadLetterReason } from "../policies/dead-letter-reason.js";
import { createRetryPolicy } from "../policies/retry-policy.js";
import {
  cancelWebhookDelivery,
  deadLetterWebhookDelivery,
  retryWebhookDelivery,
  scheduleWebhookDelivery,
  startWebhookDelivery,
  succeedWebhookDelivery,
} from "../webhook/webhook-delivery.js";
import {
  activateWebhookSubscription,
  createWebhookSubscription,
  retireWebhookSubscription,
  validateWebhookSubscription,
} from "../webhook/webhook-subscription.js";
import { createWebhookUrl } from "../webhook/webhook-url.js";

describe("async aggregate roots", () => {
  it("requires validated WebhookSubscription before activation", () => {
    const subscription = createWebhookSubscription(
      createWebhookId("webhook_1"),
      createWebhookUrl("https://example.test/webhook"),
    );

    expect(() => activateWebhookSubscription(subscription)).toThrow(TypeError);

    const active = activateWebhookSubscription(validateWebhookSubscription(subscription));
    const retired = retireWebhookSubscription(active);

    expect(active.status).toBe("active");
    expect(retired.status).toBe("retired");
    expect(() => activateWebhookSubscription(retired)).toThrow(TypeError);
  });

  it("protects WebhookDelivery retry budget and terminal delivery state", () => {
    const retryPolicy = createRetryPolicy({
      maxAttempts: 2,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook_delivery_1"),
      createWebhookId("webhook_2"),
      "message_delivered",
      retryPolicy,
    );
    const delivering = startWebhookDelivery(delivery, createAttemptNumber(1, retryPolicy));
    const retrying = retryWebhookDelivery(
      delivering,
      createAttemptNumber(2, retryPolicy),
      createFailureCategory("network"),
    );
    const delivered = succeedWebhookDelivery(
      startWebhookDelivery(retrying, createAttemptNumber(2, retryPolicy)),
    );

    expect(retrying.status).toBe("retrying");
    expect(delivered.status).toBe("delivered");
    expect(() => cancelWebhookDelivery(delivered)).toThrow(TypeError);
    expect(() =>
      retryWebhookDelivery(
        delivered,
        createAttemptNumber(2, retryPolicy),
        createFailureCategory("network"),
      ),
    ).toThrow(TypeError);
  });

  it("records WebhookDelivery dead-letter reasons as safe classifications", () => {
    const retryPolicy = createRetryPolicy({
      maxAttempts: 1,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const delivery = scheduleWebhookDelivery(
      createWebhookDeliveryId("webhook_delivery_2"),
      createWebhookId("webhook_3"),
      "message_failed",
      retryPolicy,
    );
    const deadLettered = deadLetterWebhookDelivery(
      delivery,
      createDeadLetterReason({ code: "receiver_unavailable", category: "webhook" }),
    );

    expect(deadLettered.status).toBe("dead_letter");
    expect(deadLettered.deadLetterReason?.code).toBe("receiver_unavailable");
    expect(() => startWebhookDelivery(deadLettered, createAttemptNumber(1, retryPolicy))).toThrow(
      TypeError,
    );
  });

  it("keeps WorkerJob lifecycle visible and separate from owner outcome", () => {
    const retryPolicy = createRetryPolicy({
      maxAttempts: 2,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const job = queueWorkerJob(
      createJobId("job_1"),
      createDomainOwnerContext("messaging"),
      "send_message",
      retryPolicy,
    );
    const retrying = retryWorkerJob(
      startWorkerJob(reserveWorkerJob(job, createAttemptNumber(1, retryPolicy))),
      createAttemptNumber(2, retryPolicy),
      createFailureCategory("provider"),
    );
    const completed = completeWorkerJob(
      startWorkerJob(reserveWorkerJob(retrying, createAttemptNumber(2, retryPolicy))),
    );
    const dead = markWorkerJobDead(
      retrying,
      createDeadLetterReason({ code: "provider_terminal_failure", category: "provider" }),
    );

    expect(completed.status).toBe("completed");
    expect(dead.status).toBe("dead");
    expect(() => reserveWorkerJob(dead, createAttemptNumber(1, retryPolicy))).toThrow(TypeError);
  });
});
