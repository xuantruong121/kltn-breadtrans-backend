import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_RESPONSE_TRANSFORM_KEY } from '../decorators/skip-response-transform.decorator';

export interface Response<T> {
  statusCode: number;
  message: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const skipTransform =
      Reflect.getMetadata(SKIP_RESPONSE_TRANSFORM_KEY, handler) === true ||
      Reflect.getMetadata(SKIP_RESPONSE_TRANSFORM_KEY, controller) === true;

    if (skipTransform) {
      return next.handle() as Observable<Response<T>>;
    }

    return next.handle().pipe(
      map((data) => ({
        statusCode: context.switchToHttp().getResponse().statusCode,
        message: 'Success',
        data,
      })),
    );
  }
}
