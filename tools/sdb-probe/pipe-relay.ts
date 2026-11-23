/**
 * Minimal SDB byte-pipe relay (concept test only, NOT the final multiplexer).
 *
 * Listens on LISTEN_PORT and pipes each client to the TV's sdbd. Because sdbd
 * allows one host connection at a time, only one client can use it at once.
 *
 * Usage: bun tools/sdb-probe/pipe-relay.ts [tvHost] [listenPort]
 */
import { createServer, connect } from "node:net";

const TV_HOST = process.argv[2] ?? Bun.env.TV_HOST ?? "192.0.2.130";
const TV_PORT = 26101;
const LISTEN_PORT = Number(process.argv[3] ?? 26201);

const server = createServer((client) => {
  const peer = `${client.remoteAddress}:${client.remotePort}`;
  console.log(`client ${peer} connected`);
  const upstream = connect(TV_PORT, TV_HOST);
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close).on("close", () => { console.log(`client ${peer} closed`); close(); });
  upstream.on("error", close).on("close", close);
});

server.listen(LISTEN_PORT, "127.0.0.1", () =>
  console.log(`relay 127.0.0.1:${LISTEN_PORT} -> ${TV_HOST}:${TV_PORT}`),
);
