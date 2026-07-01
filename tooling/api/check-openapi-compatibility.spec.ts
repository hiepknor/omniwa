import { describe, expect, it } from "vitest";

import {
  createOpenApiCompatibilityBaseline,
  evaluateOpenApiCompatibilityFromDocuments,
} from "./check-openapi-compatibility.mjs";

describe("OpenAPI compatibility check", () => {
  it("passes when the current OpenAPI document matches the compatibility baseline", () => {
    const openApi = createFixtureOpenApi();
    const baseline = createOpenApiCompatibilityBaseline(openApi);

    expect(evaluateOpenApiCompatibilityFromDocuments(openApi, baseline)).toEqual({
      status: "passed",
      findings: [],
    });
  });

  it("fails when a public operation is removed", () => {
    const openApi = createFixtureOpenApi();
    const baseline = createOpenApiCompatibilityBaseline(openApi);
    delete openApi.paths["/v1/items"].get;

    const report = evaluateOpenApiCompatibilityFromDocuments(openApi, baseline);

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "operation_removed",
        target: "GET /v1/items",
      }),
    ]);
  });

  it("fails when an operation id changes", () => {
    const openApi = createFixtureOpenApi();
    const baseline = createOpenApiCompatibilityBaseline(openApi);
    openApi.paths["/v1/items"].get.operationId = "queryItems";

    const report = evaluateOpenApiCompatibilityFromDocuments(openApi, baseline);

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "operation_id_changed",
        target: "GET /v1/items",
      }),
    ]);
  });

  it("fails when a public response changes", () => {
    const openApi = createFixtureOpenApi();
    const baseline = createOpenApiCompatibilityBaseline(openApi);
    openApi.paths["/v1/items"].get.responses["200"] = {
      $ref: "#/components/responses/Success",
    };

    const report = evaluateOpenApiCompatibilityFromDocuments(openApi, baseline);

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "response_changed",
        target: "GET /v1/items",
      }),
    ]);
  });

  it("fails when a required parameter is added to an existing operation", () => {
    const openApi = createFixtureOpenApi();
    const baseline = createOpenApiCompatibilityBaseline(openApi);
    openApi.paths["/v1/items"].get.parameters.push({
      $ref: "#/components/parameters/RequiredTenant",
    });

    const report = evaluateOpenApiCompatibilityFromDocuments(openApi, baseline);

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "required_parameter_added",
        target: "GET /v1/items",
      }),
    ]);
  });

  it("fails when deprecated operations do not include OmniWA deprecation metadata", () => {
    const openApi = createFixtureOpenApi();
    openApi.paths["/v1/items"].get.deprecated = true;
    const baseline = createOpenApiCompatibilityBaseline(openApi);

    const report = evaluateOpenApiCompatibilityFromDocuments(openApi, baseline);

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "deprecation_metadata_missing",
        target: "GET /v1/items",
      }),
    ]);
  });
});

type FixtureOpenApi = {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
  paths: {
    "/v1/items": {
      get: FixtureOperation;
      post: FixtureOperation;
    };
  };
  components: {
    parameters: Record<string, FixtureParameter>;
    requestBodies: Record<string, FixtureRequestBody>;
    responses: Record<string, FixtureResponse>;
    schemas: Record<string, FixtureSchema>;
  };
};

type FixtureOperation = {
  operationId: string;
  deprecated?: boolean;
  parameters: Array<{ $ref: string }>;
  requestBody?: { $ref: string };
  responses: Record<string, { $ref: string }>;
};

type FixtureParameter = {
  name: string;
  in: string;
  required: boolean;
};

type FixtureRequestBody = {
  required: boolean;
  content: Record<string, { schema: Record<string, string> }>;
};

type FixtureResponse = {
  description: string;
};

type FixtureSchema = {
  type: string;
  required: string[];
  properties: Record<string, Record<string, string>>;
};

function createFixtureOpenApi(): FixtureOpenApi {
  return {
    openapi: "3.1.0",
    info: {
      title: "Fixture API",
      version: "0.1.0",
    },
    paths: {
      "/v1/items": {
        get: {
          operationId: "listItems",
          parameters: [{ $ref: "#/components/parameters/Limit" }],
          responses: {
            "200": { $ref: "#/components/responses/CollectionSuccess" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
        post: {
          operationId: "createItem",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKeyHeader" }],
          requestBody: { $ref: "#/components/requestBodies/CreateItem" },
          responses: {
            "202": { $ref: "#/components/responses/Accepted" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
    },
    components: {
      parameters: {
        IdempotencyKeyHeader: {
          name: "idempotency-key",
          in: "header",
          required: false,
        },
        Limit: {
          name: "limit",
          in: "query",
          required: false,
        },
        RequiredTenant: {
          name: "tenant",
          in: "query",
          required: true,
        },
      },
      requestBodies: {
        CreateItem: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
              },
            },
          },
        },
      },
      responses: {
        Accepted: {
          description: "Accepted",
        },
        CollectionSuccess: {
          description: "Collection success",
        },
        Success: {
          description: "Success",
        },
        Unauthorized: {
          description: "Unauthorized",
        },
      },
      schemas: {
        CollectionEnvelope: {
          type: "object",
          required: ["data", "meta"],
          properties: {
            data: { type: "array" },
            meta: { type: "object" },
          },
        },
        SuccessEnvelope: {
          type: "object",
          required: ["data", "meta"],
          properties: {
            data: { type: "object" },
            meta: { type: "object" },
          },
        },
      },
    },
  };
}
