import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const useAssistant = Boolean(ASSISTANT_ID);

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { message } = body || {};

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: "Missing 'message' string in body" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        if (useAssistant) {
          // Use Assistants API with streaming
          const thread = await openai.beta.threads.create();

          await openai.beta.threads.messages.create(thread.id, {
            role: 'user',
            content: message,
          });

          const runStream = openai.beta.threads.runs.stream(thread.id, {
            assistant_id: ASSISTANT_ID,
          });

          let fullText = '';

          for await (const event of runStream) {
            if (event.event === 'thread.message.delta') {
              const delta = event.data.delta;
              if (delta.content && delta.content[0] && delta.content[0].text) {
                const text = delta.content[0].text.value;
                if (text) {
                  fullText += text;
                  send({ type: 'delta', value: text });
                }
              }
            }
          }

          send({ type: 'done', value: fullText });
        } else {
          // Use Chat Completions API with streaming
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are Lisa, a friendly and helpful AI assistant. Be conversational, warm, and concise in your responses.',
              },
              {
                role: 'user',
                content: message,
              },
            ],
            stream: true,
          });

          let fullText = '';

          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              fullText += content;
              send({ type: 'delta', value: content });
            }
          }

          send({ type: 'done', value: fullText });
        }
      } catch (error) {
        console.error('Stream error:', error);
        send({ type: 'error', message: error.message || 'Unexpected error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
