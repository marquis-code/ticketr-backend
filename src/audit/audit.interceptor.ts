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

    // We only care about tracking authenticated users.
    if (!user || !user.tenantId) {
      return next.handle();
    }

    // Exclude the client audit route to prevent infinite loops / noise
    if (originalUrl.includes('/audit/client') || originalUrl.includes('/audit?page')) {
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
            tenantId: user.tenantId.toString(),
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
            userId: user._id.toString(),
            tenantId: user.tenantId.toString(),
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

  private sanitizeBody(body: any) {
    if (!body) return null;
    const sanitized = { ...body };
    if (sanitized.password) sanitized.password = '[REDACTED]';
    if (sanitized.confirmPassword) sanitized.confirmPassword = '[REDACTED]';
    return sanitized;
  }
}
