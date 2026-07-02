import {
  createInstance,
  createInstanceId,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  type InstanceRepositoryPort,
} from "@omniwa/domain";
import { beforeEach, describe, expect, it } from "vitest";

export type InstanceRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): InstanceRepositoryPort;
}>;

export function describeInstanceRepositoryContract(
  factory: InstanceRepositoryContractFactory,
): void {
  describe(`${factory.name} InstanceRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and reports aggregate existence by InstanceId", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-load`);
      const instance = createInstance(instanceId);

      await expect(repository.exists(instanceId)).resolves.toBe(false);
      await repository.save(instance);

      await expect(repository.exists(instanceId)).resolves.toBe(true);
      await expect(repository.load(instanceId)).resolves.toEqual(instance);
    });

    it("filters instances by lifecycle status without returning destroyed instances as non-terminal", async () => {
      const repository = factory.create();
      const created = createInstance(
        createInstanceId(`${safeFactoryName(factory.name)}-instance-created`),
      );
      const connected = markInstanceConnected(
        markInstanceConnecting(
          createInstance(createInstanceId(`${safeFactoryName(factory.name)}-instance-connected`)),
        ),
        createSessionId(`${safeFactoryName(factory.name)}-session-connected`),
      );

      await repository.save(created);
      await repository.save(connected);

      await expect(repository.findByStatus("created")).resolves.toEqual([created]);
      await expect(repository.findByStatus("connected")).resolves.toEqual([connected]);
      const nonTerminal = await repository.findNonTerminal();

      expect(nonTerminal).toHaveLength(2);
      expect(nonTerminal).toEqual(expect.arrayContaining([created, connected]));
    });

    it("returns the current SessionId owned by the Instance aggregate", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-session`);
      const sessionId = createSessionId(`${safeFactoryName(factory.name)}-session-current`);
      const instance = markInstanceConnected(
        markInstanceConnecting(createInstance(instanceId)),
        sessionId,
      );

      await repository.save(instance);

      await expect(repository.getCurrentSessionId(instanceId)).resolves.toBe(sessionId);
    });
  });
}

function safeFactoryName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_:-]+/gu, "-");
}
