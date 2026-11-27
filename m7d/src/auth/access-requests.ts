import { randomBytes, randomInt } from "node:crypto";
import { PolicyError } from "../lib/errors";

/** State of a request for access. */
export type AccessRequestStatus = "pending" | "approved" | "denied" | "expired";

/** A new browser asking to be let in (kept in memory only). */
interface AccessRequest {
  /** Secret handle only the asking browser knows (it polls with it). */
  requestId: string;
  /** Short code shown on both screens, so the approver can match them. */
  code: string;
  name: string;
  userAgent: string;
  ip: string;
  remember: boolean;
  createdAt: number;
  expiresAt: number;
  status: AccessRequestStatus;
}

/** What a trusted device sees (never the requestId). */
export interface AccessRequestView {
  code: string;
  name: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
}

/** Details the asking browser gets back. */
export interface AccessRequestTicket {
  requestId: string;
  code: string;
  expiresAt: string;
}

/** A request is valid this long. */
const TTL_MS = 5 * 60_000;

/** At most this many open requests in total, and per address (unauthenticated callers). */
const MAX_PENDING = 10;
const MAX_PENDING_PER_IP = 3;

/** Code alphabet without look-alikes (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "K7Q4" → shown as "K7-Q4". */
function newCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 2)}-${code.slice(2)}`;
}

/**
 * "Approve this browser": a new browser asks for access and shows a short code; any signed-in
 * device lists the open requests and approves or denies one. The asking browser polls with its
 * secret requestId and, once approved, is remembered (exactly once).
 */
export class AccessRequests {
  private readonly requests = new Map<string, AccessRequest>();

  /** Opens a request; throws PolicyError when too many are open. */
  open(input: { name: string; userAgent: string; ip: string; remember: boolean }): AccessRequestTicket {
    this.sweep();
    const pending = [...this.requests.values()].filter((request) => request.status === "pending");
    if (pending.length >= MAX_PENDING) return PolicyError.throw("Too many open requests; try again in a few minutes");
    if (pending.filter((request) => request.ip === input.ip).length >= MAX_PENDING_PER_IP) {
      return PolicyError.throw("This address already has open requests; approve or wait for them first");
    }
    let code = newCode();
    while (pending.some((request) => request.code === code)) code = newCode();
    const now = Date.now();
    const request: AccessRequest = {
      requestId: randomBytes(24).toString("base64url"),
      code,
      name: input.name.trim().slice(0, 60) || "Browser",
      userAgent: input.userAgent.slice(0, 300),
      ip: input.ip,
      remember: input.remember,
      createdAt: now,
      expiresAt: now + TTL_MS,
      status: "pending",
    };
    this.requests.set(request.requestId, request);
    return { requestId: request.requestId, code, expiresAt: new Date(request.expiresAt).toISOString() };
  }

  /** Open requests, newest first (for signed-in devices). */
  pending(): AccessRequestView[] {
    this.sweep();
    return [...this.requests.values()]
      .filter((request) => request.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((request) => ({
        code: request.code,
        name: request.name,
        userAgent: request.userAgent,
        ip: request.ip,
        createdAt: new Date(request.createdAt).toISOString(),
        expiresAt: new Date(request.expiresAt).toISOString(),
      }));
  }

  /** Approves or denies the open request with this code; false when there is none. */
  decide(code: string, approve: boolean): boolean {
    this.sweep();
    const request = [...this.requests.values()].find(
      (candidate) => candidate.code === code && candidate.status === "pending",
    );
    if (!request) return false;
    request.status = approve ? "approved" : "denied";
    return true;
  }

  /**
   * The asking browser's poll. An approved request is handed out once (then removed), with what
   * is needed to remember the browser.
   */
  poll(requestId: string): { status: AccessRequestStatus; grant?: { name: string; userAgent: string; remember: boolean } } {
    this.sweep();
    const request = this.requests.get(requestId);
    if (!request) return { status: "expired" };
    if (request.status !== "approved") return { status: request.status };
    this.requests.delete(requestId);
    return {
      status: "approved",
      grant: { name: request.name, userAgent: request.userAgent, remember: request.remember },
    };
  }

  /** Marks timed-out requests and forgets finished ones after a while. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, request] of this.requests) {
      if (request.status === "pending" && now > request.expiresAt) request.status = "expired";
      if (now > request.expiresAt + TTL_MS) this.requests.delete(id);
    }
  }
}
