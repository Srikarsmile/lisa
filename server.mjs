import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT || 5173;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = __dirname;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const useAssistant = Boolean(ASSISTANT_ID);

async function askWithAssistant(message) {
  const thread = await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: message,
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: ASSISTANT_ID,
  });

  let runStatus = run;
  while (runStatus.status === "queued" || runStatus.status === "in_progress") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  }

  if (runStatus.status !== "completed") {
    throw new Error(`Assistant run ended with status: ${runStatus.status}`);
  }

  const messages = await openai.beta.threads.messages.list(thread.id, { order: "desc", limit: 5 });
  const assistantMessage = messages.data.find((msg) => msg.role === "assistant");

  const contentBlock = assistantMessage?.content?.find(
    (block) => block.type === "output_text" || block.type === "text",
  );

  const text =
    contentBlock?.text?.value ||
    contentBlock?.text ||
    null;

  if (!text) {
    throw new Error("Assistant did not return textual output.");
  }

  return text.trim();
}

async function askWithModel(message) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: message,
      },
    ],
  });

  if (!response?.output?.length) {
    throw new Error("Assistant returned an empty response.");
  }

  const text = response.output
    .map((item) => {
      const content = item?.content?.[0];
      if (content?.type === "output_text" && content?.text?.value) {
        return content.text.value;
      }
      if (content?.type === "text" && content?.text) {
        return content.text;
      }
      return "";
    })
    .join("")
    .trim();

  if (!text) {
    throw new Error("Assistant did not return textual output.");
  }

  return text;
}

async function askOpenAI(message) {
  if (useAssistant) {
    return askWithAssistant(message);
  }
  return askWithModel(message);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(staticDir));

app.post("/api/chat", async (req, res) => {
  const { message } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in body" });
  }

  try {
    const answer = await askOpenAI(message);
    res.json({ answer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Unexpected error" });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  const { message } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' string in body" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    if (useAssistant) {
      // Use streaming with Assistants API for faster responses
      const thread = await openai.beta.threads.create();

      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: message,
      });

      const stream = openai.beta.threads.runs.stream(thread.id, {
        assistant_id: ASSISTANT_ID,
      });

      let fullText = "";

      stream.on("textDelta", (delta) => {
        if (delta.value) {
          fullText += delta.value;
          send({ type: "delta", value: delta.value });
        }
      });

      stream.on("textDone", () => {
        send({ type: "done", value: fullText });
        res.end();
      });

      stream.on("error", (error) => {
        console.error("Stream error:", error);
        send({ type: "error", message: error.message || "Assistant stream error" });
        res.end();
      });

      req.on("close", () => {
        stream.abort();
      });

      // Wait for the stream to complete
      await stream.finalRun();
    } else {
      const stream = await openai.responses.stream({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: message,
          },
        ],
      });

      req.on("close", () => {
        stream.controller.abort();
      });

      let fullText = "";

      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta) {
          fullText += event.delta;
          send({ type: "delta", value: event.delta });
        } else if (event.type === "response.completed") {
          send({ type: "done", value: fullText });
          res.end();
        } else if (event.type === "response.error") {
          send({ type: "error", message: event.error?.message || "OpenAI stream error" });
          res.end();
        }
      }
    }
  } catch (error) {
    console.error(error);
    send({ type: "error", message: error.message || "Unexpected error" });
    res.end();
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Lisa site available at http://localhost:${PORT}`);
});


