import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

export const COOKIE_NAME = process.env.COOKIE_NAME || 'shipublic_session';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<any>();
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const authHeader: string | undefined = req.headers?.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
    const token = cookieToken || bearer;
    if (!token) throw new UnauthorizedException('Missing session');
    try {
      const payload = this.auth.verify(token);
      const user = await this.auth.getUserById(payload.sub);
      if (!user) throw new UnauthorizedException('User not found');
      req.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid session');
    }
  }
}
