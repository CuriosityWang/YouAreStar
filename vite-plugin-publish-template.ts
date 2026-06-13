import type { Plugin } from "vite";
import type { IncomingMessage } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  isSafeId,
  isAllowedExt,
  isValidCorners,
  isLocalizedText,
  upsertPreset,
  type PresetEntry,
} from "./src/lib/presetManifest";

const ROUTE = "/__publish-template";

interface PublishBody {
  id: string;
  name: { en: string; zh: string };
  caption: { en: string; zh: string };
  corners: PresetEntry["corners"];
  bg: { base64: string; ext: string } | null;
  maskPng: string | null;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** Dev-only endpoint that publishes an official template: writes the bg + mask
 *  PNG into public/billboards/ and upserts src/data/billboards.json. */
export function publishTemplatePlugin(): Plugin {
  return {
    name: "publish-template",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const billboardsDir = path.resolve(root, "public/billboards");
      const manifestPath = path.resolve(root, "src/data/billboards.json");
      const within = (p: string) =>
        p === billboardsDir || p.startsWith(billboardsDir + path.sep);

      server.middlewares.use(ROUTE, async (req, res) => {
        const send = (code: number, obj: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(obj));
        };
        if (req.method !== "POST") return send(405, { ok: false, error: "POST only" });
        try {
          const body = (await readJson(req)) as PublishBody;
          if (!body || !isSafeId(body.id)) return send(400, { ok: false, error: "invalid id" });
          if (!isLocalizedText(body.name)) return send(400, { ok: false, error: "name needs en+zh" });
          if (!isLocalizedText(body.caption)) return send(400, { ok: false, error: "caption needs en+zh" });
          if (!isValidCorners(body.corners)) return send(400, { ok: false, error: "invalid corners" });

          let list: PresetEntry[] = [];
          try {
            list = JSON.parse(await fs.readFile(manifestPath, "utf8")) as PresetEntry[];
          } catch {
            list = [];
          }
          const existing = list.find((p) => p.id === body.id);

          await fs.mkdir(billboardsDir, { recursive: true });

          let src: string;
          if (body.bg) {
            const ext = body.bg.ext.toLowerCase();
            if (!isAllowedExt(ext)) return send(400, { ok: false, error: `ext not allowed: ${ext}` });
            const file = path.resolve(billboardsDir, `${body.id}.${ext}`);
            if (!within(file)) return send(400, { ok: false, error: "path escape" });
            await fs.writeFile(file, Buffer.from(body.bg.base64, "base64"));
            src = `/billboards/${body.id}.${ext}`;
          } else if (existing) {
            src = existing.src;
          } else {
            return send(400, { ok: false, error: "new template needs a background image" });
          }

          let mask = existing?.mask;
          if (body.maskPng) {
            const file = path.resolve(billboardsDir, `${body.id}-mask.png`);
            if (!within(file)) return send(400, { ok: false, error: "path escape" });
            await fs.writeFile(file, Buffer.from(body.maskPng, "base64"));
            mask = `/billboards/${body.id}-mask.png`;
          }

          const entry: PresetEntry = {
            id: body.id,
            name: body.name,
            caption: body.caption,
            src,
            corners: body.corners,
            ...(mask ? { mask } : {}),
          };
          const next = upsertPreset(list, entry);
          await fs.writeFile(manifestPath, JSON.stringify(next, null, 2) + "\n", "utf8");

          return send(200, { ok: true, src, mask: mask ?? null, updated: !!existing });
        } catch (e) {
          server.config.logger.error(`[publish-template] ${String(e)}`);
          return send(500, { ok: false, error: String((e as Error)?.message ?? e) });
        }
      });
    },
  };
}
