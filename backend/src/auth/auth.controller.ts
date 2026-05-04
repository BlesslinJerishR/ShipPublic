import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
  HttpCode,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { AuthService } from './auth.service';
import { JwtAuthGuard, COOKIE_NAME } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private get clientId() {
    return process.env.GITHUB_CLIENT_ID || '';
  }
  private get clientSecret() {
    return process.env.GITHUB_CLIENT_SECRET || '';
  }
  private get callbackUrl() {
    return (
      process.env.GITHUB_CALLBACK_URL ||
      'http://localhost:4000/api/auth/github/callback'
    );
  }
  private get frontendUrl() {
    return process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  @Get('github')
  redirectToGithub(@Res() res: any) {
    const scopes = ['read:user', 'user:email', 'repo', 'admin:repo_hook'].join(
      ' ',
    );
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.callbackUrl);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('allow_signup', 'true');
    return res.code(302).header('location', url.toString()).send();
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: any) {
    if (!code) throw new UnauthorizedException('Missing code');
    const tokenResp = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.callbackUrl,
      },
      { headers: { Accept: 'application/json' }, timeout: 15000 },
    );
    const accessToken: string | undefined = tokenResp.data?.access_token;
    const scopes: string | undefined = tokenResp.data?.scope;
    if (!accessToken) throw new UnauthorizedException('GitHub token failed');

    const userResp = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
      timeout: 15000,
    });
    const gh = userResp.data;
    let email: string | null = gh.email ?? null;
    if (!email) {
      try {
        const emails = await axios.get('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
          },
        });
        const primary = (emails.data as any[]).find((e) => e.primary);
        email = primary?.email ?? null;
      } catch {
        email = null;
      }
    }

    const user = await this.auth.upsertGithubUser({
      githubId: String(gh.id),
      username: gh.login,
      name: gh.name,
      email,
      avatarUrl: gh.avatar_url,
      accessToken,
      scopes,
    });

    const session = this.auth.signSession(user.id, user.username);
    res.setCookie(COOKIE_NAME, session, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
    });

    return res.code(302).header('location', `${this.frontendUrl}/dashboard`).send();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('logout')
  @HttpCode(200)
  logout(@Res() res: any) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.send({ ok: true });
  }
}
