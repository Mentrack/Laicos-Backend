import {
  ForbiddenException,
  Logger,
  OnApplicationShutdown,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import { Role } from '../../generated/client';
import { FirebaseService } from '../auth/firebase/firebase.service';
import {
  assertActivated,
  passwordChangeRequiredError,
  requireLocalUser,
  verifySessionToken,
} from '../auth/utils/session';
import { redisConnection } from '../common/config';
import { errorBody } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

export const CHAT_EVENTS = {
  messageCreated: 'message.created',
  conversationRead: 'conversation.read',
} as const;

export type ChatEvent = (typeof CHAT_EVENTS)[keyof typeof CHAT_EVENTS];

const CHAT_ROLES: Role[] = [Role.BUYER, Role.EXTENSION_AGENT];

// WebSocket only: socket.io's long-polling fallback needs sticky sessions,
// which Railway doesn't offer. No CORS option: browsers don't apply CORS to
// WebSocket upgrades, and auth is a handshake token, not a cookie.
@WebSocketGateway({ namespace: 'v1/chat', transports: ['websocket'] })
export class ChatGateway
  implements OnGatewayInit<Namespace>, OnApplicationShutdown
{
  private readonly logger = new Logger(ChatGateway.name);
  private readonly redis: Redis[] = [];
  private namespace: Namespace;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly database: PrismaService,
    private readonly config: ConfigService,
  ) {}

  afterInit(namespace: Namespace): void {
    this.namespace = namespace;
    const publisher = this.connectRedis();
    const subscriber = this.connectRedis();
    this.redis.push(publisher, subscriber);
    // Attached here rather than in main.ts. Without it an emit reaches only
    // this instance's sockets, so a second replica would silently drop messages.
    namespace.server.adapter(createAdapter(publisher, subscriber));
    namespace.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (error: unknown) => next(toSocketError(error)),
      );
    });
  }

  // After SocketModule closes the redis adapter (punsubscribe), not before:
  // quitting first makes adapter.close throw on a dead subscriber.
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.redis.map((connection) => connection.quit().catch(() => undefined)),
    );
  }

  /** Best effort: the database is the record, and clients catch up over REST. */
  emitToUsers(userIds: string[], event: ChatEvent, payload: object): void {
    try {
      this.namespace.to(userIds.map(userRoom)).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${event}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private connectRedis(): Redis {
    const client = new Redis(redisConnection(this.config));
    // ioredis throws uncaught on a socket close while commands are queued.
    client.on('error', (error: Error) => this.logger.error(error.message));
    return client;
  }

  private async authenticate(socket: Socket): Promise<void> {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Missing token');
    }
    const decoded = await verifySessionToken(this.firebase, token);
    const user = await requireLocalUser(this.database, decoded.uid);
    assertActivated(user);
    if (user.mustChangePassword) {
      throw passwordChangeRequiredError();
    }
    if (!CHAT_ROLES.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    await socket.join(userRoom(user.id));
    // An open socket is never re-authenticated, so it lives no longer than its
    // token; the client reconnects with a fresh one and catches up with ?after.
    const expiry = setTimeout(
      () => socket.disconnect(true),
      decoded.exp * 1000 - Date.now(),
    );
    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));
  }
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** socket.io hands `message` and `data` to the client's connect_error. */
function toSocketError(error: unknown): Error {
  const body = errorBody(error);
  return Object.assign(new Error(body.message), { data: body.error });
}
