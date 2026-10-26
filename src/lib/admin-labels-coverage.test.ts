import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTION_LABELS, ENTITY_TYPE_LABELS } from "./admin-labels";

const SERVICES = path.join(__dirname, "..", "server", "services");

/** Action names and entity types in every writeAudit(...) call of the services. */
function auditCalls(): { actions: Set<string>; entities: Set<string> } {
  const actions = new Set<string>();
  const entities = new Set<string>();
  for (const file of readdirSync(SERVICES).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(path.join(SERVICES, file), "utf8");
    for (const call of src.split("writeAudit(").slice(1)) {
      const body = call.slice(0, call.indexOf("});"));
      const action = body.match(/action:([^\n]*)/)?.[1] ?? "";
      for (const m of action.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) actions.add(m[1]);
      const entity = body.match(/entityType:\s*"([A-Za-z]+)"/)?.[1];
      if (entity) entities.add(entity);
    }
  }
  return { actions, entities };
}

describe("audit log labels", () => {
  it("has a German label for every action and entity the services write", () => {
    const { actions, entities } = auditCalls();
    expect(actions.size).toBeGreaterThan(30);
    expect(actions).toContain("elo.match.correct");
    expect(actions).toContain("game.mode");
    expect([...actions].filter((a) => !(a in AUDIT_ACTION_LABELS))).toEqual([]);
    expect([...entities].filter((e) => !(e in ENTITY_TYPE_LABELS))).toEqual([]);
  });
});
