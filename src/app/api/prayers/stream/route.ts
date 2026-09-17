import { NextRequest } from 'next/server';
import { addListener, removeListener } from '@/lib/prayer-events';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode('event: connected\ndata: {"status":"connected"}\n\n'));

      // Batch buffer for backpressure
      let buffer: unknown[] = [];
      let batchTimeout: NodeJS.Timeout | null = null;

      const flushBuffer = () => {
        if (buffer.length > 0 && !isClosed) {
          const data = JSON.stringify(buffer.length === 1 ? buffer[0] : buffer);
          controller.enqueue(encoder.encode(`event: prayer\ndata: ${data}\n\n`));
          buffer = [];
        }
        batchTimeout = null;
      };

      const listener = (prayer: unknown) => {
        if (isClosed) return;
        buffer.push(prayer);

        // Backpressure: if >5 in buffer, flush immediately
        if (buffer.length >= 5) {
          if (batchTimeout) clearTimeout(batchTimeout);
          flushBuffer();
        } else if (!batchTimeout) {
          // Otherwise batch for 2 seconds
          batchTimeout = setTimeout(flushBuffer, 2000);
        }
      };

      addListener(listener);

      // Keep-alive ping every 30s
      const keepAlive = setInterval(() => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(':keepalive\n\n'));
        }
      }, 30000);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        removeListener(listener);
        if (batchTimeout) clearTimeout(batchTimeout);
        clearInterval(keepAlive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
