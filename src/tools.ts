import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SymconClient } from "./symcon.js";
import { logger } from "./logger.js";

export function registerTools(server: McpServer, symcon: SymconClient) {
  // ─── GetValue ──────────────────────────────────────────────────────────────
  server.tool(
    "symcon_get_value",
    "Read the current value of a variable in IP-Symcon",
    { variableId: z.number().int().describe("The numeric ID of the variable") },
    async ({ variableId }) => {
      logger.debug(`symcon_get_value: ${variableId}`);
      const value = await symcon.getValue(variableId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ variableId, value }),
          },
        ],
      };
    }
  );

  // ─── SetValue ─────────────────────────────────────────────────────────────
  server.tool(
    "symcon_set_value",
    "Write a value directly to a variable in IP-Symcon (bypasses action handlers)",
    {
      variableId: z.number().int().describe("The numeric ID of the variable"),
      value: z
        .union([z.boolean(), z.number(), z.string()])
        .describe("The value to set"),
    },
    async ({ variableId, value }) => {
      logger.debug(`symcon_set_value: ${variableId} = ${value}`);
      const result = await symcon.setValue(variableId, value);
      return {
        content: [
          { type: "text", text: JSON.stringify({ variableId, value, success: result }) },
        ],
      };
    }
  );

  // ─── RequestAction ────────────────────────────────────────────────────────
  server.tool(
    "symcon_request_action",
    "Trigger a device action via IP-Symcon (uses action handlers, e.g. for lights, switches, dimmers). " +
      "Prefer this over SetValue for real devices.",
    {
      variableId: z.number().int().describe("The numeric ID of the variable"),
      value: z
        .union([z.boolean(), z.number(), z.string()])
        .describe(
          "The action value, e.g. true/false for switches, 0-254 for Hue brightness"
        ),
    },
    async ({ variableId, value }) => {
      logger.debug(`symcon_request_action: ${variableId} = ${value}`);
      const result = await symcon.requestAction(variableId, value);
      return {
        content: [
          { type: "text", text: JSON.stringify({ variableId, value, success: result }) },
        ],
      };
    }
  );

  // ─── GetVariable ──────────────────────────────────────────────────────────
  server.tool(
    "symcon_get_variable",
    "Get detailed metadata about a variable (type, profile, timestamps, current value)",
    { variableId: z.number().int().describe("The numeric ID of the variable") },
    async ({ variableId }) => {
      logger.debug(`symcon_get_variable: ${variableId}`);
      const variable = await symcon.getVariable(variableId);
      const typeNames = ["Boolean", "Integer", "Float", "String"];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...variable,
              VariableTypeName: typeNames[variable.VariableType] ?? "Unknown",
              VariableUpdatedAt: new Date(variable.VariableUpdated * 1000).toISOString(),
              VariableChangedAt: new Date(variable.VariableChanged * 1000).toISOString(),
            }),
          },
        ],
      };
    }
  );

  // ─── GetObject ────────────────────────────────────────────────────────────
  server.tool(
    "symcon_get_object",
    "Get metadata about any IP-Symcon object (category, instance, variable, script, event, media, link)",
    { objectId: z.number().int().describe("The numeric ID of the object") },
    async ({ objectId }) => {
      logger.debug(`symcon_get_object: ${objectId}`);
      const obj = await symcon.getObject(objectId);
      const typeNames = [
        "Category",
        "Instance",
        "Variable",
        "Script",
        "Event",
        "Media",
        "Link",
      ];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...obj,
              ObjectTypeName: typeNames[obj.ObjectType] ?? "Unknown",
            }),
          },
        ],
      };
    }
  );

  // ─── GetChildren ──────────────────────────────────────────────────────────
  server.tool(
    "symcon_get_children",
    "Get the child object IDs of a given IP-Symcon object (use 0 for root)",
    {
      objectId: z
        .number()
        .int()
        .default(0)
        .describe("The parent object ID (0 = root)"),
    },
    async ({ objectId }) => {
      logger.debug(`symcon_get_children: ${objectId}`);
      const children = await symcon.getChildrenIds(objectId);
      return {
        content: [{ type: "text", text: JSON.stringify({ objectId, children }) }],
      };
    }
  );

  // ─── GetObjectIdByName ────────────────────────────────────────────────────
  server.tool(
    "symcon_get_object_id_by_name",
    "Find an object ID by its name (optionally restricted to a parent object)",
    {
      name: z.string().describe("The exact name of the object"),
      parentId: z
        .number()
        .int()
        .default(0)
        .describe("Parent object ID (0 = search all)"),
    },
    async ({ name, parentId }) => {
      logger.debug(`symcon_get_object_id_by_name: "${name}" under ${parentId}`);
      const objectId = await symcon.getObjectIdByName(name, parentId);
      return {
        content: [{ type: "text", text: JSON.stringify({ name, parentId, objectId }) }],
      };
    }
  );

  // ─── GetVariableByPath ────────────────────────────────────────────────────
  server.tool(
    "symcon_get_variable_by_path",
    "Resolve a variable by its slash-separated path in the object tree, e.g. 'Rooms/Ground Floor/Living Room/Light/State'",
    {
      path: z
        .string()
        .describe("Slash-separated path from root, e.g. Rooms/LivingRoom/Light"),
    },
    async ({ path }) => {
      logger.debug(`symcon_get_variable_by_path: ${path}`);
      const parts = path.split("/").filter(Boolean);
      let parentId = 0;
      let objectId = 0;
      for (const part of parts) {
        objectId = await symcon.getObjectIdByName(part, parentId);
        parentId = objectId;
      }
      const value = await symcon.getValue(objectId);
      return {
        content: [{ type: "text", text: JSON.stringify({ path, objectId, value }) }],
      };
    }
  );

  // ─── RunScript ────────────────────────────────────────────────────────────
  server.tool(
    "symcon_run_script",
    "Execute an existing script in IP-Symcon by its script ID",
    { scriptId: z.number().int().describe("The numeric ID of the script") },
    async ({ scriptId }) => {
      logger.debug(`symcon_run_script: ${scriptId}`);
      const result = await symcon.runScript(scriptId);
      return {
        content: [{ type: "text", text: JSON.stringify({ scriptId, result }) }],
      };
    }
  );

  // ─── RunScriptText ────────────────────────────────────────────────────────
  server.tool(
    "symcon_run_script_text",
    "Execute arbitrary PHP code directly in IP-Symcon (use with caution)",
    {
      script: z.string().describe("PHP code to execute in IP-Symcon"),
    },
    async ({ script }) => {
      logger.debug(`symcon_run_script_text: ${script.substring(0, 80)}...`);
      const result = await symcon.runScriptText(script);
      return {
        content: [{ type: "text", text: JSON.stringify({ result }) }],
      };
    }
  );

  // ─── SnapshotVariables ────────────────────────────────────────────────────
  server.tool(
    "symcon_snapshot_variables",
    "Take a snapshot of all variable values under a given root object. " +
      "Use a specific room/device root instead of 0 to avoid excessive results.",
    {
      rootId: z
        .number()
        .int()
        .default(0)
        .describe("Root object ID (0 = entire tree, expensive!)"),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum tree traversal depth"),
    },
    async ({ rootId, maxDepth }) => {
      logger.debug(`symcon_snapshot_variables: root=${rootId} depth=${maxDepth}`);
      const snapshot = await symcon.snapshotVariables(rootId, maxDepth);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ rootId, maxDepth, count: Object.keys(snapshot).length, snapshot }),
          },
        ],
      };
    }
  );

  // ─── DiffVariables ────────────────────────────────────────────────────────
  server.tool(
    "symcon_diff_variables",
    "Compare a previously captured snapshot with the current state to detect changes. " +
      "Useful for identifying which device was toggled.",
    {
      previousSnapshot: z
        .string()
        .describe("JSON string of the previous snapshot (from symcon_snapshot_variables)"),
      rootId: z
        .number()
        .int()
        .default(0)
        .describe("Root object ID to collect current state from"),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum tree traversal depth"),
    },
    async ({ previousSnapshot, rootId, maxDepth }) => {
      logger.debug(`symcon_diff_variables: root=${rootId}`);
      const before = JSON.parse(previousSnapshot) as Record<string, unknown>;
      const after = await symcon.snapshotVariables(rootId, maxDepth);

      const changes: Array<{ variableId: number; before: unknown; after: unknown }> = [];
      for (const [key, newVal] of Object.entries(after)) {
        const oldVal = before[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push({ variableId: parseInt(key, 10), before: oldVal, after: newVal });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ changesFound: changes.length, changes }),
          },
        ],
      };
    }
  );

  // ─── CreateScript ─────────────────────────────────────────────────────────
  server.tool(
    "symcon_script_create",
    "Create a new PHP script in IP-Symcon",
    {
      parentId: z.number().int().describe("Parent category ID"),
      name: z.string().describe("Script name"),
      content: z.string().default("<?php\n").describe("PHP script content"),
    },
    async ({ parentId, name, content }) => {
      logger.debug(`symcon_script_create: "${name}" under ${parentId}`);
      const scriptId = await symcon.createScript(parentId, name);
      await symcon.setScriptContent(scriptId, content);
      return {
        content: [{ type: "text", text: JSON.stringify({ scriptId, name }) }],
      };
    }
  );

  // ─── SetScriptContent ─────────────────────────────────────────────────────
  server.tool(
    "symcon_script_set_content",
    "Update the content (PHP code) of an existing script in IP-Symcon",
    {
      scriptId: z.number().int().describe("The numeric ID of the script"),
      content: z.string().describe("New PHP script content"),
    },
    async ({ scriptId, content }) => {
      logger.debug(`symcon_script_set_content: ${scriptId}`);
      const result = await symcon.setScriptContent(scriptId, content);
      return {
        content: [{ type: "text", text: JSON.stringify({ scriptId, success: result }) }],
      };
    }
  );

  // ─── DeleteScript ─────────────────────────────────────────────────────────
  server.tool(
    "symcon_script_delete",
    "Delete a script from IP-Symcon by its script ID",
    {
      scriptId: z.number().int().describe("The numeric ID of the script to delete"),
    },
    async ({ scriptId }) => {
      logger.debug(`symcon_script_delete: ${scriptId}`);
      const result = await symcon.deleteScript(scriptId);
      return {
        content: [{ type: "text", text: JSON.stringify({ scriptId, success: result }) }],
      };
    }
  );

  logger.info("Registered 14 Symcon MCP tools");
}
