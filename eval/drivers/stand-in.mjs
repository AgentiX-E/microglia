/**
 * A stand-in model endpoint for rehearsing the benchmark lane without spending calls.
 *
 * It answers two prompt families:
 *   - the distiller's ("You extract reusable, declarative lessons...") with one candidate
 *     whose statement carries a running number, so every distillation creates a distinct
 *     rule and dedupe does not collapse the store to a single entry;
 *   - everything else, which in this lane is a text-to-SQL prompt, with `SELECT 1`.
 *
 * `SELECT 1` is deliberate. It is valid SQL, so no call fails and no parse gate fires, and
 * it is wrong for essentially every BIRD question, so every rule that was injected into an
 * answer collects a failure. That is the worst case for the deletion arm: if the sequencing
 * is right, the arm retires the rules it credited and its pack becomes empty, which is
 * observable in one run and wrong in a way a human can check by reading the numbers.
 *
 * Usage: node stand-in.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8899);
// The SQL every non-distillation prompt receives. `SELECT 1` executes and returns a row, so
// nothing fails and the retry arm never fires; an invalid statement makes every question fail,
// which is how the retry path is rehearsed.
const SQL = process.env['STANDIN_SQL'] ?? 'SELECT 1';
let distilled = 0;
let prompted = 0;

const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    let prompt = '';
    try {
      const parsed = JSON.parse(body);
      prompt = (parsed.messages ?? []).map((message) => message.content ?? '').join('\n');
    } catch {
      prompt = body;
    }
    let content;
    if (prompt.includes('You extract reusable, declarative lessons')) {
      distilled += 1;
      content = JSON.stringify({
        candidates: [
          {
            kind: 'constraint',
            statement: `Stand-in rule ${distilled}: a question that names a column must select that column.`,
            when: 'the question names a column explicitly',
            payload: {},
          },
        ],
      });
    } else {
      prompted += 1;
      content = SQL;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`stand-in listening on ${port}\n`);
});

process.on('SIGTERM', () => {
  process.stdout.write(`stand-in served ${distilled} distillations, ${prompted} prompts\n`);
  server.close();
  process.exit(0);
});
