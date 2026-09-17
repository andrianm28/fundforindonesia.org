/**
 * Consistent API error handling layer for the Kitabisa Clone platform.
 * All error messages are in Indonesian (Bahasa Indonesia).
 */

export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
  status: number;
}

/**
 * Creates a validation error (400 Bad Request).
 */
export function validationError(message: string, field?: string): ApiError {
  return {
    code: 'VALIDATION_ERROR',
    message,
    field,
    status: 400,
  };
}

/**
 * Creates a not found error (404).
 * @param resource - The resource name (in Indonesian) that was not found.
 */
export function notFoundError(resource?: string): ApiError {
  const resourceName = resource || 'Data';
  return {
    code: 'NOT_FOUND',
    message: `${resourceName} tidak ditemukan`,
    status: 404,
  };
}

/**
 * Creates an unauthorized error (401).
 */
export function unauthorizedError(): ApiError {
  return {
    code: 'UNAUTHORIZED',
    message: 'Anda harus login terlebih dahulu',
    status: 401,
  };
}

/**
 * Creates a forbidden error (403).
 */
export function forbiddenError(message?: string): ApiError {
  return {
    code: 'FORBIDDEN',
    message: message || 'Anda tidak memiliki akses',
    status: 403,
  };
}

/**
 * Creates a server error (500).
 */
export function serverError(message?: string): ApiError {
  return {
    code: 'SERVER_ERROR',
    message: message || 'Terjadi kesalahan pada server',
    status: 500,
  };
}

/**
 * Creates a conflict error (409) for unique constraint violations.
 */
export function conflictError(message?: string): ApiError {
  return {
    code: 'CONFLICT',
    message: message || 'Data sudah ada',
    status: 409,
  };
}

/**
 * Creates a NextResponse-compatible JSON Response from an ApiError.
 */
export function apiErrorResponse(error: ApiError): Response {
  const body: Record<string, unknown> = {
    code: error.code,
    message: error.message,
    status: error.status,
  };

  if (error.field) {
    body.field = error.field;
  }

  if (error.details !== undefined) {
    body.details = error.details;
  }

  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Maps Prisma errors to appropriate ApiErrors.
 * Handles common Prisma error codes:
 * - P2002: Unique constraint violation → 409 Conflict
 * - P2025: Record not found → 404 Not Found
 * - P2003: Foreign key constraint failed → 400 Validation Error
 * - P2014: Relation violation → 400 Validation Error
 */
export function handlePrismaError(error: unknown): ApiError {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const prismaError = error as {
      code: string;
      meta?: { target?: string[]; field_name?: string; modelName?: string };
    };

    switch (prismaError.code) {
      case 'P2002': {
        // Unique constraint violation
        const fields = prismaError.meta?.target;
        const fieldName = fields ? fields.join(', ') : undefined;
        return {
          code: 'CONFLICT',
          message: 'Data sudah ada',
          field: fieldName,
          status: 409,
        };
      }

      case 'P2025': {
        // Record not found
        const model = prismaError.meta?.modelName;
        const resourceName = model || 'Data';
        return {
          code: 'NOT_FOUND',
          message: `${resourceName} tidak ditemukan`,
          status: 404,
        };
      }

      case 'P2003': {
        // Foreign key constraint failed
        const field = prismaError.meta?.field_name;
        return {
          code: 'VALIDATION_ERROR',
          message: 'Data referensi tidak valid',
          field: field,
          status: 400,
        };
      }

      case 'P2014': {
        // Relation violation
        return {
          code: 'VALIDATION_ERROR',
          message: 'Relasi data tidak valid',
          status: 400,
        };
      }

      default:
        return serverError();
    }
  }

  // Not a Prisma error, return generic server error
  return serverError();
}
