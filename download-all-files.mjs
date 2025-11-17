import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

// Uses the Files API directly instead of a specific vector store.
// Set OPENAI_API_KEY before running:
//   export OPENAI_API_KEY="YOUR_KEY"

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  if (!client.apiKey) {
    console.error("Missing OPENAI_API_KEY env var.");
    process.exit(1);
  }

  const outDir = path.resolve("openai-files-downloads");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("Listing all files in your OpenAI project…");
  const files = await client.files.list();

  if (!files.data.length) {
    console.log("No files found in this project.");
    return;
  }

  for (const f of files.data) {
    console.log(`Processing ${f.id} (${f.filename ?? "no-name"}), purpose=${f.purpose}`);

    // OpenAI does NOT allow downloading assistant-purpose files.
    if (f.purpose === "assistants") {
      console.warn(`  → Skipped: files with purpose "assistants" cannot be downloaded via API.`);
      continue;
    }

    try {
      const resp = await client.files.content(f.id);
      const chunks = [];
      for await (const chunk of resp.body) {
        chunks.push(chunk);
      }
      const buf = Buffer.concat(chunks);
      const safeName = (f.filename || f.id).replace(/[^\w.\-]/g, "_");
      const filePath = path.join(outDir, safeName);
      fs.writeFileSync(filePath, buf);
      console.log("  → saved to", filePath);
    } catch (err) {
      console.error("  → Error downloading", f.id, err);
    }
  }

  console.log("Done. Downloaded files are in:", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


