import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

// Set OPENAI_API_KEY in your environment before running:
//   export OPENAI_API_KEY="YOUR_NEW_KEY"
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Your vector store ID
const VECTOR_STORE_ID = "vs_68e7bc12f4e08191ad6900bf7eec2983";

async function main() {
  if (!client.apiKey) {
    console.error("Missing OPENAI_API_KEY env var.");
    process.exit(1);
  }

  const outDir = path.resolve("vector-store-downloads");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("Listing files in vector store:", VECTOR_STORE_ID);
  const list = await client.vectorStores.files.list(VECTOR_STORE_ID, { limit: 100 });

  if (!list.data.length) {
    console.log("No files found in this vector store.");
    return;
  }

  for (const f of list.data) {
    console.log("Downloading", f.id);
    try {
      const resp = await client.files.content(f.id);
      const chunks = [];
      for await (const chunk of resp.body) {
        chunks.push(chunk);
      }
      const buf = Buffer.concat(chunks);
      const filePath = path.join(outDir, `${f.id}`);
      fs.writeFileSync(filePath, buf);
      console.log("  → saved to", filePath);
    } catch (err) {
      if (err?.status === 400 && err?.error?.message?.includes("Not allowed to download files of purpose: assistants")) {
        console.warn(
          `  → Skipped ${f.id}: this file was created with purpose "assistants" and OpenAI does not allow downloading its raw contents.`,
        );
      } else {
        console.error("  → Error downloading", f.id, err);
      }
    }
  }

  console.log("Done. (Some assistant-purpose files may not be downloadable.) Files are in:", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


