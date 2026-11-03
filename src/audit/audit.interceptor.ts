import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, user, body, params, query, ip } = request;

    // Audit authenticated users, including super admins (whose actions matter most).
    if (!user || !user.userId) {
      return next.handle();
    }

    // Exclude the client audit route to prevent infinite loops / noise.
    if (originalUrl.includes('/audit/client') || originalUrl.includes('/audit?page')) {
      return next.handle();
    }

    // Reads do not belong in a security trail. Logging every GET buried the
    // actions that actually matter and wrote megabytes of noise.
    if (method === 'GET') {
      return next.handle();
    }

    // Determine Action Name
    const actionMap: Record<string, string> = {
      'GET': 'VIEW',
      'POST': 'CREATE',
      'PUT': 'UPDATE',
      'PATCH': 'UPDATE',
      'DELETE': 'DELETE',
    };
    
    let action = `${actionMap[method] || method}_RESOURCE`;
    
    // Make action names more semantic based on URL
    if (originalUrl.includes('/event')) action = `${actionMap[method]}_EVENT`;
    else if (originalUrl.includes('/order')) action = `${actionMap[method]}_ORDER`;
    else if (originalUrl.includes('/ticket')) action = `${actionMap[method]}_TICKET`;
    else if (originalUrl.includes('/auth')) action = `AUTH_ACTION`;
    else if (originalUrl.includes('/tenant')) action = `${actionMap[method]}_TENANT_SETTING`;
    else if (originalUrl.includes('/analytics')) action = `VIEW_ANALYTICS`;

    const entity = originalUrl.split('?')[0];

    return next.handle().pipe(
      tap({
        next: (response) => {
          // Log successful requests
          this.auditService.logAction({
            action: `${action}_SUCCESS`,
            entity,
            entityId: params.id || 'N/A',
            userId: user.userId,
            tenantId: user.tenantId ? user.tenantId.toString() : undefined,
            details: {
              method,
              query,
              // Only log body if it's not a password field
              payload: this.sanitizeBody(body), 
            },
            ipAddress: ip,
          });
        },
        error: (err) => {
          // Log failed requests
          this.auditService.logAction({
            action: `${action}_FAILED`,
            entity,
            entityId: params.id || 'N/A',
            userId: user.userId,
            tenantId: user.tenantId ? user.tenantId.toString() : undefined,
            details: {
              method,
              error: err.message,
              status: err.status,
            },
            ipAddress: ip,
          });
        }
      })
    );
  }

  private readonly sensitiveKeys = [
    'password',
    'confirmPassword',
    'currentPassword',
    'newPassword',
    'token',
    'accessToken',
    'refreshToken',
    'walletToken',
    'resetPasswordToken',
    'otp',
    'otpSecret',
    'secret',
    'apiKey',
    'authorization',
    'receipt',
    'qrCodeHash',
  ];

  private sanitizeBody(body: any) {
    if (!body || typeof body !== 'object') return null;
    const walk = (value: any, depth = 0): any => {
      if (depth > 4) return '[TRUNCATED]';
      if (Array.isArray(value)) return value.slice(0, 20).map((v) => walk(v, depth + 1));
      if (value && typeof value === 'object') {
        if (Buffer.isBuffer(value)) return '[FILE]';
        const out: any = {};
        for (const [key, val] of Object.entries(value)) {
          if (this.sensitiveKeys.includes(key)) out[key] = '[REDACTED]';
          else if (key === 'buffer') out[key] = '[FILE]';
          else out[key] = walk(val, depth + 1);
        }
        return out;
      }
      if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
      return value;
    };
    return walk(body);
  }
}
